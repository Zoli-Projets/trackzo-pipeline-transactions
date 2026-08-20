const GoogleAccount =
    require("../models/GoogleAccount");

const DailySheet =
    require("../models/DailySheet");

const {
    readRawMessages,
    appendRows,
    updateStatus,
    readCleanReferences
} =
    require("./dailySheetWriter");

const {
    classifyMessage
} =
    require("./transactionAiService");

const {
    parseTransaction
} =
    require("./transactionParser");


// ======================================
// TRAITEMENT DU JOURNALIER
// ======================================

async function processDailySheet(
    userId,
    spreadsheetId
) {

    const googleAccount =
        await GoogleAccount.findOne({

            where: {
                userId
            }

        });


    if (!googleAccount) {

        throw new Error(
            "Compte Google non connecté"
        );

    }


    const dailySheet =
        await DailySheet.findOne({

            where: {

                userId,

                spreadsheetId

            }

        });


    if (!dailySheet) {

        throw new Error(
            "Journalier introuvable"
        );

    }


    const rows =
        await readRawMessages(

            googleAccount.refreshToken,

            spreadsheetId

        );


    if (rows.length === 0) {

        return {

            processed:
                0,

            transactions:
                0,

            alerts:
                0,

            errors:
                0

        };

    }


    const cleanRows = [];
    const alertRows = [];

    let errors = 0;

    const existingReferences =
    await readCleanReferences(
        googleAccount.refreshToken,
        spreadsheetId
    );


    for (const row of rows) {

        try {

            const ai =
                await classifyMessage(
                    row.message
                );


            const parsed =
                parseTransaction(
                    row.message
                );


            const cleanRow = [

                row.date,

                row.time,

                parsed.amountDisplay,

                parsed.type,

                parsed.operator,

                parsed.reference,

                row.message

            ];


            // ==========================
            // PAS UNE TRANSACTION
            // ==========================

            if (
                !ai.isTransaction ||
                ai.confidence < 0.70
            ) {

                alertRows.push(
                    cleanRow
                );

                await updateStatus(

                    googleAccount.refreshToken,

                    spreadsheetId,

                    row.rowNumber,

                    "OK"

                );

                continue;

            }


            // ==========================
            // TRANSACTION MAIS DONNÉES
            // INSUFFISANTES
            // ==========================

            if (
                parsed.amount <= 0 ||
                parsed.operator === "Inconnu" ||
                parsed.type === "Autre"
            ) {

                alertRows.push(
                    cleanRow
                );

                await updateStatus(

                    googleAccount.refreshToken,

                    spreadsheetId,

                    row.rowNumber,

                    "OK"

                );

                continue;

            }
            

    if (
    parsed.reference &&
    existingReferences.has(
        parsed.reference.toUpperCase()
    )
) {

    alertRows.push(
        cleanRow
    );

    await updateStatus(
        googleAccount.refreshToken,
        spreadsheetId,
        row.rowNumber,
        "OK"
    );

    continue;

}

            // ==========================
            // VRAIE TRANSACTION
            // ==========================

            cleanRows.push(
                cleanRow
            );

            if (parsed.reference) {

                existingReferences.add(
                   parsed.reference.toUpperCase()
                );

            }


            // Grosse transaction
            if (
                parsed.amount > 1000000
            ) {

                alertRows.push([
                    row.date,
                    row.time,
                    `${parsed.amount} FCFA`,
                    parsed.type,
                    parsed.operator,
                    parsed.reference,
                    row.message
                ]);

            }


            await updateStatus(

                googleAccount.refreshToken,

                spreadsheetId,

                row.rowNumber,

                "OK"

            );

        }
        catch (error) {

            errors++;

            console.error(
                "Erreur message:",
                row.rowNumber,
                error.message
            );


            try {

                await updateStatus(

                    googleAccount.refreshToken,

                    spreadsheetId,

                    row.rowNumber,

                    "ERROR"

                );

            }
            catch (_) {}

        }

    }


    // ==============================
    // ECRITURE
    // ==============================

    await appendRows(

        googleAccount.refreshToken,

        spreadsheetId,

        "Nettoyé",

        cleanRows

    );


    await appendRows(

        googleAccount.refreshToken,

        spreadsheetId,

        "Alertes",

        alertRows

    );


    return {

        processed:
            rows.length,

        transactions:
            cleanRows.length,

        alerts:
            alertRows.length,

        errors

    };

}


module.exports = {
    processDailySheet
};