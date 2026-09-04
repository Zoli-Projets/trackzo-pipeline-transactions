const UserSettings = require("../models/UserSettings");
const DailySheet = require("../models/DailySheet");
const GoogleAccount = require("../models/GoogleAccount");
const SmsReceipt = require("../models/SmsReceipt");
const { getLocalDate, createDailySheet } = require("./dailySheetService");
const { appendRawRows } = require("./dailySheetWriter");
const { processDailySheet } = require("./dailySheetProcessorService");

async function send({ userId, sender, message, receivedAt, smsHash }) {
    const normalizedSender = String(sender ?? "").trim();
    const normalizedMessage = String(message ?? "").trim();
    const normalizedHash = String(smsHash ?? "").trim();

    if (!userId || !normalizedSender || !normalizedMessage || !normalizedHash) {
        throw new Error("Données SMS incomplètes");
    }

    // L'idempotence est vérifiée avant tout appel Google : un retry ne doit jamais
    // créer une seconde ligne dans la feuille.
    const existingReceipt = await SmsReceipt.findOne({
        where: { smsHash: normalizedHash }
    });
    if (existingReceipt) return { duplicate: true };

    const settings = await UserSettings.findOne({ where: { userId } });
    if (!settings) throw new Error("Paramètres utilisateur introuvables");

    const googleAccount = await GoogleAccount.findOne({ where: { userId } });
    if (!googleAccount) throw new Error("Compte Google non connecté");

    const timezone = settings.timezone || "Africa/Abidjan";
    const date = getLocalDate(timezone);
    let dailySheet = await DailySheet.findOne({ where: { userId, date } });

    if (!dailySheet) {
        dailySheet = await createDailySheet(userId);
    }

    const timestamp = Number(receivedAt);
    const safeDate = Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp)
        : new Date();

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
        [[date, time, normalizedMessage, "PENDING"]]
    );

    try {
        await SmsReceipt.create({
            userId,
            smsHash: normalizedHash,
            sender: normalizedSender,
            message: normalizedMessage,
            receivedAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
        });
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return { duplicate: true, spreadsheetId: dailySheet.spreadsheetId };
        }
        throw error;
    }

    // Traiter immédiatement les lignes PENDING. Le traitement reste idempotent :
    // les lignes déjà OK/ERROR sont ignorées par le processor.
    let processing = null;
    try {
        processing = await processDailySheet(
            googleAccount.refreshToken,
            dailySheet.spreadsheetId
        );
        console.log("⚙️ SMS traité automatiquement:", {
            spreadsheetId: dailySheet.spreadsheetId,
            processed: processing.processed,
            cleaned: processing.cleaned,
            alerts: processing.alerts,
            errors: processing.errors
        });
    } catch (error) {
        // Le SMS est déjà enregistré dans Room côté mobile et dans SmsReceipt côté serveur.
        // Une prochaine synchronisation/reprise pourra retraiter la ligne PENDING.
        console.error("⚠️ SMS enregistré mais traitement de feuille différé:", error.message);
    }

    return { duplicate: false, spreadsheetId: dailySheet.spreadsheetId, processing };
}

module.exports = { send };
