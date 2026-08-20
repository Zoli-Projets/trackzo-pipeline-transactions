const { google } = require("googleapis");

const TABLE1_TYPES = [

    "Dépôt",
    "Retrait",
    "Transf. International",
    "Transfère Unité",
    "Paiement facture"

];


const TABLE2_TYPES = [

    "Recharge",
    "U.V en espèce",
    "Bonus"

];


const OPERATORS = [

    "Orange Money",
    "MTN Money",
    "Moov Money",
    "Wave"

];


async function getSheetsClient(refreshToken) {

    const oauth2Client =
        new google.auth.OAuth2(

            process.env.GOOGLE_CLIENT_ID,

            process.env.GOOGLE_CLIENT_SECRET,

            process.env.GOOGLE_REDIRECT_URI

        );


    oauth2Client.setCredentials({

        refresh_token:
            refreshToken

    });


    return google.sheets({

        version: "v4",

        auth:
            oauth2Client

    });

}


// ============================================================
// LECTURE NETTOYE
// ============================================================

async function readClean(
    sheets,
    spreadsheetId
) {

    const response =
        await sheets.spreadsheets.values.get({

            spreadsheetId,

            range:
                "'Nettoyé'!A:G",

            valueRenderOption:
                "UNFORMATTED_VALUE"

        });


    const rows =
        response.data.values || [];


    return rows
        .slice(1)
        .map(row => ({

            amount:
                Number(
                    String(row[2] || "0")
                        .replace(/\s/g, "")
                        .replace(",", ".")
                ) || 0,

            type:
                String(row[3] || "")
                    .trim(),

            operator:
                String(row[4] || "")
                    .trim()

        }));

}


// ============================================================
// CALCUL
// ============================================================

function buildTable(
    types,
    transactions
) {

    const rows = OPERATORS.map(
        operator => {

            const values = {};


            for (const type of types) {

                values[type] =
                    transactions

                        .filter(
                            transaction =>
                                transaction.operator ===
                                    operator &&

                                transaction.type ===
                                    type
                        )

                        .reduce(
                            (
                                total,
                                transaction
                            ) =>
                                total +
                                transaction.amount,

                            0
                        );

            }


            return {

                operator,

                values

            };

        }
    );


    const totals = {};


    for (const type of types) {

        totals[type] =
            transactions

                .filter(
                    transaction =>
                        transaction.type ===
                            type
                )

                .reduce(
                    (
                        total,
                        transaction
                    ) =>
                        total +
                        transaction.amount,

                    0
                );

    }


    const grandTotal =
        Object.values(totals)
            .reduce(
                (
                    total,
                    value
                ) =>
                    total + value,

                0
            );


    return {

        types,

        rows,

        totals,

        grandTotal

    };

}


// ============================================================
// ECRITURE FEUILLE STATISTIQUES
// ============================================================

async function writeTable(
    sheets,
    spreadsheetId,
    startRow,
    title,
    table
) {

    const values = [];


    values.push([
        title
    ]);


    values.push([
        "Opérateur",
        ...table.types,
        "Total"
    ]);


    for (const row of table.rows) {

        let total = 0;

        const line = [
            row.operator
        ];


        for (const type of table.types) {

            const value =
                row.values[type] || 0;


            total += value;

            line.push(value);

        }


        line.push(total);

        values.push(line);

    }


    const totalLine = [
        "TOTAL"
    ];


    for (const type of table.types) {

        totalLine.push(
            table.totals[type] || 0
        );

    }


    totalLine.push(
        table.grandTotal
    );


    values.push(
        totalLine
    );


    await sheets.spreadsheets.values.update({

        spreadsheetId,

        range:
            `'Statistiques'!A${startRow}`,

        valueInputOption:
            "USER_ENTERED",

        requestBody: {

            values

        }

    });

}


// ============================================================
// UPDATE COMPLET
// ============================================================

async function updateStatisticsSheet(
    refreshToken,
    spreadsheetId
) {

    const sheets =
        await getSheetsClient(
            refreshToken
        );


    const transactions =
        await readClean(
            sheets,
            spreadsheetId
        );


    const table1 =
        buildTable(
            TABLE1_TYPES,
            transactions
        );


    const table2 =
        buildTable(
            TABLE2_TYPES,
            transactions
        );


    // Nettoyer la zone
    await sheets.spreadsheets.values.clear({

        spreadsheetId,

        range:
            "'Statistiques'!A1:Z100"

    });


    await writeTable(

        sheets,

        spreadsheetId,

        1,

        "STATISTIQUES - OPERATIONS",

        table1

    );


    await writeTable(

        sheets,

        spreadsheetId,

        12,

        "STATISTIQUES - AUTRES OPERATIONS",

        table2

    );


    return {

        table1,

        table2

    };

}


module.exports = {

    updateStatisticsSheet

};