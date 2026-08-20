const { google } = require("googleapis");

const {
    classifyMessage
} = require("./transactionClassifierService");

const {
    updateStatisticsSheet
} = require("./statisticsSheetService");

async function getSheetsClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.sheets({ version: "v4", auth: oauth2Client });
}

function formatDate(value) {
    if (!value) return "";
    if (value instanceof Date) return value;
    return String(value);
}

function formatTime(value) {
    if (!value) return "00:00:00";
    const text = String(value);
    if (/^\d{1,2}:\d{2}$/.test(text)) return `${text}:00`;
    return text;
}

async function readRawRows(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Transactions brutes'!A:D",
        valueRenderOption: "UNFORMATTED_VALUE"
    });

    const rows = response.data.values || [];
    return rows.slice(1)
        .map((row, index) => ({
            rowNumber: index + 2,
            date: formatDate(row[0]),
            time: formatTime(row[1]),
            message: String(row[2] || "").trim(),
            status: String(row[3] || "").trim().toUpperCase()
        }))
        .filter(row => row.message && row.status !== "OK" && row.status !== "ERROR");
}

async function readExistingReferences(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Nettoyé'!F:F",
        valueRenderOption: "UNFORMATTED_VALUE"
    });

    const references = new Set();
    for (const row of (response.data.values || []).slice(1)) {
        const ref = String(row[0] || "").trim().toUpperCase();
        if (ref) references.add(ref);
    }
    return references;
}

async function appendRows(sheets, spreadsheetId, sheetName, rows) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A:G`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows }
    });
}

async function markProcessed(sheets, spreadsheetId, processed) {
    for (const item of processed) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'Transactions brutes'!D${item.rowNumber}`,
            valueInputOption: "RAW",
            requestBody: { values: [["OK"]] }
        });
    }
}

async function processDailySheet(refreshToken, spreadsheetId) {
    const sheets = await getSheetsClient(refreshToken);
    const rawRows = await readRawRows(sheets, spreadsheetId);

    if (!rawRows.length) {
        const stats = await updateStatisticsSheet(refreshToken, spreadsheetId);
        return { processed: 0, cleaned: 0, alerts: 0, errors: 0, statistics: stats };
    }

    const existingReferences = await readExistingReferences(sheets, spreadsheetId);
    const cleanRows = [];
    const alertRows = [];
    const processed = [];
    let errors = 0;

    for (const raw of rawRows) {
        try {
            const result = classifyMessage(raw.message);

            const amount = result.amount?.value || 0;
            const amountDisplay = result.amount?.display || (amount ? `${amount} FCFA` : "0");
            const type = result.type || "Autre";
            const operator = result.operator || "Inconnu";
            const reference = result.reference || "";

            const row = [
                raw.date,
                raw.time,
                amountDisplay,
                type,
                operator,
                reference,
                raw.message
            ];

            const nonTransaction =
                !result.isTransaction ||
                result.confidence < 0.70;

            const insufficient =
                amount <= 0 ||
                operator === "Inconnu" ||
                type === "Autre";

            const duplicate =
                Boolean(reference) &&
                existingReferences.has(reference.toUpperCase());

            if (nonTransaction || insufficient || duplicate) {
                alertRows.push(row);
            } else {
                cleanRows.push(row);
                if (reference) existingReferences.add(reference.toUpperCase());

                if (amount > 1000000) {
                    alertRows.push(row);
                }
            }

            processed.push(raw);
        } catch (error) {
            errors++;
            console.error("Erreur traitement ligne", raw.rowNumber, error);

            alertRows.push([
                raw.date, raw.time, 0,
                "Erreur traitement", "", "", raw.message
            ]);
            processed.push(raw);
        }
    }

    await appendRows(sheets, spreadsheetId, "Nettoyé", cleanRows);
    await appendRows(sheets, spreadsheetId, "Alertes", alertRows);
    await markProcessed(sheets, spreadsheetId, processed);

    const statistics = await updateStatisticsSheet(
        refreshToken,
        spreadsheetId
    );

    return {
        processed: processed.length,
        cleaned: cleanRows.length,
        alerts: alertRows.length,
        errors,
        statistics
    };
}

module.exports = { processDailySheet };
