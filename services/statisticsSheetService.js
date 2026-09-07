const { google } = require("googleapis");

const OPERATORS = [
    "Orange Money",
    "MTN Money",
    "Moov Money",
    "Wave"
];

const TYPES_TABLE1 = [
    "Dépôt",
    "Retrait",
    "Transf. International",
    "Transfère Unité",
    "Paiement facture"
];

const TYPES_TABLE2 = [
    "Recharge",
    "U.V en espèce",
    "Bonus"
];

const COLOR_BY_OPERATOR = {
    "Orange Money": "#FFF2DD",
    "MTN Money": "#FFF8D1",
    "Moov Money": "#E8F9EA",
    "Wave": "#DCEEFF"
};

function hexToRgbColor(hex) {
    const value = hex.replace("#", "");
    return {
        red: parseInt(value.slice(0, 2), 16) / 255,
        green: parseInt(value.slice(2, 4), 16) / 255,
        blue: parseInt(value.slice(4, 6), 16) / 255
    };
}

async function getSheetsClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return google.sheets({
        version: "v4",
        auth: oauth2Client
    });
}

function parseAmount(value) {
    if (typeof value === "number") return value;

    const cleaned = String(value || "")
        .replace(/\s/g, "")
        .replace(/[^\d,.-]/g, "")
        .replace(",", ".");

    return Number.parseFloat(cleaned) || 0;
}

function matchOperator(value) {
    const operator = String(value || "").trim();
    if (!operator) return null;

    const lower = operator.toLowerCase();

    for (const candidate of OPERATORS) {
        if (lower.includes(candidate.toLowerCase().split(" ")[0])) {
            return candidate;
        }
    }

    return OPERATORS.includes(operator) ? operator : null;
}

function matchType(value, candidates) {
    const type = String(value || "").trim();
    if (!type) return null;
    if (candidates.includes(type)) return type;

    const lower = type.toLowerCase();

    for (const candidate of candidates) {
        if (lower.includes(candidate.toLowerCase().split(" ")[0])) {
            return candidate;
        }
    }

    return null;
}

async function readClean(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Nettoyé'!A:G",
        valueRenderOption: "FORMATTED_VALUE"
    });

    return (response.data.values || [])
        .slice(1)
        .map(row => ({
            amount: parseAmount(row[2]),
            type: String(row[3] || "").trim(),
            operator: String(row[4] || "").trim()
        }));
}

function calculateSums(transactions) {
    const allTypes = TYPES_TABLE1.concat(TYPES_TABLE2);
    const sums = {};

    for (const operator of OPERATORS) {
        sums[operator] = {};
        for (const type of allTypes) {
            sums[operator][type] = 0;
        }
    }

    for (const transaction of transactions) {
        const operator = matchOperator(transaction.operator);
        if (!operator) continue;

        const type =
            matchType(transaction.type, TYPES_TABLE1) ||
            matchType(transaction.type, TYPES_TABLE2);

        if (!type) continue;

        sums[operator][type] += transaction.amount;
    }

    return sums;
}

function getTodayAbidjan() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Abidjan",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${values.day}-${values.month}-${values.year}`;
}

async function ensureStatisticsSheet(sheets, spreadsheetId) {
    let metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title,gridProperties),charts(chartId))"
    });

    let stats = (metadata.data.sheets || []).find(
        sheet => sheet.properties?.title === "Statistiques"
    );

    if (!stats) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{ addSheet: { properties: { title: "Statistiques" } } }]
            }
        });

        metadata = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: "sheets(properties(sheetId,title,gridProperties),charts(chartId))"
        });

        stats = (metadata.data.sheets || []).find(
            sheet => sheet.properties?.title === "Statistiques"
        );
    }

    if (!stats) throw new Error("Impossible de créer la feuille Statistiques");

    return stats;
}

