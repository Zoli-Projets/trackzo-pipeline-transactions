const { google } = require("googleapis");
const { Op } = require("sequelize");

const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");
const DailySheet = require("../models/DailySheet");
const SmsReceipt = require("../models/SmsReceipt");
const { appendRawRows } = require("./dailySheetWriter");
const { processDailySheet } = require("./dailySheetProcessorService");

async function removeConfigurationSheet(refreshToken, spreadsheetId) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties(sheetId,title)"
    });

    const configuration = (metadata.data.sheets || []).find(
        sheet => sheet.properties && sheet.properties.title === "Configuration"
    );

    if (!configuration || !configuration.properties || configuration.properties.sheetId == null) {
        return false;
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                deleteSheet: { sheetId: configuration.properties.sheetId }
            }]
        }
    });

    console.log("🗑️ Feuille Configuration supprimée du journalier");
    return true;
}

async function getDriveClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth: oauth2Client });
}

function getLocalDate(timezone, instant = new Date()) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(date.getTime())) {
        throw new Error("Date invalide pour le journalier");
    }

    return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

async function driveFileIsUsable(refreshToken, fileId) {
    if (!fileId) return false;

    const drive = await getDriveClient(refreshToken);

    try {
        const response = await drive.files.get({
            fileId,
            fields: "id,trashed"
        });
        return Boolean(response.data?.id) && response.data.trashed !== true;
    } catch (error) {
        const status = error?.code || error?.response?.status;
        if (status === 404) return false;
        throw error;
    }
}

function formatSmsDateTime(timestamp, timezone) {
    const instant = new Date(Number(timestamp));
    const parts = new Intl.DateTimeFormat("fr-FR", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(instant);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return {
        rawDate: `${map.day}-${map.month}-${map.year}`,
        time: new Intl.DateTimeFormat("fr-FR", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(instant)
    };
}

async function restoreDeletedDailySheet({
    userId,
    localDate,
    timezone,
    refreshToken,
    spreadsheetId
}) {
    const [year, month, day] = localDate.split("-").map(Number);
    const utcAnchor = Date.UTC(year, month - 1, day);

    // Fenêtre large couvrant tous les fuseaux, puis filtrage exact dans le
    // fuseau utilisateur afin de ne restaurer que les SMS de ce journalier.
    const candidates = await SmsReceipt.findAll({
        where: {
            userId,
            status: "COMPLETED",
            receivedAt: {
                [Op.between]: [
                    utcAnchor - 14 * 60 * 60 * 1000,
                    utcAnchor + 38 * 60 * 60 * 1000
                ]
            }
        }
    });

    const receipts = candidates
        .filter(receipt =>
            getLocalDate(timezone, new Date(Number(receipt.receivedAt))) === localDate
        )
        .sort((a, b) => Number(b.receivedAt) - Number(a.receivedAt));

    if (receipts.length === 0) return 0;

    const rows = receipts.map(receipt => {
        const { rawDate, time } = formatSmsDateTime(receipt.receivedAt, timezone);
        return [
            rawDate,
            time,
            String(receipt.message || "").trim(),
            "PENDING",
            String(receipt.smsHash || "").trim()
        ];
    });

    await appendRawRows(refreshToken, spreadsheetId, rows);

    // Régénère Nettoyé / Alertes / Statistiques depuis les transactions brutes.
    await processDailySheet(refreshToken, spreadsheetId);

    return rows.length;
}

/**
 * Crée un journalier à partir du maître Trackzo.
 * targetLocalDate permet de créer exactement la date du SMS (YYYY-MM-DD),
 * même si le SMS arrive au backend plusieurs heures/jours plus tard.
 * Si une référence SQL existe mais que le fichier Drive a été supprimé ou
 * mis à la corbeille, elle est remplacée par un nouveau fichier de même date.
 */
async function createDailySheet(userId, targetLocalDate = null) {
    const settings = await UserSettings.findOne({ where: { userId } });
    if (!settings) throw new Error("Paramètres utilisateur introuvables");

    const googleAccount = await GoogleAccount.findOne({ where: { userId } });
    if (!googleAccount) throw new Error("Compte Google non connecté");
    if (!googleAccount.refreshToken) {
        throw new Error("Refresh token Google introuvable. Veuillez reconnecter Google.");
    }
    if (!googleAccount.dailyFolderId) {
        throw new Error("Dossier Journaliers introuvable");
    }
    if (!settings.sheetId) {
        throw new Error("Maître Trackzo introuvable");
    }

    const timezone = settings.timezone || "Africa/Abidjan";
    const localDate = targetLocalDate || getLocalDate(timezone);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
        throw new Error("Date de journalier invalide: " + localDate);
    }
    const [year, month, day] = localDate.split("-");
    const dailyName = `Trans_${day}-${month}-${year}`;

    const existing = await DailySheet.findOne({
        where: { userId, date: localDate }
    });
    let recreatedDeletedFile = false;

    if (existing) {
        const usable = await driveFileIsUsable(
            googleAccount.refreshToken,
            existing.spreadsheetId
        );

        if (usable) return existing;

        // Le fichier Google correspondant a été supprimé (ou mis à la corbeille).
        // On retire uniquement la référence SQL devenue invalide, puis on recrée
        // un journalier pour EXACTEMENT la même date.
        console.warn(
            "⚠️ Journalier Google absent/supprimé — recréation:",
            existing.spreadsheetId,
            "pour",
            localDate
        );
        await existing.destroy();
        recreatedDeletedFile = true;
    }

    const drive = await getDriveClient(googleAccount.refreshToken);

    const copy = await drive.files.copy({
        fileId: settings.sheetId,
        requestBody: {
            name: dailyName,
            parents: [googleAccount.dailyFolderId]
        },
        fields: "id,name,webViewLink"
    });

    // Un journalier ne doit jamais contenir la feuille technique Configuration.
    await removeConfigurationSheet(googleAccount.refreshToken, copy.data.id);

    const dailySheet = await DailySheet.create({
        userId,
        spreadsheetId: copy.data.id,
        spreadsheetName: copy.data.name,
        date: localDate,
        timezone,
        driveFolderId: googleAccount.dailyFolderId,
        url: copy.data.webViewLink || `https://docs.google.com/spreadsheets/d/${copy.data.id}`,
        scriptId: null
    });

    console.log(
        recreatedDeletedFile ? "♻️ Journalier recréé:" : "📄 Journalier créé:",
        copy.data.id,
        "pour",
        localDate
    );
    console.log("✅ Journalier enregistré en SQL");

    if (recreatedDeletedFile) {
        try {
            const restored = await restoreDeletedDailySheet({
                userId,
                localDate,
                timezone,
                refreshToken: googleAccount.refreshToken,
                spreadsheetId: dailySheet.spreadsheetId
            });

            console.log("♻️ Transactions restaurées après suppression du journalier:", {
                date: localDate,
                restored
            });
        } catch (error) {
            // Ne jamais laisser en SQL un fichier fraîchement recréé mais incomplet.
            // Ainsi le prochain retry recommencera toute la reconstruction.
            console.error("❌ Reconstruction du journalier échouée — rollback logique:", {
                date: localDate,
                spreadsheetId: dailySheet.spreadsheetId,
                error: error.message
            });

            await dailySheet.destroy().catch(() => {});
            await drive.files.update({
                fileId: copy.data.id,
                requestBody: { trashed: true },
                fields: "id,trashed"
            }).catch(() => {});

            throw error;
        }
    }

    return dailySheet;
}

module.exports = { createDailySheet, getLocalDate };
