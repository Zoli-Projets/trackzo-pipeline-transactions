const { google } = require("googleapis");

const TECH_SHEET_NAME = "_Trackzo_Technique";
const RAW_SHEET_NAME = "Transactions brutes";

async function getSheetsClient(refreshToken) {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials({ refresh_token: refreshToken });
    return google.sheets({ version: "v4", auth });
}

async function getSheetProperties(sheets, spreadsheetId, title) {
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties(sheetId,title,hidden)"
    });

    return (response.data.sheets || [])
        .map(s => s.properties)
        .find(p => p && p.title === title) || null;
}

async function ensureTechnicalSheet(sheets, spreadsheetId) {
    let tech = await getSheetProperties(sheets, spreadsheetId, TECH_SHEET_NAME);
    if (tech) {
        // La feuille doit rester invisible pour l'utilisateur.
        if (!tech.hidden) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        updateSheetProperties: {
                            properties: { sheetId: tech.sheetId, hidden: true },
                            fields: "hidden"
                        }
                    }]
                }
            });
        }
        return tech.sheetId;
    }

    // Première utilisation sur un journalier existant : création d'une feuille
    // technique cachée pour que le smsHash ne soit plus visible après Status.
    const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                addSheet: {
                    properties: {
                        title: TECH_SHEET_NAME,
                        hidden: true,
                        gridProperties: { rowCount: 1000, columnCount: 2 }
                    }
                }
            }]
        }
    });

    const techSheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (techSheetId == null) {
        throw new Error("Impossible de créer la feuille technique Trackzo");
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${TECH_SHEET_NAME}'!A1:B1`,
        valueInputOption: "RAW",
        requestBody: { values: [["smsHash", "type"]] }
    });

    // Migration automatique des hashes des anciennes versions (colonne E)
    // vers la feuille cachée, puis nettoyage de la colonne visible.
    const legacy = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${RAW_SHEET_NAME}'!E2:E`,
        valueRenderOption: "UNFORMATTED_VALUE"
    });

    const hashes = (legacy.data.values || [])
        .map(r => String(r?.[0] || "").trim())
        .filter(Boolean);

    if (hashes.length > 0) {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${TECH_SHEET_NAME}'!A:B`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: {
                values: hashes.map(hash => [hash, "SMS"])
            }
        });
    }

    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${RAW_SHEET_NAME}'!E2:E`
    });

    return techSheetId;
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
        range: `'${RAW_SHEET_NAME}'!D${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [[status]] }
    });
}

async function readRawMessages(refreshToken, spreadsheetId) {
    const sheets = await getSheetsClient(refreshToken);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${RAW_SHEET_NAME}'!A:D`
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
 * rows garde le format interne [date, heure, message, status, smsHash], mais
 * Transactions brutes n'affiche que A:D. Le hash est écrit dans une feuille
 * cachée dans le MEME batchUpdate que la ligne visible, afin de conserver
 * l'idempotence sans exposer la donnée technique.
 */
async function appendRawRows(refreshToken, spreadsheetId, rows) {
    if (!rows || rows.length === 0) return true;

    const sheets = await getSheetsClient(refreshToken);
    const rawSheet = await getSheetProperties(sheets, spreadsheetId, RAW_SHEET_NAME);
    if (!rawSheet) throw new Error(`Feuille introuvable: ${RAW_SHEET_NAME}`);

    const techSheetId = await ensureTechnicalSheet(sheets, spreadsheetId);

    const visibleRowData = rows.map(row => ({
        values: row.slice(0, 4).map(value => ({
            userEnteredValue: { stringValue: String(value ?? "") }
        }))
    }));

    const hashes = rows
        .map(row => String(row?.[4] || "").trim())
        .filter(Boolean);

    const requests = [
        {
            insertDimension: {
                range: {
                    sheetId: rawSheet.sheetId,
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
                    sheetId: rawSheet.sheetId,
                    rowIndex: 1,
                    columnIndex: 0
                },
                rows: visibleRowData,
                fields: "userEnteredValue"
            }
        }
    ];

    if (hashes.length > 0) {
        requests.push({
            appendCells: {
                sheetId: techSheetId,
                rows: hashes.map(hash => ({
                    values: [
                        { userEnteredValue: { stringValue: hash } },
                        { userEnteredValue: { stringValue: "SMS" } }
                    ]
                })),
                fields: "userEnteredValue"
            }
        });
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });

    return true;
}

async function rawHashExists(refreshToken, spreadsheetId, smsHash) {
    const normalized = String(smsHash || "").trim();
    if (!normalized) return false;

    const sheets = await getSheetsClient(refreshToken);
    await ensureTechnicalSheet(sheets, spreadsheetId);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${TECH_SHEET_NAME}'!A:A`,
        valueRenderOption: "UNFORMATTED_VALUE"
    });

    return (response.data.values || []).some(
        row => String(row?.[0] || "").trim() === normalized
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
