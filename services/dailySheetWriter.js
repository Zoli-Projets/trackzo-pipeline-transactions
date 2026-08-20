const { google } = require("googleapis");

async function getSheetsClient(refreshToken) {

    const auth =
        new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

    auth.setCredentials({
        refresh_token: refreshToken
    });

    return google.sheets({
        version: "v4",
        auth
    });

}


// ======================================
// APPEND
// ======================================

async function appendRows(
    refreshToken,
    spreadsheetId,
    sheetName,
    rows
) {

    if (!rows || rows.length === 0) {
        return;
    }


    const sheets =
        await getSheetsClient(
            refreshToken
        );


    await sheets.spreadsheets.values.append({

        spreadsheetId,

        range:
            `${sheetName}!A:G`,

        valueInputOption:
            "USER_ENTERED",

        insertDataOption:
            "INSERT_ROWS",

        requestBody: {

            values:
                rows

        }

    });

}


// ======================================
// METTRE A JOUR LE STATUT
// ======================================

async function updateStatus(
    refreshToken,
    spreadsheetId,
    rowNumber,
    status
) {

    const sheets =
        await getSheetsClient(
            refreshToken
        );


    await sheets.spreadsheets.values.update({

        spreadsheetId,

        range:
            `Transactions brutes!D${rowNumber}`,

        valueInputOption:
            "RAW",

        requestBody: {

            values: [
                [status]
            ]

        }

    });

}


// ======================================
// LIRE TRANSACTIONS BRUTES
// ======================================

async function readRawMessages(
    refreshToken,
    spreadsheetId
) {

    const sheets =
        await getSheetsClient(
            refreshToken
        );


    const response =
        await sheets.spreadsheets.values.get({

            spreadsheetId,

            range:
                "Transactions brutes!A:D"

        });


    const rows =
        response.data.values || [];


    if (rows.length <= 1) {
        return [];
    }


    return rows
        .slice(1)
        .map(
            (row, index) => ({

                rowNumber:
                    index + 2,

                date:
                    row[0] || "",

                time:
                    row[1] || "",

                message:
                    String(row[2] || "").trim(),

                status:
                    String(row[3] || "").trim()

            })
        )
        .filter(
            row =>
                row.message &&
                row.status !== "OK" &&
                row.status !== "ERROR"
        );

}

async function readCleanReferences(
    refreshToken,
    spreadsheetId
) {

    const sheets =
        await getSheetsClient(
            refreshToken
        );


    const response =
        await sheets.spreadsheets.values.get({

            spreadsheetId,

            range:
                "Nettoyé!F:F"

        });


    const rows =
        response.data.values || [];


    const references =
        new Set();


    for (let i = 1; i < rows.length; i++) {

        const reference =
            String(
                rows[i][0] || ""
            )
            .trim()
            .toUpperCase();


        if (reference) {

            references.add(
                reference
            );

        }

    }


    return references;

}



// ======================================
// AJOUTER DES SMS BRUTS
// ======================================
async function appendRawRows(refreshToken, spreadsheetId, rows) {
    const sheets = await getSheetsClient(refreshToken);
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Transactions brutes!A:D",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows }
    });
    return true;
}

module.exports = {
    appendRawRows,
    readRawMessages,
    appendRows,
    updateStatus,
    readCleanReferences
     
     
};