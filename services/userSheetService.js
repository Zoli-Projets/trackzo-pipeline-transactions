const { google } = require("googleapis");

const Template = require("../models/Template");
const updateSheetConfiguration = require("./googleSheetsService");
const crypto = require("crypto");
const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");

async function getDriveClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth: oauth2Client });
}

/**
 * Crée le fichier maître directement dans le Drive de l'utilisateur.
 *
 * IMPORTANT : cette opération ne dépend volontairement plus de l'Apps Script API.
 * L'API Apps Script est une API optionnelle et son activation est une préférence
 * de l'utilisateur Google. Elle ne doit donc jamais empêcher la création du maître.
 */
async function createUserMasterSheet(userId) {
    const googleAccount = await GoogleAccount.findOne({ where: { userId } });
    if (!googleAccount) {
        throw new Error("Compte Google non connecté");
    }
    if (!googleAccount.refreshToken) {
        throw new Error("Refresh token Google introuvable. Veuillez reconnecter Google.");
    }

    const template = await Template.findOne({ where: { active: true } });
    if (!template) {
        throw new Error("Aucun modèle Trackzo actif");
    }

    const settings = await UserSettings.findOne({ where: { userId } });
    if (!settings) {
        throw new Error("Paramètres utilisateur introuvables");
    }

    const folderId = googleAccount.trackzoFolderId;
    if (!folderId) {
        throw new Error("Dossier Trackzo absent");
    }

    const drive = await getDriveClient(googleAccount.refreshToken);

    const copy = await drive.files.copy({
        fileId: template.googleFileId,
        requestBody: {
            name: `Trackzo - ${settings.companyName || "Mon entreprise"}`,
            parents: [folderId]
        },
        fields: "id,name,webViewLink"
    });

    const agentToken = crypto.randomBytes(32).toString("hex");

    // Le maître est autonome côté données. Aucun appel à script.projects.create ici.
    await UserSettings.update(
        {
            sheetId: copy.data.id,
            sheetUrl: `https://docs.google.com/spreadsheets/d/${copy.data.id}`,
            sheetName: copy.data.name,
            sheetCreated: true,
            scriptId: null,
            templateId: template.id,
            lastTemplateVersion: template.version,
            agentToken
        },
        { where: { userId } }
    );

    await updateSheetConfiguration(
        googleAccount.refreshToken,
        copy.data.id,
        {
            companyName: settings.companyName || "Mon entreprise",
            country: settings.country || "CI",
            timezone: settings.timezone || "Africa/Abidjan",
            openingTime: settings.openingTime || "08:00",
            closingTime: settings.closingTime || "22:00"
        }
    );

    console.log("📄 Maître client créé:", copy.data.id);
    console.log("⚙️ Configuration maître appliquée");

    return copy.data;
}

module.exports = { createUserMasterSheet };
