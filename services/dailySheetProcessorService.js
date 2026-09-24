const { google } = require("googleapis");

const {
    classifyMessage
} = require("./transactionClassifierService");

const {
    updateStatisticsSheet
} = require("./statisticsSheetService");

function singleLineCell(value) {
    return String(value ?? "")
        .replace(/[\r\n\u2028\u2029]+/g, " ")
        .replace(/[\t ]+/g, " ")
        .trim();
}

function extractTransactionClock(message) {
    const text = singleLineCell(message);

    // Heure de l'opération contenue dans le SMS. La seconde fait partie
    // de l'identité de la transaction : 11:24:20 != 11:24:21.
    const matches = [...text.matchAll(/\b([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\b/g)];
    if (!matches.length) return "";

    // Dans les notifications Mobile Money usuelles, l'heure de transaction
    // est la première heure HH:mm:ss présente dans le message.
    return matches[0][0];
}

function semanticTransactionKey(message, result) {
    const text = singleLineCell(message)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    // V51 : l'heure n'entre plus dans l'identité sémantique. Les opérateurs
    // peuvent renvoyer la même opération avec une heure de notification ou une
    // formulation légèrement différente. On rapproche donc TOUS les types de
    // transactions sur leurs caractéristiques métier stables.
    const phones = [...text.matchAll(/\b(?:225)?0[157]\d{8}\b/g)]
        .map(m => m[0].replace(/^225/, ""))
        .sort()
        .join("|");

    const amount = Number(result?.amount?.value || 0);
    const operator = String(result?.operator || "");
    const type = String(result?.type || "");

    // Il faut au minimum un numéro présent dans le corps du SMS pour appliquer
    // cette déduplication sans heure. Cela évite de fusionner agressivement des
    // opérations génériques ne contenant aucun participant identifiable.
    if (amount > 0 && phones && operator && type) {
        return `transaction|${amount}|${operator}|${type}|${phones}`;
    }

    return "";
}

function transactionCompletenessScore(message, result) {
    const text = singleLineCell(message);
    let score = 0;

    // Une référence/ID est le signal le plus important.
    if (result?.reference) score += 1000;

    // Puis les informations utiles supplémentaires.
    if (/\b(?:nouveau\s+)?solde\b/i.test(text)) score += 120;
    if (/\bcommission\b/i.test(text)) score += 80;
    if (/\b(?:ref(?:erence)?|transaction\s*id|transactionid|id\s*transaction)\b/i.test(text)) {
        score += 40;
    }

    // À égalité, conserver le SMS qui contient le plus d'information.
    score += Math.min(text.length, 500) / 1000;
    return score;
}

async function getSheetsClient(refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.sheets({ version: "v4", auth: oauth2Client });
}

/**
 * Lit les valeurs exactement comme elles sont affichees dans
 * "Transactions brutes". Aucune conversion de date ou d'heure n'est faite.
 * Ainsi Nettoye et Alertes recopient strictement les colonnes A et B.
 */
async function readRawRows(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Transactions brutes'!A:D",
        valueRenderOption: "FORMATTED_VALUE"
    });

    const rows = response.data.values || [];

    return rows
        .slice(1)
        .map((row, index) => ({
            rowNumber: index + 2,
            date: row[0] == null ? "" : String(row[0]),
            time: row[1] == null ? "" : String(row[1]),
            message: String(row[2] || "").trim(),
            status: String(row[3] || "").trim().toUpperCase()
        }))
        .filter(row =>
            row.message &&
            row.status !== "OK" &&
            row.status !== "ERROR"
        );
}

async function readExistingSemanticTransactions(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Nettoyé'!A:G",
        valueRenderOption: "FORMATTED_VALUE"
    });

    const map = new Map();
    const rows = response.data.values || [];

    rows.slice(1).forEach((row, index) => {
        const message = String(row[6] || "").trim();
        if (!message) return;

        try {
            const result = classifyMessage(message);
            const key = semanticTransactionKey(message, result);
            if (!key) return;

            const candidate = {
                rowNumber: index + 2,
                score: transactionCompletenessScore(message, result),
                reference: String(row[5] || result.reference || "").trim()
            };

            const previous = map.get(key);
            if (!previous || candidate.score > previous.score) {
                map.set(key, candidate);
            }
        } catch (_) {
            // Une ancienne ligne illisible ne doit jamais bloquer le traitement.
        }
    });

    return map;
}

async function updateExistingCleanRows(sheets, spreadsheetId, updates) {
    if (!updates.length) return;

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: "RAW",
            data: updates.map(item => ({
                range: `'Nettoyé'!A${item.rowNumber}:G${item.rowNumber}`,
                values: [item.row.map(singleLineCell)]
            }))
        }
    });
}

async function readExistingReferences(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Nettoyé'!F:F",
        valueRenderOption: "FORMATTED_VALUE"
    });

    const references = new Set();

    for (const row of (response.data.values || []).slice(1)) {
        const ref = String(row[0] || "").trim().toUpperCase();
        if (ref) references.add(ref);
    }

    return references;
}

