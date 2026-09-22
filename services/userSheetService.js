const { google } = require("googleapis");

const Template = require("../models/Template");
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
 * Création du maître utilisateur avec drive.file + Sheets copyTo
 *
 * Le fichier final est créé par le token OAuth de l'utilisateur (drive.file).
 * Le service account, qui voit le modèle central, copie les feuilles utilisateur
 * avec spreadsheets.sheets.copyTo. La feuille Configuration reste interne à Trackzo.
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
        console.log("📄 Création du maître client");
        const created = await userSheets.spreadsheets.create({
            requestBody: {
                properties: { title: `Trackzo - ${settings.companyName || "Mon entreprise"}` }
            },
            fields: "spreadsheetId,spreadsheetUrl,sheets.properties"
        });
        destinationId = created.data.spreadsheetId;
        const defaultSheetId = created.data.sheets?.[0]?.properties?.sheetId;

        
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

        
        const permission = await userDrive.permissions.create({
            fileId: destinationId,
            requestBody: { type: "user", role: "writer", emailAddress: serviceEmail },
            fields: "id"
        });
        servicePermissionId = permission.data.id;

        
        const source = await adminSheets.spreadsheets.get({
            spreadsheetId: template.googleFileId,
            includeGridData: false,
            fields: "properties,sheets.properties,namedRanges,developerMetadata"
        });
        const allSourceSheets = source.data.sheets || [];
        // La feuille Configuration est strictement interne à Trackzo et ne doit
        // jamais être copiée dans le maître appartenant à l'utilisateur.
        const sourceSheets = allSourceSheets.filter(
            sheet => (sheet.properties?.title || "").trim().toLowerCase() !== "configuration"
        );
        if (!sourceSheets.length) throw new Error("Le modèle maître ne contient aucune feuille utilisateur");

        
        const copiedSheets = [];
        for (const sheet of sourceSheets) {
            const title = sheet.properties?.title || String(sheet.properties?.sheetId);
            
            const copied = await adminSheets.spreadsheets.sheets.copyTo({
                spreadsheetId: template.googleFileId,
                sheetId: sheet.properties.sheetId,
                requestBody: { destinationSpreadsheetId: destinationId }
            });

            // Renommer immédiatement la feuille copiée. copyTo ajoute sinon
            // automatiquement « Copie de ... » au titre de la feuille.
            await adminSheets.spreadsheets.batchUpdate({
                spreadsheetId: destinationId,
                requestBody: {
                    requests: [{
                        updateSheetProperties: {
                            properties: { sheetId: copied.data.sheetId, title },
                            fields: "title"
                        }
                    }]
                }
            });

            copiedSheets.push({
                sheetId: copied.data.sheetId,
                title,
                index: copiedSheets.length
            });
        }

        if (defaultSheetId != null) {
            await userSheets.spreadsheets.batchUpdate({
                spreadsheetId: destinationId,
                requestBody: { requests: [{ deleteSheet: { sheetId: defaultSheetId } }] }
            });
        }

        // Les titres ont déjà été restaurés immédiatement après chaque copyTo.
        // Ici, on fixe également leur ordre final pour reproduire l'ordre du maître
        // (hors feuille Configuration, volontairement réservée à l'administration).
        await userSheets.spreadsheets.batchUpdate({
            spreadsheetId: destinationId,
            requestBody: {
                requests: copiedSheets
                    .sort((a, b) => a.index - b.index)
                    .map((sheet, index) => ({
                        updateSheetProperties: {
                            properties: {
                                sheetId: sheet.sheetId,
                                title: sheet.title,
                                index
                            },
                            fields: "title,index"
                        }
                    }))
            }
        });
        

        
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

        console.log("📋 Vérification du maître client:", {
            feuillesMaitre: srcTitles,
            feuillesCopie: dstTitles,
            ordreEtNomsIdentiques: sameTitles,
            namedRangesMaitre: srcNamedRanges,
            namedRangesCopie: dstNamedRanges,
            developerMetadataMaitre: srcMetadata,
            developerMetadataCopie: dstMetadata
        });

        
        await userDrive.permissions.delete({ fileId: destinationId, permissionId: servicePermissionId });
        servicePermissionId = null;

        // Vérification finale : le token drive.file de l'utilisateur doit toujours lire le classeur.
        await userDrive.files.get({ fileId: destinationId, fields: "id,name,parents" });
        await userSheets.spreadsheets.get({ spreadsheetId: destinationId, fields: "spreadsheetId,properties.title" });
        

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

        console.log("✅ Maître client créé:", destinationId);
        console.log("🔒 Feuille Configuration non copiée (réservée à Trackzo)");
        return { id: destinationId, name: `Trackzo - ${settings.companyName || "Mon entreprise"}`, webViewLink: `https://docs.google.com/spreadsheets/d/${destinationId}` };
    } catch (error) {
        console.error("❌ Erreur création maître client:", error?.response?.data || error?.message || error);
        if (destinationId && servicePermissionId) {
            try {
                await userDrive.permissions.delete({ fileId: destinationId, permissionId: servicePermissionId });
                console.log("🧹 Permission temporaire nettoyée après échec");
            } catch (cleanupError) {
                console.error("❌ Nettoyage permission temporaire impossible:", cleanupError?.response?.data || cleanupError?.message);
            }
        }
        throw error;
    }
}

module.exports = { createUserMasterSheet };
