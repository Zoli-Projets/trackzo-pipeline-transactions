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

    // Si un ancien journalier a été supprimé, on recrée seulement sa structure.
    // Les anciennes transactions ne sont pas restaurées depuis PostgreSQL :
    // les SMS sont conservés uniquement dans Google Sheets.
    return dailySheet;
}

module.exports = { createDailySheet, getLocalDate };
