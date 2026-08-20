const UserSettings = require("../models/UserSettings");
const DailySheet = require("../models/DailySheet");
const GoogleAccount = require("../models/GoogleAccount");
const SmsReceipt = require("../models/SmsReceipt");
const { getLocalDate, createDailySheet } = require("./dailySheetService");
const { appendRawRows } = require("./dailySheetWriter");

async function send({ userId, sender, message, receivedAt, smsHash }) {
    if (!userId || !sender || !message || !smsHash) {
        throw new Error("Données SMS incomplètes");
    }

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

    const messageText = String(message).trim();
    const timestamp = Number(receivedAt);
    const safeDate = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
    const time = new Intl.DateTimeFormat("fr-FR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).format(safeDate);

    const existingReceipt = await SmsReceipt.findOne({ where: { smsHash, userId } });
    if (existingReceipt) return { duplicate: true };

    await appendRawRows(
        googleAccount.refreshToken,
        dailySheet.spreadsheetId,
        [[date, time, messageText, "PENDING"]]
    );

    try {
        await SmsReceipt.create({
            userId,
            smsHash,
            sender: String(sender),
            receivedAt: Number(receivedAt) || Date.now()
        });
    } catch (error) {
        if (error.name !== "SequelizeUniqueConstraintError") throw error;
    }

    return { duplicate: false, spreadsheetId: dailySheet.spreadsheetId };
}

module.exports = { send };
