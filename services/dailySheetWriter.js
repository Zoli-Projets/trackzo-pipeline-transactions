const { google } = require("googleapis");

async function getSheetsClient(refreshToken) {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials({ refresh_token: refreshToken });
    return google.sheets({ version: "v4", auth });
}

async function appendRows(refreshToken, spreadsheetId, sheetName, rows) {
    if (!rows || rows.length === 0) return;

    const sheets = await getSheetsClient(refreshToken);

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:G`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows }
    });
}

async function updateStatus(refreshToken, spreadsheetId, rowNumber, status) {
    const sheets = await getSheetsClient(refreshToken);

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Transactions brutes!D${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [[status]] }
    });
}

async function readRawMessages(refreshToken, spreadsheetId) {
    const sheets = await getSheetsClient(refreshToken);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Transactions brutes!A:D"
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    return rows.slice(1).map((row, index) => ({
        rowNumber: index + 2,
        date: row[0] || "",
        time: row[1] || "",
        message: String(row[2] || "").trim(),
        status: String(row[3] || "").trim()
    })).filter(row =>
        row.message &&
        row.status !== "OK" &&
        row.status !== "ERROR"
    );
}

async function readCleanReferences(refreshToken, spreadsheetId) {
    const sheets = await getSheetsClient(refreshToken);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Nettoyé!F:F"
    });

    const rows = response.data.values || [];
    const references = new Set();

    for (let i = 1; i < rows.length; i++) {
        const reference = String(rows[i][0] || "").trim().toUpperCase();
        if (reference) references.add(reference);
    }
    return references;
}

/**
 * A:E est volontaire : E contient le smsHash technique.
 * Le processor continue à lire A:D et ignore donc cette colonne.
 */
async function appendRawRows(refreshToken, spreadsheetId, rows) {
    if (!rows || rows.length === 0) return true;

    const sheets = await getSheetsClient(refreshToken);

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Transactions brutes!A:E",
        // RAW empêche Google Sheets de réinterpréter 07-09-2026 et garantit
        // que Nettoyé/Alerte pourront recopier exactement la valeur affichée.
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows }
    });

    return true;
}

async function rawHashExists(refreshToken, spreadsheetId, smsHash) {
    const sheets = await getSheetsClient(refreshToken);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Transactions brutes!E:E",
        valueRenderOption: "UNFORMATTED_VALUE"
    });

    return (response.data.values || []).some(
        row => String(row[0] || "").trim() === smsHash
    );
}

module.exports = {
    appendRawRows,
    rawHashExists,
    readRawMessages,
    appendRows,
    updateStatus,
    readCleanReferences
};
