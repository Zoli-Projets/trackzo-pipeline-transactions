const { google } = require("googleapis");


// ======================================
// CLIENT APPS SCRIPT
// ======================================

async function getScriptClient(refreshToken) {

    const oauth2Client =
        new google.auth.OAuth2(

            process.env.GOOGLE_CLIENT_ID,

            process.env.GOOGLE_CLIENT_SECRET,

            process.env.GOOGLE_REDIRECT_URI

        );

    oauth2Client.setCredentials({
        refresh_token: refreshToken
    });

    return google.script({
        version: "v1",
        auth: oauth2Client
    });
}



// ======================================
// CRÉER PROJET APPS SCRIPT LIÉ AU SHEET
// ======================================

async function createBoundScriptProject(
    refreshToken,
    sheetId,
    projectName
) {

    const script =
        await getScriptClient(refreshToken);

    const response =
        await script.projects.create({

            requestBody: {

                title:
                    projectName || "Trackzo Agent",

                parentId:
                    sheetId

            }

        });

    console.log(
        "🧩 Projet Apps Script créé :",
        response.data.scriptId
    );

    return response.data;
}



// ======================================
// INSTALLER L'AGENT TRACKZO
// ======================================

async function installTrackzoAgent(
    refreshToken,
    scriptId,
    agentToken,
    timezone = "Africa/Abidjan",
    dailySheetCreation = "00:05",
    isMaster = true
) {

    const script =
        await getScriptClient(refreshToken);
        


    const backendUrl =
        process.env.TRACKZO_BACKEND_URL ||
        "https://mobile-money-backend.onrender.com";

    const creationTime =
        dailySheetCreation || "00:05";

    const [hour, minute] =
        creationTime.split(":").map(Number);

    const safeHour =
        Number.isInteger(hour) &&
        hour >= 0 &&
        hour <= 23
            ? hour
            : 0;
    
    const safeMinute =
        Number.isInteger(minute) &&
        minute >= 0 &&
        minute <= 59
            ? minute
            : 5;

    const safeTimezone =
        timezone ||
        "Africa/Abidjan";


    const files = [

        {
            name: "Code",

            type: "SERVER_JS",

            source: `

const TRACKZO_BACKEND =
    "${backendUrl}";

const TRACKZO_AGENT_TOKEN =
    "${agentToken}";

const TRACKZO_TIMEZONE =
    ${JSON.stringify(safeTimezone)};

const TRACKZO_DAILY_HOUR =
    ${safeHour};

const TRACKZO_DAILY_MINUTE =
    ${safeMinute};

const TRACKZO_DAILY_CREATION =
    "${dailySheetCreation || "00:05"}";

const TRACKZO_IS_MASTER =
    ${isMaster ? "true" : "false"};


// ======================================
// MENU TRACKZO
// ======================================

function onOpen() {

    SpreadsheetApp
        .getUi()
        .createMenu("Trackzo")
        .addItem(
            "Synchroniser maintenant",
            "dailyJob"
        )
        .addItem(
            "Installer le trigger",
            "installTrigger"
        )
        .addToUi();

}


// ======================================
// INSTALLATION DU TRIGGER
// ======================================

function installTrigger() {

    const triggers =
        ScriptApp.getProjectTriggers();

    triggers.forEach(function(trigger) {

        if (
            trigger.getHandlerFunction()
            === "processTrackzo"
        ) {

            ScriptApp.deleteTrigger(
                trigger
            );

        }

    });


    ScriptApp
        .newTrigger("processTrackzo")
        .timeBased()
        .everyMinutes(1)
        .create();
 
    Logger.log(
        "✅ Trigger Trackzo installé"
    );
}



function processTrackzo() {

    try {

        const spreadsheetId =
            SpreadsheetApp
                .getActiveSpreadsheet()
                .getId();


        const response =
            UrlFetchApp.fetch(

                TRACKZO_BACKEND +
                "/api/trackzo/process-daily-sheet",

                {

                    method: "post",

                    contentType:
                        "application/json",

                    payload:
                        JSON.stringify({

                            agentToken:
                                TRACKZO_AGENT_TOKEN,

                            spreadsheetId

                        }),

                    muteHttpExceptions:
                        true

                }

            );


        Logger.log(
            response.getContentText()
        );

    }
    catch (error) {

        Logger.log(
            "❌ Trackzo : " +
            error.message
        );

    }

}

// ======================================
// SYNCHRONISATION
// ======================================

function dailyJob() {

    try {

        const spreadsheetId =
            SpreadsheetApp
                .getActiveSpreadsheet()
                .getId();


        let endpoint;


        if (TRACKZO_IS_MASTER) {

            endpoint =
                TRACKZO_BACKEND +
                "/api/trackzo/daily-sync";

        }
        else {

            endpoint =
                TRACKZO_BACKEND +
                "/api/trackzo/process-daily-sheet";

        }


        const response =
            UrlFetchApp.fetch(

                endpoint,

                {

                    method: "post",

                    contentType:
                        "application/json",

                    payload:
                        JSON.stringify({

                            agentToken:
                                TRACKZO_AGENT_TOKEN,

                            spreadsheetId:
                                spreadsheetId

                        }),

                    muteHttpExceptions:
                        true

                }

            );


        Logger.log(
            response.getContentText()
        );

    }
    catch(error) {

        Logger.log(
            "❌ Erreur Trackzo : "
            + error.message
        );

    }

}

`

        }

    ];


    await script.projects.updateContent({

        scriptId: scriptId,

        requestBody: {

            files: files

        }

    });


    console.log(
        "✅ Agent Trackzo installé"
    );

}


module.exports = {

    getScriptClient,

    createBoundScriptProject,

    installTrackzoAgent

};