function buildValues(sums, today) {
    const rows = Array.from({ length: 17 }, () => Array(6).fill(""));

    // B:G dans la feuille = index 0..5 dans cette matrice.
    rows[0][0] = `Transactions du ${today}`;

    rows[2][0] = "Opérateur";
    TYPES_TABLE1.forEach((type, i) => {
        rows[2][1 + i] = type;
    });

    OPERATORS.forEach((operator, operatorIndex) => {
        const row = 3 + operatorIndex;
        rows[row][0] = operator;
        TYPES_TABLE1.forEach((type, typeIndex) => {
            rows[row][1 + typeIndex] = sums[operator][type] || 0;
        });
    });

    rows[7][0] = "Montant total";
    TYPES_TABLE1.forEach((type, typeIndex) => {
        rows[7][1 + typeIndex] = OPERATORS.reduce(
            (total, operator) => total + (sums[operator][type] || 0),
            0
        );
    });

    rows[9][0] = "Autres mouvements";

    rows[11][0] = "Opérateur";
    TYPES_TABLE2.forEach((type, i) => {
        rows[11][1 + i] = type;
    });

    OPERATORS.forEach((operator, operatorIndex) => {
        const row = 12 + operatorIndex;
        rows[row][0] = operator;
        TYPES_TABLE2.forEach((type, typeIndex) => {
            rows[row][1 + typeIndex] = sums[operator][type] || 0;
        });
    });

    rows[16][0] = "Montant";
    TYPES_TABLE2.forEach((type, typeIndex) => {
        rows[16][1 + typeIndex] = OPERATORS.reduce(
            (total, operator) => total + (sums[operator][type] || 0),
            0
        );
    });

    return rows;
}

function cellRange(sheetId, startRow, endRow, startCol, endCol) {
    return {
        sheetId,
        startRowIndex: startRow,
        endRowIndex: endRow,
        startColumnIndex: startCol,
        endColumnIndex: endCol
    };
}

