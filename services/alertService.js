const { google } = require("googleapis");

function getSheetsClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        refresh_token: refreshToken
    });

    return google.sheets({
        version: "v4",
        auth: oauth2Client
    });
}

async function readAlerts(
    refreshToken,
    spreadsheetId
) {
    const sheets = getSheetsClient(refreshToken);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Alertes!A:G"
    });

    const rows = response.data.values || [];

    return rows.slice(1).map(row => ({
        date: row[0] || "",
        time: row[1] || "",
        amount: row[2] || "0",
        type: row[3] || "",
        operator: row[4] || "",
        reference: row[5] || "",
        message: row[6] || ""
    }));
}

module.exports = {
    readAlerts
};
