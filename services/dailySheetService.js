const { google } = require("googleapis");

const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");
const DailySheet = require("../models/DailySheet");

const {
    createBoundScriptProject,
    installTrackzoAgent
} = require("./appsScriptService");



// ======================================
// CLIENT GOOGLE DRIVE
// ======================================

async function getDriveClient(refreshToken) {

    const oauth2Client =
        new google.auth.OAuth2(

            process.env.GOOGLE_CLIENT_ID,

            process.env.GOOGLE_CLIENT_SECRET,

            process.env.GOOGLE_REDIRECT_URI

        );

    oauth2Client.setCredentials({
        refresh_token: refreshToken
    });

    return google.drive({
        version: "v3",
        auth: oauth2Client
    });
}


// ======================================
// DATE LOCALE DU CLIENT
// ======================================

function getLocalDate(timezone) {

    const formatter =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone: timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );

    return formatter.format(new Date());
}


// ======================================
// CRÉER LE JOURNALIER
// ======================================

async function createDailySheet(userId) {

    const settings =
        await UserSettings.findOne({
            where: {
                userId: userId
            }
        });

    if (!settings) {
        throw new Error(
            "Paramètres utilisateur introuvables"
        );
    }


    const googleAccount =
        await GoogleAccount.findOne({
            where: {
                userId: userId
            }
        });

    if (!googleAccount) {
        throw new Error(
            "Compte Google non connecté"
        );
    }


    if (!googleAccount.dailyFolderId) {
        throw new Error(
            "Dossier Journaliers introuvable"
        );
    }


    if (!settings.sheetId) {
        throw new Error(
            "Maître Trackzo introuvable"
        );
    }


    const timezone =
        settings.timezone ||
        "Africa/Abidjan";


    const localDate =
        getLocalDate(timezone);


    console.log(
        "📅 Date locale:",
        localDate
    );


    // ======================================
    // ÉVITER LES DOUBLONS
    // ======================================

    const existing =
        await DailySheet.findOne({

            where: {
                userId: userId,
                date: localDate
            }

        });


    if (existing) {

        console.log(
            "📄 Journalier déjà existant:",
            existing.spreadsheetId
        );

        return existing;

    }


    // ======================================
    // GOOGLE DRIVE
    // ======================================

    const drive =
        await getDriveClient(
            googleAccount.refreshToken
        );


    // ======================================
    // NOM DU FICHIER
    // ======================================

    const fileName =
        localDate;


    // ======================================
    // COPIE DU MAÎTRE
    // ======================================

    const copy =
        await drive.files.copy({

            fileId:
                settings.sheetId,

            requestBody: {

                name:
                    fileName,

                parents: [
                    googleAccount.dailyFolderId
                ]

            },

            fields:
                "id,name,webViewLink"

        });
    
        // ======================================
       // INSTALLER L'AGENT SUR LE JOURNALIER
      // ======================================

let dailyScriptId = null;

try {

    console.log(
        "🧩 Installation agent sur le journalier..."
    );

    const scriptProject =
        await createBoundScriptProject(

            googleAccount.refreshToken,

            copy.data.id,

            `Trackzo Daily Agent - ${localDate}`

        );


    dailyScriptId =
        scriptProject.scriptId;


    await installTrackzoAgent(

        googleAccount.refreshToken,

        dailyScriptId,

        settings.agentToken,

        timezone,

        settings.dailySheetCreation,

        false

    );


    console.log(
        "✅ Agent installé sur le journalier:",
        dailyScriptId
    );

}
catch (agentError) {

    console.error(
        "⚠️ Impossible d'installer l'agent du journalier:",
        agentError.message
    );

}

    console.log(
        "📄 Journalier créé:",
        copy.data.id
    );


    // ======================================
    // ENREGISTRER EN BASE
    // ======================================

    const dailySheet =
        await DailySheet.create({

            userId: userId,

            spreadsheetId:
                copy.data.id,

            spreadsheetName:
                copy.data.name,

            date:
                localDate,

            timezone:
                timezone,

            driveFolderId:
                googleAccount.dailyFolderId,

            url:
                `https://docs.google.com/spreadsheets/d/${copy.data.id}`,

            scriptId:
                 dailyScriptId



        });


    console.log(
        "✅ Journalier enregistré en SQL"
    );


    return dailySheet;

}


module.exports = {
    createDailySheet,
    getLocalDate
};