const { google } = require("googleapis");
const {
    classifyMessage
} = require("./transactionClassifierService");

const UserSettings = require("../models/UserSettings");
const GoogleAccount = require("../models/GoogleAccount");
const DailySheet = require("../models/DailySheet");

const HEADERS = [
    "Date",
    "Heure",
    "Montant",
    "Type",
    "Opérateur",
    "Référence",
    "Message"
];

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

function normalizeDate(value, timezone) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(value).replace(/\//g, "-");
    }

    const text = String(value || "").trim();

    if (!text) {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(new Date()).replace(/\//g, "-");
    }

    return text;
}

function normalizeTime(value, timezone) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(value);
    }

    const text = String(value || "").trim();

    if (/^\d{1,2}:\d{2}$/.test(text)) return `${text}:00`;
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) return text;

    return "00:00:00";
}

function normalizeReference(reference) {
    return String(reference || "")
        .trim()
        .toUpperCase();
}

async function readRawRows(sheets, spreadsheetId, maxRows) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `Transactions brutes!A2:D${Math.max(2, maxRows + 1)}`
    });

    return response.data.values || [];
}

async function readExistingCleanReferences(
    sheets,
    spreadsheetId
) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Nettoyé!F:F"
    });

    const rows = response.data.values || [];

    return new Set(
        rows
            .slice(1)
            .map(row => normalizeReference(row[0]))
            .filter(Boolean)
    );
}

async function appendRows(
    sheets,
    spreadsheetId,
    sheetName,
    rows
) {
    if (!rows.length) return;

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:G`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
            values: rows
        }
    });
}

async function markRowsProcessed(
    sheets,
    spreadsheetId,
    sourceRows
) {
    if (!sourceRows.length) return;

    // D = statut. On écrit chaque cellule pour éviter de toucher
    // aux trois premières colonnes du fichier source.
    const data = sourceRows.map(row => ({
        range: `Transactions brutes!D${row.rowNumber}`,
        values: [["OK"]]
    }));

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: "RAW",
            data
        }
    });
}

async function processDailySheet({
    userId,
    spreadsheetId,
    maxRows = 1000
}) {
    const settings = await UserSettings.findOne({
        where: { userId }
    });

    if (!settings) {
        throw new Error("Paramètres utilisateur introuvables");
    }

    const dailySheet = await DailySheet.findOne({
        where: {
            userId,
            spreadsheetId
        }
    });

    if (!dailySheet) {
        throw new Error("Journalier introuvable pour cet utilisateur");
    }

    const googleAccount = await GoogleAccount.findOne({
        where: { userId }
    });

    if (!googleAccount) {
        throw new Error("Compte Google non connecté");
    }

    const sheets = getSheetsClient(
        googleAccount.refreshToken
    );

    const rawRows = await readRawRows(
        sheets,
        spreadsheetId,
        maxRows
    );

    const existingRefs = await readExistingCleanReferences(
        sheets,
        spreadsheetId
    );

    const cleanRows = [];
    const alertRows = [];
    const processed = [];
    const stats = {
        read: 0,
        transactions: 0,
        alerts: 0,
        duplicates: 0,
        promotions: 0,
        errors: 0
    };

    for (let index = 0; index < rawRows.length; index++) {
        const row = rawRows[index];
        const rowNumber = index + 2;

        const date = row[0] || "";
        const time = row[1] || "";
        const message = String(row[2] || "").trim();
        const status = String(row[3] || "").trim().toUpperCase();

        if (!message || status === "OK") continue;

        stats.read++;

        try {
            const parsed = classifyMessage(message);

            const cleanDate = normalizeDate(
                date,
                settings.timezone || "Africa/Abidjan"
            );

            const cleanTime = normalizeTime(
                time,
                settings.timezone || "Africa/Abidjan"
            );

            const reference = normalizeReference(
                parsed.reference
            );

            if (!parsed.isTransaction) {
                alertRows.push([
                    cleanDate,
                    cleanTime,
                    parsed.amount.display,
                    parsed.type,
                    parsed.operator,
                    reference,
                    `[${parsed.reason}] ${message}`
                ]);

                stats.alerts++;
                if (/promotion|système/i.test(parsed.reason)) {
                    stats.promotions++;
                }

                processed.push({ rowNumber });
                continue;
            }

            if (
                reference &&
                existingRefs.has(reference)
            ) {
                alertRows.push([
                    cleanDate,
                    cleanTime,
                    parsed.amount.display,
                    parsed.type,
                    parsed.operator,
                    reference,
                    `[DOUBLON] ${message}`
                ]);

                stats.alerts++;
                stats.duplicates++;
                processed.push({ rowNumber });
                continue;
            }

            const cleanRow = [
                cleanDate,
                cleanTime,
                parsed.amount.display,
                parsed.type,
                parsed.operator,
                reference,
                message
            ];

            cleanRows.push(cleanRow);

            if (reference) {
                existingRefs.add(reference);
            }

            stats.transactions++;

            // Alerte métier : on conserve aussi la transaction dans Nettoyé.
            if (parsed.amount.value > 1000000) {
                alertRows.push([
                    cleanDate,
                    cleanTime,
                    `${parsed.amount.display}`,
                    parsed.type,
                    parsed.operator,
                    reference,
                    `[MONTANT ÉLEVÉ > 1 000 000 FCFA] ${message}`
                ]);
                stats.alerts++;
            }

            processed.push({ rowNumber });
        } catch (error) {
            stats.errors++;

            alertRows.push([
                normalizeDate(
                    date,
                    settings.timezone || "Africa/Abidjan"
                ),
                normalizeTime(
                    time,
                    settings.timezone || "Africa/Abidjan"
                ),
                "0",
                "Autre",
                "Inconnu",
                "",
                `[ERREUR DE TRAITEMENT] ${message}`
            ]);

            processed.push({ rowNumber });
        }
    }

    // On écrit les résultats AVANT de marquer les lignes OK.
    // Ainsi un échec d'écriture ne fait pas disparaître un message.
    await appendRows(
        sheets,
        spreadsheetId,
        "Nettoyé",
        cleanRows
    );

    await appendRows(
        sheets,
        spreadsheetId,
        "Alertes",
        alertRows
    );

    await markRowsProcessed(
        sheets,
        spreadsheetId,
        processed
    );

    return {
        success: true,
        spreadsheetId,
        stats
    };
}

module.exports = {
    processDailySheet,
    HEADERS
};
