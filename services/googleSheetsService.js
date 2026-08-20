const { google } = require("googleapis");


async function getSheetsClient(refreshToken){


    const oauth2Client =
        new google.auth.OAuth2(

            process.env.GOOGLE_CLIENT_ID,

            process.env.GOOGLE_CLIENT_SECRET,

            process.env.GOOGLE_REDIRECT_URI

        );


    oauth2Client.setCredentials({

        refresh_token:refreshToken

    });


    return google.sheets({

        version:"v4",

        auth:oauth2Client

    });

}



async function updateSheetConfiguration(
    refreshToken,
    sheetId,
    values
){


    const sheets =
        await getSheetsClient(refreshToken);



    await sheets.spreadsheets.values.update({

        spreadsheetId:sheetId,


        range:"Configuration!B2:B6",


        valueInputOption:"USER_ENTERED",


        requestBody:{


            values:[

                [
                    values.companyName
                ],

                [
                    values.country
                ],

                [
                    values.timezone
                ],

                [
                    values.openingTime
                ],

                [
                    values.closingTime
                ]

            ]

        }

    });



    console.log(
        "✅ Configuration Sheet mise à jour"
    );


}



module.exports = updateSheetConfiguration;