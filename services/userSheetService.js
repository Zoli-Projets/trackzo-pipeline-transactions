const { google } = require("googleapis");

const Template = require("../models/Template");
const updateSheetConfiguration = require("./googleSheetsService");
const adminAuth = require("./googleDriveAdminService");
const crypto = require("crypto");
const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");

async function getUserOAuthClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}

async function getDriveClient(refreshToken) {
    return google.drive({ version: "v3", auth: await getUserOAuthClient(refreshToken) });
}

function getServiceAccountEmail() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        if (credentials.client_email) return credentials.client_email;
    }

    // En local, GoogleAuth connaît le compte après chargement des credentials.
    return null;
}

/**
 * TEST CIBLE drive.file + copie native stricte du maître.
 *
 * Le reste du fonctionnement Trackzo n'est pas modifié :
 * - le dossier Trackzo reste créé par le token utilisateur drive.file ;
 * - le modèle est toujours dupliqué par Drive files.copy() ;
 * - aucune reconstruction des feuilles/cellules n'est effectuée.
 *
 * Pour contourner l'impossibilité du token drive.file de lire le modèle central :
 * 1) l'utilisateur partage temporairement SON dossier Trackzo avec le service account ;
 * 2) le service account, qui doit déjà avoir accès au modèle central, exécute files.copy() ;
 * 3) le token utilisateur drive.file vérifie immédiatement qu'il peut lire la copie
 *    via Drive ET Sheets avant que Trackzo ne l'enregistre comme maître.
 *
 * C'est volontairement un test : les logs [DRIVE.FILE TEST] permettent d'identifier
 * précisément l'étape bloquante sans toucher aux traitements de transactions.
 */
async function createUserMasterSheet(userId) {
    const googleAccount = await GoogleAccount.findOne({ where: { userId } });
    if (!googleAccount) throw new Error("Compte Google non connecté");
    if (!googleAccount.refreshToken) {
        throw new Error("Refresh token Google introuvable. Veuillez reconnecter Google.");
    }

    const template = await Template.findOne({ where: { active: true } });
    if (!template) throw new Error("Aucun modèle Trackzo actif");

    const settings = await UserSettings.findOne({ where: { userId } });
    if (!settings) throw new Error("Paramètres utilisateur introuvables");

    const folderId = googleAccount.trackzoFolderId;
    if (!folderId) throw new Error("Dossier Trackzo absent");

    const userAuth = await getUserOAuthClient(googleAccount.refreshToken);
    const userDrive = google.drive({ version: "v3", auth: userAuth });
    const userSheets = google.sheets({ version: "v4", auth: userAuth });

    const serviceEmail = getServiceAccountEmail();
    if (!serviceEmail) {
        throw new Error(
            "[DRIVE.FILE TEST] GOOGLE_SERVICE_ACCOUNT doit contenir client_email sur Render"
        );
    }

    console.log("[DRIVE.FILE TEST] 1/5 Partage temporaire du dossier Trackzo avec le service account");
    const permission = await userDrive.permissions.create({
        fileId: folderId,
        requestBody: {
            type: "user",
            role: "writer",
            emailAddress: serviceEmail
        },
        fields: "id"
    });

    let copy;
    try {
        console.log("[DRIVE.FILE TEST] 2/5 Copie native files.copy() du maître par le service account");
        const adminDrive = google.drive({ version: "v3", auth: adminAuth });

        copy = await adminDrive.files.copy({
            fileId: template.googleFileId,
            requestBody: {
                name: `Trackzo - ${settings.companyName || "Mon entreprise"}`,
                parents: [folderId]
            },
            fields: "id,name,webViewLink,owners,parents"
        });

        console.log("[DRIVE.FILE TEST] Copie créée:", copy.data.id);

        console.log("[DRIVE.FILE TEST] 3/5 Vérification Drive avec le token utilisateur drive.file");
        await userDrive.files.get({
            fileId: copy.data.id,
            fields: "id,name,mimeType,parents"
        });
        console.log("[DRIVE.FILE TEST] Accès Drive utilisateur: OK");

        console.log("[DRIVE.FILE TEST] 4/5 Vérification Sheets avec le même token drive.file");
        await userSheets.spreadsheets.get({
            spreadsheetId: copy.data.id,
            fields: "spreadsheetId,properties.title,sheets.properties"
        });
        console.log("[DRIVE.FILE TEST] Accès Sheets utilisateur: OK");

        // On retire le partage temporaire du dossier puis on revérifie : le test doit
        // prouver que Trackzo ne dépend pas d'un partage serveur permanent.
        console.log("[DRIVE.FILE TEST] 5/5 Retrait du partage temporaire puis nouvelle vérification");
        await userDrive.permissions.delete({
            fileId: folderId,
            permissionId: permission.data.id
        });

        await userDrive.files.get({
            fileId: copy.data.id,
            fields: "id,name"
        });
        await userSheets.spreadsheets.get({
            spreadsheetId: copy.data.id,
            fields: "spreadsheetId,properties.title"
        });
        console.log("[DRIVE.FILE TEST] SUCCÈS: copie native accessible après retrait du partage temporaire");
    } catch (error) {
        console.error(
            "[DRIVE.FILE TEST] ÉCHEC:",
            error?.response?.data || error?.message || error
        );

        // Nettoyage best-effort du partage temporaire en cas d'échec.
        try {
            if (permission?.data?.id) {
                await userDrive.permissions.delete({
                    fileId: folderId,
                    permissionId: permission.data.id
                });
                console.log("[DRIVE.FILE TEST] Partage temporaire nettoyé après échec");
            }
        } catch (cleanupError) {
            console.error(
                "[DRIVE.FILE TEST] Nettoyage permission impossible:",
                cleanupError?.response?.data || cleanupError?.message || cleanupError
            );
        }
        throw error;
    }

    const agentToken = crypto.randomBytes(32).toString("hex");

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