/**
 * Les nouvelles lignes sont inserees juste sous l'en-tete afin que Nettoye et
 * Alertes aient exactement le meme ordre que Transactions brutes :
 * plus recent en haut, plus ancien en bas.
 *
 * Les valeurs date/heure sont ecrites comme du texte, sans conversion, pour
 * recopier strictement ce qui est affiche dans Transactions brutes.
 */
async function insertRowsAtTop(sheets, spreadsheetId, sheetName, rows) {
    if (!rows.length) return;

    const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties(sheetId,title)"
    });

    const targetSheet = (metadata.data.sheets || []).find(
        item => item.properties?.title === sheetName
    );

    const sheetId = targetSheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        throw new Error(`Feuille introuvable: ${sheetName}`);
    }

    const rowData = rows.map(row => ({
        values: row.slice(0, 7).map(value => ({
            userEnteredValue: { stringValue: singleLineCell(value) },
            userEnteredFormat: { wrapStrategy: "CLIP" }
        }))
    }));

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    insertDimension: {
                        range: {
                            sheetId,
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
                            sheetId,
                            rowIndex: 1,
                            columnIndex: 0
                        },
                        rows: rowData,
                        fields: "userEnteredValue,userEnteredFormat.wrapStrategy"
                    }
                }
            ]
        }
    });
}

/**
 * Marquage en un seul batch afin de reduire les appels Google Sheets et les
 * risques de concurrence entre plusieurs executions proches du trigger.
 */
async function markProcessed(sheets, spreadsheetId, processed) {
    if (!processed.length) return;

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: "RAW",
            data: processed.map(item => ({
                range: `'Transactions brutes'!D${item.rowNumber}`,
                values: [["OK"]]
            }))
        }
    });
}

