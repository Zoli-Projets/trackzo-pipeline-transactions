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

    // Le SMS le plus récent doit toujours être le premier sous l'en-tête.
    // On insère donc de nouvelles lignes à l'index 1 (ligne Sheets 2), au lieu
    // de faire values.append() en bas de la feuille.
    // insertDimension + updateCells sont envoyés dans un même batchUpdate afin
    // de réduire la fenêtre de concurrence entre deux SMS reçus très proches.
    const rowData = rows.map(row => ({
        values: row.slice(0, 5).map(value => ({
            userEnteredValue: { stringValue: String(value ?? "") }
        }))
    }));

    const rawSheetId = await getSheetId(
        sheets,
        spreadsheetId,
        "Transactions brutes"
    );

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    insertDimension: {
                        range: {
                            sheetId: rawSheetId,
                            dimension: "ROWS",
                            startIndex: 1,
                            endIndex: 1 + rows.length
                        },
                        inheritFromBefore: false
                    }
                },
                {
                    updateCells: {
                        start: {
                            sheetId: rawSheetId,
                            rowIndex: 1,
                            columnIndex: 0
                        },
                        rows: rowData,
                        fields: "userEnteredValue"
                    }
                }
            ]
        }
    });

    return true;
}

async function getSheetId(sheets, spreadsheetId, title) {
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties(sheetId,title)"
    });

    const sheet = (response.data.sheets || []).find(
        item => item.properties?.title === title
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
        throw new Error(`Feuille introuvable: ${title}`);
    }

    return sheet.properties.sheetId;
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
