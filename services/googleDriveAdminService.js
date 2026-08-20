const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");


let auth;


// ======================================
// MODE RENDER (production)
// ======================================

if(process.env.GOOGLE_SERVICE_ACCOUNT){


    console.log(
        "☁️ Google Auth via variable Render"
    );


    const credentials =
        JSON.parse(
            process.env.GOOGLE_SERVICE_ACCOUNT
        );


    auth =
    new google.auth.GoogleAuth({

        credentials,

        scopes:[
            "https://www.googleapis.com/auth/drive"
        ]

    });



}


// ======================================
// MODE LOCAL (développement)
// ======================================

else{


    const KEY_FILE =
        path.join(
            __dirname,
            "../credentials/trackzo-service.json"
        );


    if(!fs.existsSync(KEY_FILE)){


        throw new Error(
            "❌ Fichier Google credentials introuvable : "
            + KEY_FILE
        );


    }


    console.log(
        "💻 Google Auth via fichier local"
    );


    auth =
    new google.auth.GoogleAuth({

        keyFile: KEY_FILE,

        scopes:[
            "https://www.googleapis.com/auth/drive"
        ]

    });


}



module.exports = auth;