async function processDailySheetUnlocked(refreshToken, spreadsheetId) {
    const sheets = await getSheetsClient(refreshToken);
    const rawRows = await readRawRows(sheets, spreadsheetId);

    if (!rawRows.length) {
        const stats = await updateStatisticsSheet(refreshToken, spreadsheetId);
        return {
            processed: 0,
            cleaned: 0,
            alerts: 0,
            errors: 0,
            statistics: stats
        };
    }

    const existingReferences = await readExistingReferences(sheets, spreadsheetId);
    // Références qui existaient déjà AVANT ce passage. Si une ligne brute non
    // marquée OK est rejouée après une exécution interrompue, sa référence peut
    // déjà être dans Nettoyé : c'est un rejeu idempotent, pas un nouveau doublon
    // à ajouter dans Alertes.
    const referencesPresentBeforeRun = new Set(existingReferences);
    const referencesAcceptedThisRun = new Set();
    const existingSemanticTransactions =
        await readExistingSemanticTransactions(sheets, spreadsheetId);
    const cleanRows = [];
    const cleanRowUpdates = [];
    const alertRows = [];
    const processed = [];
    const semanticSelections = new Map(existingSemanticTransactions);
    let errors = 0;

    for (const raw of rawRows) {
        try {
            const result = classifyMessage(raw.message);

            const amount = result.amount?.value || 0;
            const amountDisplay =
                result.amount?.display ||
                (amount ? `${amount} FCFA` : "0");
            const type = result.type || "Autre";
            const operator = result.operator || "Inconnu";
            const reference = result.reference || "";

            // IMPORTANT : raw.date et raw.time sont copies tels quels depuis
            // Transactions brutes. Ils ne sont ni recalcules ni reformates.
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

            const normalizedReference = reference.toUpperCase();
            const semanticKey = semanticTransactionKey(raw.message, result);
            const duplicateByReference =
                Boolean(reference) &&
                existingReferences.has(normalizedReference);
            const duplicateCreatedThisRun =
                duplicateByReference &&
                referencesAcceptedThisRun.has(normalizedReference);
            const replayOfPreviouslyProcessedReference =
                duplicateByReference &&
                referencesPresentBeforeRun.has(normalizedReference) &&
                !duplicateCreatedThisRun;

            if (nonTransaction || insufficient) {
                alertRows.push(row);
            } else if (replayOfPreviouslyProcessedReference) {
                // La transaction est déjà dans Nettoyé alors que la ligne brute est
                // encore à traiter (exécution précédente interrompue, retry, course).
                // Ne surtout pas créer un faux [DOUBLON] dans Alertes : on se contente
                // de marquer la source OK à la fin de ce passage.
            } else if (duplicateCreatedThisRun) {
                // Deux lignes distinctes de Transactions brutes portent réellement
                // la même référence pendant CE passage : c'est un vrai doublon source.
                alertRows.push([
                    ...row.slice(0, 6),
                    `[DOUBLON] ${raw.message}`
                ]);
            } else if (semanticKey && semanticSelections.has(semanticKey)) {
                // La feuille Nettoyé sert de mémoire persistante. L'heure peut être
                // différente : mêmes caractéristiques stables => même opération.
                const selected = semanticSelections.get(semanticKey);

                // Deux références explicites différentes restent deux transactions
                // réelles, même si montant/type/opérateur/numéros sont identiques.
                // En revanche, si une notification n'a pas de référence et une autre
                // en apporte une, elles sont fusionnées et la plus complète est gardée.
                const conflictingReferences = Boolean(
                    reference && selected.reference &&
                    normalizedReference !== selected.reference.toUpperCase()
                );

                if (conflictingReferences) {
                    const cleanIndex = cleanRows.length;
                    cleanRows.push(row);
                    if (reference) {
                        existingReferences.add(normalizedReference);
                        referencesAcceptedThisRun.add(normalizedReference);
                    }
                    // Ne remplace pas la sélection principale : elle continue à
                    // permettre aux variantes sans référence de rejoindre le meilleur
                    // exemplaire déjà connu.
                } else {
                    const candidateScore = transactionCompletenessScore(raw.message, result);

                    if (candidateScore > selected.score) {
                    if (selected.cleanIndex !== undefined) {
                        // Le doublon est dans le lot courant : remplacer avant insertion.
                        // L'ancien SMS allait sinon être marqué OK sans laisser de trace.
                        const replacedRow = cleanRows[selected.cleanIndex];
                        if (replacedRow) {
                            alertRows.push([
                                ...replacedRow.slice(0, 6),
                                `[DOUBLON] ${replacedRow[6]}`
                            ]);
                        }
                        cleanRows[selected.cleanIndex] = row;
                    } else if (selected.rowNumber) {
                        // Le doublon est déjà dans Nettoyé : remplacer la ligne existante
                        // par la notification la plus complète, sans créer de nouvelle ligne.
                        cleanRowUpdates.push({
                            rowNumber: selected.rowNumber,
                            row
                        });
                    }

                    if (selected.reference) {
                        existingReferences.delete(selected.reference.toUpperCase());
                    }
                    if (reference) {
                        existingReferences.add(normalizedReference);
                        referencesAcceptedThisRun.add(normalizedReference);
                    }

                    semanticSelections.set(semanticKey, {
                        cleanIndex: selected.cleanIndex,
                        rowNumber: selected.rowNumber,
                        score: candidateScore,
                        reference
                    });
                    } else {
                        // Variante sémantique moins complète : ne pas créer une 2e
                        // transaction, mais conserver sa trace dans Alertes.
                        alertRows.push([
                            ...row.slice(0, 6),
                            `[DOUBLON] ${raw.message}`
                        ]);
                    }
                }
            } else {
                const cleanIndex = cleanRows.length;
                cleanRows.push(row);

                if (semanticKey) {
                    semanticSelections.set(semanticKey, {
                        cleanIndex,
                        score: transactionCompletenessScore(raw.message, result),
                        reference
                    });
                }

                if (reference) {
                    existingReferences.add(normalizedReference);
                    referencesAcceptedThisRun.add(normalizedReference);
                }

                if (amount > 1000000) {
                    alertRows.push(row);
                }
            }

            processed.push(raw);
        } catch (error) {
            errors++;
            console.error("Erreur traitement ligne", raw.rowNumber, error);

            alertRows.push([
                raw.date,
                raw.time,
                0,
                "Erreur traitement",
                "",
                "",
                raw.message
            ]);
            processed.push(raw);
        }
    }

    // L'ordre est volontaire : les lignes de sortie sont ecrites avant que la
    // source ne soit marquee OK. En cas d'erreur d'ecriture, la source reste a
    // retraiter au prochain trigger.
    // D'abord améliorer, si nécessaire, une ancienne transaction déjà présente.
    // Ensuite seulement insérer les nouvelles transactions.
    await updateExistingCleanRows(
        sheets,
        spreadsheetId,
        cleanRowUpdates
    );
    await insertRowsAtTop(sheets, spreadsheetId, "Nettoyé", cleanRows);
    await insertRowsAtTop(sheets, spreadsheetId, "Alertes", alertRows);
    await markProcessed(sheets, spreadsheetId, processed);

    // Les statistiques sont regenerees par le meme passage du trigger, une fois
    // Nettoye mis a jour.
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

// Tous les appels (SMS automatique, Apps Script, endpoint manuel) passent ici.
// Une seule exécution par spreadsheetId à la fois évite que deux traitements
// lisent simultanément la même ligne brute avant son marquage OK et écrivent
// plusieurs fois le même [DOUBLON] dans Alertes.
const processingQueues = new Map();

async function processDailySheet(refreshToken, spreadsheetId) {
    const previous = processingQueues.get(spreadsheetId) || Promise.resolve();
    const run = previous
        .catch(() => undefined)
        .then(() => processDailySheetUnlocked(refreshToken, spreadsheetId));

    processingQueues.set(spreadsheetId, run);

    try {
        return await run;
    } finally {
        if (processingQueues.get(spreadsheetId) === run) {
            processingQueues.delete(spreadsheetId);
        }
    }
}

module.exports = { processDailySheet };