async function updateStatisticsSheet(refreshToken, spreadsheetId) {
    const sheets = await getSheetsClient(refreshToken);
    const transactions = await readClean(sheets, spreadsheetId);
    const sums = calculateSums(transactions);
    const today = getTodayAbidjan();

    const stats = await ensureStatisticsSheet(sheets, spreadsheetId);
    const sheetId = stats.properties.sheetId;
    const chartIds = (stats.charts || [])
        .map(chart => chart.chartId)
        .filter(id => id != null);

    // Supprimer les valeurs existantes d'abord.
    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: "'Statistiques'!A:Z"
    });

    // Réécriture exacte de la structure demandée, en B:G.
    const values = buildValues(sums, today);
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "'Statistiques'!B1:G17",
        valueInputOption: "RAW",
        requestBody: { values }
    });

    const requests = [];

    // Supprime tous les anciens graphiques afin d'en conserver un seul.
    for (const chartId of chartIds) {
        requests.push({ deleteEmbeddedObject: { objectId: chartId } });
    }

    // Supprime les anciennes fusions de la zone avant de recréer les deux fusions.
    requests.push({ unmergeCells: { range: cellRange(sheetId, 0, 17, 1, 7) } });

    // Réinitialise les formats de B1:G17.
    requests.push({
        repeatCell: {
            range: cellRange(sheetId, 0, 17, 1, 7),
            cell: {
                userEnteredFormat: {
                    backgroundColor: { red: 1, green: 1, blue: 1 },
                    textFormat: { bold: false, fontSize: 10 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE"
                }
            },
            fields: "userEnteredFormat"
        }
    });

    // Largeurs : A=20, B=180, C:G=140.
    requests.push(
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
                properties: { pixelSize: 20 },
                fields: "pixelSize"
            }
        },
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
                properties: { pixelSize: 180 },
                fields: "pixelSize"
            }
        },
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 7 },
                properties: { pixelSize: 140 },
                fields: "pixelSize"
            }
        }
    );

    // Titres fusionnés B1:G1 et B10:G10.
    requests.push(
        { mergeCells: { range: cellRange(sheetId, 0, 1, 1, 7), mergeType: "MERGE_ALL" } },
        { mergeCells: { range: cellRange(sheetId, 9, 10, 1, 7), mergeType: "MERGE_ALL" } }
    );

    const titleFormat = {
        backgroundColor: hexToRgbColor("#E6B3C1"),
        textFormat: { bold: true, fontSize: 12 },
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE"
    };

    const sectionFormat = {
        backgroundColor: hexToRgbColor("#EDEDED"),
        textFormat: { bold: true, fontSize: 12 },
        horizontalAlignment: "LEFT",
        verticalAlignment: "MIDDLE"
    };

    requests.push(
        {
            repeatCell: {
                range: cellRange(sheetId, 0, 1, 1, 7),
                cell: { userEnteredFormat: titleFormat },
                fields: "userEnteredFormat"
            }
        },
        {
            repeatCell: {
                range: cellRange(sheetId, 9, 10, 1, 7),
                cell: { userEnteredFormat: sectionFormat },
                fields: "userEnteredFormat"
            }
        }
    );

    // En-têtes des deux tableaux.
    for (const rowIndex of [2, 11]) {
        requests.push({
            repeatCell: {
                range: cellRange(sheetId, rowIndex, rowIndex + 1, 1, rowIndex === 2 ? 7 : 5),
                cell: {
                    userEnteredFormat: {
                        backgroundColor: hexToRgbColor("#BFDFFF"),
                        textFormat: { bold: true },
                        horizontalAlignment: "CENTER",
                        verticalAlignment: "MIDDLE"
                    }
                },
                fields: "userEnteredFormat"
            }
        });
    }

    // Couleurs par opérateur pour les deux tableaux.
    OPERATORS.forEach((operator, index) => {
        const backgroundColor = hexToRgbColor(COLOR_BY_OPERATOR[operator]);

        requests.push(
            {
                repeatCell: {
                    range: cellRange(sheetId, 3 + index, 4 + index, 1, 7),
                    cell: { userEnteredFormat: { backgroundColor } },
                    fields: "userEnteredFormat.backgroundColor"
                }
            },
            {
                repeatCell: {
                    range: cellRange(sheetId, 12 + index, 13 + index, 1, 5),
                    cell: { userEnteredFormat: { backgroundColor } },
                    fields: "userEnteredFormat.backgroundColor"
                }
            }
        );
    });

    // Lignes total.
    requests.push(
        {
            repeatCell: {
                range: cellRange(sheetId, 7, 8, 1, 7),
                cell: {
                    userEnteredFormat: {
                        backgroundColor: hexToRgbColor("#CFE7CF"),
                        textFormat: { bold: true }
                    }
                },
                fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold"
            }
        },
        {
            repeatCell: {
                range: cellRange(sheetId, 16, 17, 1, 5),
                cell: {
                    userEnteredFormat: {
                        backgroundColor: hexToRgbColor("#C28A3A"),
                        textFormat: { bold: true }
                    }
                },
                fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold"
            }
        }
    );

    // Format FCFA : C:G table 1 et C:E table 2.
    const fcfaFormat = { type: "NUMBER", pattern: '#,##0" FCFA"' };
    requests.push(
        {
            repeatCell: {
                range: cellRange(sheetId, 3, 8, 2, 7),
                cell: { userEnteredFormat: { numberFormat: fcfaFormat } },
                fields: "userEnteredFormat.numberFormat"
            }
        },
        {
            repeatCell: {
                range: cellRange(sheetId, 12, 17, 2, 5),
                cell: { userEnteredFormat: { numberFormat: fcfaFormat } },
                fields: "userEnteredFormat.numberFormat"
            }
        }
    );

    // Graphique identique au script : table 1, opérateurs + 5 catégories, H3.
    requests.push({
        addChart: {
            chart: {
                spec: {
                    title: "Résumé visuel des transactions par opérateur",
                    basicChart: {
                        chartType: "COLUMN",
                        legendPosition: "RIGHT_LEGEND",
                        headerCount: 1,
                        axis: [
                            { position: "BOTTOM_AXIS", title: "Opérateurs (MTN, Orange, Moov, Wave)" },
                            { position: "LEFT_AXIS", title: "Montants (FCFA)" }
                        ],
                        domains: [{
                            domain: {
                                sourceRange: {
                                    sources: [cellRange(sheetId, 2, 7, 1, 2)]
                                }
                            }
                        }],
                        series: TYPES_TABLE1.map((_, index) => ({
                            series: {
                                sourceRange: {
                                    sources: [cellRange(sheetId, 2, 7, 2 + index, 3 + index)]
                                }
                            },
                            targetAxis: "LEFT_AXIS"
                        }))
                    }
                },
                position: {
                    overlayPosition: {
                        anchorCell: {
                            sheetId,
                            rowIndex: 2,
                            columnIndex: 7
                        },
                        widthPixels: 900,
                        heightPixels: 420
                    }
                }
            }
        }
    });

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
    });

    return {
        success: true,
        operators: OPERATORS,
        table1Types: TYPES_TABLE1,
        table2Types: TYPES_TABLE2,
        generatedAt: new Date().toISOString()
    };
}

module.exports = { updateStatisticsSheet };
