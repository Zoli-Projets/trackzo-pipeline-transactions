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
// ACTIVER LE TRIGGER TRACKZO
// ======================================

async function installDailyTrigger(
    refreshToken,
    scriptId
) {

    const script =
        await getScriptClient(refreshToken);


    console.log(
        "⏰ Préparation du trigger Trackzo..."
    );


    /*
     * Pour cette première version,
     * le trigger est installé dans
     * le projet Apps Script du client.
     *
     * La fonction installTrigger()
     * existe déjà dans l'Agent.
     */


    console.log(
        "ℹ️ Script ID :",
        scriptId
    );


    return {
        success: true,
        scriptId: scriptId
    };

}


module.exports = {

    installDailyTrigger

};