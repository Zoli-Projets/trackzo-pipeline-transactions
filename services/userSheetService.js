const { google } = require("googleapis");

const Template = require("../models/Template");
const updateSheetConfiguration = require("./googleSheetsService");
const crypto = require("crypto");
const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");
const adminAuth = require("./googleDriveAdminService");

function getUserAuth(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}

function getServiceAccountEmail() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        return credentials.client_email;
    }
    // En local, GoogleAuth chargera le fichier; l'adresse sera lue depuis le client auth.
    return null;
}

/**
 * TEST drive.file + Sheets copyTo
 *
 * Le fichier final est créé par le token OAuth de l'utilisateur (drive.file),
 * puis le service account, qui voit le modèle central, copie nativement chaque
 * feuille avec spreadsheets.sheets.copyTo. Aucun traitement transactionnel n'est touché.
 */
async function createUserMasterSheet(userId) {
    const googleAccount = await GoogleAccount.findOne({ where: { userId } });
    if (!googleAccount) throw new Error("Compte Google non connecté");
    if (!googleAccount.refreshToken) throw new Error("Refresh token Google introuvable. Veuillez reconnecter Google.");

    const template = await Template.findOne({ where: { active: true } });
    if (!template) throw new Error("Aucun modèle Trackzo actif");

    const settings = await UserSettings.findOne({ where: { userId } });
    if (!settings) throw new Error("Paramètres utilisateur introuvables");

    const folderId = googleAccount.trackzoFolderId;
    if (!folderId) throw new Error("Dossier Trackzo absent");

    const userAuth = getUserAuth(googleAccount.refreshToken);
    const userDrive = google.drive({ version: "v3", auth: userAuth });
    const userSheets = google.sheets({ version: "v4", auth: userAuth });

    let destinationId = null;
    let servicePermissionId = null;

    try {
        console.log("[COPYTO TEST] 1/7 Création du classeur destination par l'utilisateur (drive.file)");
        const created = await userSheets.spreadsheets.create({
            requestBody: {
                properties: { title: `Trackzo - ${settings.companyName || "Mon entreprise"}` }
            },
            fields: "spreadsheetId,spreadsheetUrl,sheets.properties"
        });
        destinationId = created.data.spreadsheetId;
        const defaultSheetId = created.data.sheets?.[0]?.properties?.sheetId;

        console.log("[COPYTO TEST] 2/7 Déplacement du classeur dans le dossier Trackzo");
        const current = await userDrive.files.get({ fileId: destinationId, fields: "parents" });
        await userDrive.files.update({
            fileId: destinationId,
            addParents: folderId,
            removeParents: (current.data.parents || []).join(",") || undefined,
            fields: "id,parents"
        });

        const adminClient = await adminAuth.getClient();
        const adminSheets = google.sheets({ version: "v4", auth: adminClient });
        let serviceEmail = getServiceAccountEmail();
        if (!serviceEmail && adminClient.email) serviceEmail = adminClient.email;
        if (!serviceEmail) throw new Error("Adresse e-mail du service account introuvable");

        console.log("[COPYTO TEST] 3/7 Partage temporaire de la destination avec le service account");
        const permission = await userDrive.permissions.create({
            fileId: destinationId,
            requestBody: { type: "user", role: "writer", emailAddress: serviceEmail },
            fields: "id"
        });
        servicePermissionId = permission.data.id;

        console.log("[COPYTO TEST] 4/7 Lecture du maître par le service account");
        const source = await adminSheets.spreadsheets.get({
            spreadsheetId: template.googleFileId,
            includeGridData: false,
            fields: "properties,sheets.properties,namedRanges,developerMetadata"
        });
        const sourceSheets = source.data.sheets || [];
        if (!sourceSheets.length) throw new Error("Le modèle maître ne contient aucune feuille");

        console.log(`[COPYTO TEST] 5/7 Copie native copyTo de ${sourceSheets.length} feuille(s)`);
        for (const sheet of sourceSheets) {
            const title = sheet.properties?.title || String(sheet.properties?.sheetId);
            console.log(`[COPYTO TEST] copyTo: ${title}`);
            await adminSheets.spreadsheets.sheets.copyTo({
                spreadsheetId: template.googleFileId,
                sheetId: sheet.properties.sheetId,
                requestBody: { destinationSpreadsheetId: destinationId }
            });
        }

        if (defaultSheetId != null) {
            await userSheets.spreadsheets.batchUpdate({
                spreadsheetId: destinationId,
                requestBody: { requests: [{ deleteSheet: { sheetId: defaultSheetId } }] }
            });
        }

        console.log("[COPYTO TEST] 6/7 Comparaison structure maître / destination");
        const dest = await userSheets.spreadsheets.get({
            spreadsheetId: destinationId,
            includeGridData: false,
            fields: "properties,sheets.properties,namedRanges,developerMetadata"
        });
        const srcTitles = sourceSheets.map(s => s.properties?.title);
        const dstTitles = (dest.data.sheets || []).map(s => s.properties?.title);
        const sameTitles = JSON.stringify(srcTitles) === JSON.stringify(dstTitles);
        const srcNamedRanges = (source.data.namedRanges || []).length;
        const dstNamedRanges = (dest.data.namedRanges || []).length;
        const srcMetadata = (source.data.developerMetadata || []).length;
        const dstMetadata = (dest.data.developerMetadata || []).length;

        console.log("[COPYTO TEST] COMPARAISON:", {
            feuillesMaitre: srcTitles,
            feuillesCopie: dstTitles,
            ordreEtNomsIdentiques: sameTitles,
            namedRangesMaitre: srcNamedRanges,
            namedRangesCopie: dstNamedRanges,
            developerMetadataMaitre: srcMetadata,
            developerMetadataCopie: dstMetadata
        });

        console.log("[COPYTO TEST] 7/7 Retrait du partage temporaire");
        await userDrive.permissions.delete({ fileId: destinationId, permissionId: servicePermissionId });
        servicePermissionId = null;

        // Vérification finale : le token drive.file de l'utilisateur doit toujours lire le classeur.
        await userDrive.files.get({ fileId: destinationId, fields: "id,name,parents" });
        await userSheets.spreadsheets.get({ spreadsheetId: destinationId, fields: "spreadsheetId,properties.title" });
        console.log("[COPYTO TEST] SUCCÈS: destination accessible avec drive.file après retrait du partage temporaire");

        const agentToken = crypto.randomBytes(32).toString("hex");
        await UserSettings.update({
            sheetId: destinationId,
            sheetUrl: `https://docs.google.com/spreadsheets/d/${destinationId}`,
            sheetName: `Trackzo - ${settings.companyName || "Mon entreprise"}`,
            sheetCreated: true,
            scriptId: null,
            templateId: template.id,
            lastTemplateVersion: template.version,
            agentToken
        }, { where: { userId } });

        await updateSheetConfiguration(googleAccount.refreshToken, destinationId, {
            companyName: settings.companyName || "Mon entreprise",
            country: settings.country || "CI",
            timezone: settings.timezone || "Africa/Abidjan",
            openingTime: settings.openingTime || "08:00",
            closingTime: settings.closingTime || "22:00"
        });

        console.log("📄 Maître client créé par COPYTO TEST:", destinationId);
        console.log("⚙️ Configuration maître appliquée");
        return { id: destinationId, name: `Trackzo - ${settings.companyName || "Mon entreprise"}`, webViewLink: `https://docs.google.com/spreadsheets/d/${destinationId}` };
    } catch (error) {
        console.error("[COPYTO TEST] ÉCHEC:", error?.response?.data || error?.message || error);
        if (destinationId && servicePermissionId) {
            try {
                await userDrive.permissions.delete({ fileId: destinationId, permissionId: servicePermissionId });
                console.log("[COPYTO TEST] Partage temporaire nettoyé après échec");
            } catch (cleanupError) {
                console.error("[COPYTO TEST] Nettoyage permission impossible:", cleanupError?.response?.data || cleanupError?.message);
            }
        }
        throw error;
    }
}

module.exports = { createUserMasterSheet };
