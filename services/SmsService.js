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
async function claimReceipt({ userId, sender, message, receivedAt, smsHash }) {
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

                if (receipt?.status === "COMPLETED") {
                    return { state: "COMPLETED" };
                }

                if (receipt?.status === "PROCESSING") {
                    const updatedAt = receipt.updatedAt
                        ? new Date(receipt.updatedAt).getTime()
                        : 0;

                    if (Date.now() - updatedAt < PROCESSING_STALE_MS) {
                        return { state: "PROCESSING" };
                    }

                    // Le worker précédent est considéré abandonné.
                    await receipt.update({
                        userId,
                        sender,
                        message,
                        receivedAt,
                        status: "PROCESSING"
                    }, { transaction });

                    return { state: "RETRY", receiptId: receipt.id };
                }

                if (!receipt) {
                    try {
                        receipt = await SmsReceipt.create({
                            userId,
                            smsHash,
                            sender,
                            message,
                            receivedAt,
                            status: "PROCESSING"
                        }, { transaction });
                    } catch (error) {
                        if (error.name === "SequelizeUniqueConstraintError") {
                            // Une autre instance a gagné la course.
                            return { state: "PROCESSING" };
                        }
                        throw error;
                    }
                } else {
                    await receipt.update({
                        userId,
                        sender,
                        message,
                        receivedAt,
                        status: "PROCESSING"
                    }, { transaction });
                }

                return { state: "CLAIMED", receiptId: receipt.id };
            }
        );
    });
}

async function markCompleted(smsHash) {
    return sequelize.transaction(async transaction => {
        return withAdvisoryLock(
            transaction,
            `trackzo:sms:${smsHash}`,
            async () => {
                const receipt = await SmsReceipt.findOne({
                    where: { smsHash },
                    transaction,
                    lock: transaction.LOCK.UPDATE
                });

                if (!receipt) {
                    throw new Error("Receipt SMS introuvable après écriture Google");
                }

                await receipt.update({ status: "COMPLETED" }, { transaction });
                return receipt;
            }
        );
    });
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
    const date = getLocalDate(timezone);

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
                await createDailySheet(userId);
            }
        });

        dailySheet = await DailySheet.findOne({ where: { userId, date } });
    }

    if (!dailySheet) {
        throw new Error("Journalier introuvable après création");
    }

    const claim = await claimReceipt({
        userId,
        sender: normalizedSender,
        message: normalizedMessage,
        receivedAt: safeTimestamp,
        smsHash: normalizedHash
    });

    if (claim.state === "COMPLETED") {
        return { duplicate: true, accepted: true, spreadsheetId: dailySheet.spreadsheetId };
    }

    if (claim.state === "PROCESSING") {
        return { processing: true };
    }

    // Pour un nouveau claim ou une reprise ancienne, Google est la source de
    // vérité en cas de timeout/connexion coupée après append.
    const alreadyInSheet = await rawHashExists(
        googleAccount.refreshToken,
        dailySheet.spreadsheetId,
        normalizedHash
    );

    if (alreadyInSheet) {
        await markCompleted(normalizedHash);
        scheduleProcessing(googleAccount.refreshToken, dailySheet.spreadsheetId);
        return {
            duplicate: true,
            reconciled: true,
            spreadsheetId: dailySheet.spreadsheetId
        };
    }

    const safeDate = new Date(safeTimestamp);

    // La date visible dans "Transactions brutes" doit toujours être
    // dd-MM-yyyy. La variable `date` ci-dessus reste au format interne
    // utilisé pour retrouver le journalier en base.
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

    try {
        await appendRawRows(
            googleAccount.refreshToken,
            dailySheet.spreadsheetId,
            [[
                rawDate,
                time,
                normalizedMessage,
                "PENDING",
                normalizedHash
            ]]
        );
    } catch (error) {
        // IMPORTANT: on conserve PROCESSING en DB.
        // Une prochaine tentative réconciliera E:E avant tout nouvel append.
        console.error("⚠️ Append Google incertain — receipt conservé PROCESSING", {
            smsHash: normalizedHash,
            error: error.message
        });
        throw error;
    }

    await markCompleted(normalizedHash);

    scheduleProcessing(
        googleAccount.refreshToken,
        dailySheet.spreadsheetId
    );

    return {
        duplicate: false,
        accepted: true,
        spreadsheetId: dailySheet.spreadsheetId
    };
}

module.exports = { send };
