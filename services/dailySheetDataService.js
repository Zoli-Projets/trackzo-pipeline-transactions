const {
    google
} = require("googleapis");


async function getSheetsClient(
    refreshToken
) {

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

        version:
            "v4",

        auth:
            oauth2Client

    });

}


// ======================================
// LIRE NETTOYÉ
// ======================================

async function readCleanTransactions(
    refreshToken,
    spreadsheetId
) {

    const sheets =
        await getSheetsClient(
            refreshToken
        );


    const response =
        await sheets.spreadsheets.values.get({

            spreadsheetId:

                spreadsheetId,

            range:
                "Nettoyé!A:G"

        });


    const rows =
        response.data.values || [];


    if (rows.length <= 1) {

        return [];

    }


    // ==============================
    // IGNORER EN-TÊTE
    // ==============================

    return rows
        .slice(1)
        .map(row => ({

            date:
                row[0] || "",

            time:
                row[1] || "",

            amount:
                parseAmount(
                    row[2]
                ),

            type:
                row[3] || "",

            operator:
                row[4] || "",

            reference:
                row[5] || "",

            message:
                row[6] || ""

        }))
        .filter(transaction => {

            return (
                transaction.date ||
                transaction.time ||
                transaction.amount ||
                transaction.type
            );

        });

}


// ======================================
// MONTANT
// ======================================

function parseAmount(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return 0;

    }


    const cleaned =
        String(value)
            .replace(
                /FCFA/gi,
                ""
            )
            .replace(
                /\s/g,
                ""
            )
            .replace(
                /,/g,
                "."
            );


    const number =
        parseFloat(cleaned);


    return Number.isFinite(number)
        ? number
        : 0;

}


module.exports = {

    readCleanTransactions

};