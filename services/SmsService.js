const sequelize = require("../database/database");
const UserSettings = require("../models/UserSettings");
const DailySheet = require("../models/DailySheet");
const GoogleAccount = require("../models/GoogleAccount");
const SmsReceipt = require("../models/SmsReceipt");
const { getLocalDate, createDailySheet } = require("./dailySheetService");
const { appendRawRows, rawHashExists } = require("./dailySheetWriter");
const { processDailySheet } = require("./dailySheetProcessorService");

const PROCESSING_STALE_MS = 5 * 60 * 1000;
const processingTimers = new Map();

function scheduleProcessing(refreshToken, spreadsheetId) {
    const previous = processingTimers.get(spreadsheetId);
    if (previous) clearTimeout(previous);

    const timer = setTimeout(async () => {
        processingTimers.delete(spreadsheetId);
        try {
            const result = await processDailySheet(refreshToken, spreadsheetId);
            console.log("⚙️ Traitement feuille automatique terminé:", {
                spreadsheetId,
                processed: result.processed,
                cleaned: result.cleaned,
                alerts: result.alerts,
                errors: result.errors
            });
        } catch (error) {
            console.error("⚠️ Traitement feuille différé:", error.message);
        }
    }, 2000);

    processingTimers.set(spreadsheetId, timer);
}

async function withAdvisoryLock(transaction, key, fn) {
    await sequelize.query(
        `SELECT pg_advisory_xact_lock(hashtext(:lockKey))`,
        {
            replacements: { lockKey: key },
            transaction
        }
    );
    return fn();
}

/**
 * Claim atomique:
 * - COMPLETED => le SMS est déjà accepté, aucune écriture Sheet.
 * - PROCESSING récent => une autre tentative travaille dessus.
 * - PROCESSING ancien => on reprend après réconciliation avec Google.
 * - absent => on réserve le hash avant l'appel Google.
 *
 * Le hash unique PostgreSQL reste la deuxième barrière contre les courses.
 */
async function claimReceipt({ userId, smsHash }) {
    return sequelize.transaction(async transaction => {
        return withAdvisoryLock(
            transaction,
            `trackzo:sms:${smsHash}`,
            async () => {
                let receipt = await SmsReceipt.findOne({
                    where: { smsHash },
                    transaction,
                    lock: transaction.LOCK.UPDATE
                });

                if (receipt?.status === "PROCESSING") {
                    const updatedAt = receipt.updatedAt
                        ? new Date(receipt.updatedAt).getTime()
                        : 0;

                    if (Date.now() - updatedAt < PROCESSING_STALE_MS) {
                        return { state: "PROCESSING" };
                    }

                    // Reprise d'un envoi dont le résultat Google était incertain.
                    await receipt.update({
                        userId,
                        status: "PROCESSING"
                    }, { transaction });

                    return { state: "RETRY", receiptId: receipt.id };
                }

                if (!receipt) {
                    try {
                        receipt = await SmsReceipt.create({
                            userId,
                            smsHash,
                            status: "PROCESSING"
                        }, { transaction });
                    } catch (error) {
                        if (error.name === "SequelizeUniqueConstraintError") {
                            return { state: "PROCESSING" };
                        }
                        throw error;
                    }
                } else {
                    await receipt.update({
                        userId,
                        status: "PROCESSING"
                    }, { transaction });
                }

                return { state: "CLAIMED", receiptId: receipt.id };
            }
        );
    });
}
async function releaseReceipt(smsHash) {
    return sequelize.transaction(async transaction => {
        return withAdvisoryLock(
            transaction,
            `trackzo:sms:${smsHash}`,
            async () => {
                await SmsReceipt.destroy({
                    where: { smsHash },
                    transaction
                });
            }
        );
    });
}

