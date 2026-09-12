const { google } = require("googleapis");

const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");
const DailySheet = require("../models/DailySheet");

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

function getLocalDate(timezone, value = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(value);
}

function isValidDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

/**
 * Crée le journalier du jour à partir du maître Trackzo.
 * Aucun Apps Script n'est requis : le backend peut donc toujours créer le
 * premier journalier immédiatement après OAuth et lors de ensure-today.
 */
async function createDailySheet(userId, targetDate = null, options = {}) {
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
    const localDate = targetDate || getLocalDate(timezone);
    if (!isValidDateKey(localDate)) {
        throw new Error(`Date de journalier invalide: ${localDate}`);
    }

    const [year, month, day] = localDate.split("-");
    const dailyName = `Trans_${day}-${month}-${year}`;
    const replaceExisting = options?.replaceExisting === true;

    const existing = await DailySheet.findOne({
        where: { userId, date: localDate }
    });
    if (existing && !replaceExisting) return existing;

    const drive = await getDriveClient(googleAccount.refreshToken);

    const copy = await drive.files.copy({
        fileId: settings.sheetId,
        requestBody: {
            name: dailyName,
            parents: [googleAccount.dailyFolderId]
        },
        fields: "id,name,webViewLink"
    });

    try {
        // Un journalier ne doit jamais contenir la feuille technique Configuration.
        await removeConfigurationSheet(googleAccount.refreshToken, copy.data.id);

        const values = {
            spreadsheetId: copy.data.id,
            spreadsheetName: copy.data.name,
            date: localDate,
            timezone,
            driveFolderId: googleAccount.dailyFolderId,
            url: copy.data.webViewLink || `https://docs.google.com/spreadsheets/d/${copy.data.id}`,
            scriptId: null
        };

        let dailySheet;
        if (existing) {
            await existing.update(values);
            dailySheet = existing;
        } else {
            dailySheet = await DailySheet.create({ userId, ...values });
        }

        console.log(
            replaceExisting ? "♻️ Journalier recréé:" : "📄 Journalier créé:",
            copy.data.id,
            "pour",
            localDate
        );

        return dailySheet;
    } catch (error) {
        // Si la copie a été créée mais que sa préparation/DB échoue, on évite
        // de laisser un fichier orphelin dans Drive.
        try {
            await drive.files.delete({ fileId: copy.data.id });
        } catch (_) {
            // Nettoyage best-effort uniquement.
        }
        throw error;
    }
}
module.exports = { createDailySheet, getLocalDate };