function isGoogleNotFound(error) {
    return error?.code === 404 ||
        error?.status === 404 ||
        error?.response?.status === 404 ||
        error?.response?.data?.error?.code === 404 ||
        (Array.isArray(error?.errors) && error.errors.some(item => item?.reason === "notFound"));
}
async function send({ userId, sender, message, receivedAt, smsHash }) {
    const normalizedSender = String(sender ?? "").trim();
    const normalizedMessage = String(message ?? "").trim();
    const normalizedHash = String(smsHash ?? "").trim();

    if (!userId || !normalizedSender || !normalizedMessage || !normalizedHash) {
        throw new Error("Données SMS incomplètes");
    }

    const timestamp = Number(receivedAt);
    const safeTimestamp =
        Number.isFinite(timestamp) && timestamp > 0
            ? Math.trunc(timestamp)
            : Date.now();

    const settings = await UserSettings.findOne({ where: { userId } });
    if (!settings) throw new Error("Paramètres utilisateur introuvables");

    const googleAccount = await GoogleAccount.findOne({ where: { userId } });
    if (!googleAccount?.refreshToken) {
        throw new Error("Compte Google non connecté");
    }

    const timezone = settings.timezone || "Africa/Abidjan";
    const safeDate = new Date(safeTimestamp);
    const date = getLocalDate(timezone, safeDate);

    let dailySheet = await DailySheet.findOne({ where: { userId, date } });

    if (!dailySheet) {
        // Protection DB contre deux créations du journalier du même jour.
        await sequelize.transaction(async transaction => {
            await sequelize.query(
                `SELECT pg_advisory_xact_lock(hashtext(:lockKey))`,
                {
                    replacements: {
                        lockKey: `trackzo:daily-sheet:${userId}:${date}`
                    },
                    transaction
                }
            );

            const current = await DailySheet.findOne({
                where: { userId, date }
            });

            if (!current) {
                await createDailySheet(userId, date);
            }
        });

        dailySheet = await DailySheet.findOne({ where: { userId, date } });
    }

    if (!dailySheet) {
        throw new Error("Journalier introuvable après création");
    }

    const claim = await claimReceipt({
        userId,
        smsHash: normalizedHash
    });

    if (claim.state === "PROCESSING") {
        return { processing: true };
    }

    // Google Sheets reste la source durable de l'anti-doublon. Aucun appel
    // Drive supplémentaire n'est fait ici : on utilise directement le Sheet.
    // Si Google répond réellement 404, alors seulement on recrée le journalier
    // de la date du SMS, vide, puis on retente une seule fois.
    const writeToDailySheet = async () => {
        const alreadyInSheet = await rawHashExists(
            googleAccount.refreshToken,
            dailySheet.spreadsheetId,
            normalizedHash
        );

        if (alreadyInSheet) {
            return { duplicate: true, reconciled: true };
        }

        const rawDateParts = new Intl.DateTimeFormat("fr-FR", {
            timeZone: timezone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).formatToParts(safeDate);
        const rawDateMap = Object.fromEntries(
            rawDateParts.map(part => [part.type, part.value])
        );
        const rawDate = `${rawDateMap.day}-${rawDateMap.month}-${rawDateMap.year}`;

        const time = new Intl.DateTimeFormat("fr-FR", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(safeDate);

        await appendRawRows(
            googleAccount.refreshToken,
            dailySheet.spreadsheetId,
            [[rawDate, time, normalizedMessage, "PENDING", normalizedHash]]
        );

        return { duplicate: false, accepted: true };
    };

    let writeResult;
    try {
        writeResult = await writeToDailySheet();
    } catch (error) {
        if (!isGoogleNotFound(error)) {
            // Résultat Google incertain : on garde uniquement le petit verrou
            // PROCESSING. Le SMS complet reste dans Room côté téléphone.
            console.error("⚠️ Écriture Google incertaine — receipt temporaire conservé", {
                smsHash: normalizedHash,
                error: error.message
            });
            throw error;
        }

        console.warn("♻️ Journalier Google introuvable — recréation ciblée", {
            userId,
            date,
            previousSpreadsheetId: dailySheet.spreadsheetId
        });

        // Une seule instance recrée le fichier pour cette date.
        await sequelize.transaction(async transaction => {
            await sequelize.query(
                `SELECT pg_advisory_xact_lock(hashtext(:lockKey))`,
                {
                    replacements: {
                        lockKey: `trackzo:daily-sheet:${userId}:${date}`
                    },
                    transaction
                }
            );

            const current = await DailySheet.findOne({ where: { userId, date } });

            // Si une autre instance a déjà remplacé l'ancien spreadsheetId,
            // on réutilise simplement son nouveau journalier.
            if (current && current.spreadsheetId !== dailySheet.spreadsheetId) {
                dailySheet = current;
                return;
            }

            dailySheet = await createDailySheet(userId, date, {
                replaceExisting: true
            });
        });

        // Un seul retry après recréation : pas de boucle infinie.
        writeResult = await writeToDailySheet();
    }

    // Le hash est maintenant confirmé dans Google (écrit ou déjà présent).
    // Le reçu SQL temporaire n'a plus aucune utilité et est supprimé.
    await releaseReceipt(normalizedHash);
    scheduleProcessing(
        googleAccount.refreshToken,
        dailySheet.spreadsheetId
    );

    return {
        ...writeResult,
        accepted: true,
        spreadsheetId: dailySheet.spreadsheetId
    };
}

module.exports = { send };
