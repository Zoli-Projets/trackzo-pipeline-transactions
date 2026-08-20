const { google } = require("googleapis");

const Template = require("../models/Template");
const updateSheetConfiguration=require("./googleSheetsService");
const {
    createBoundScriptProject,
    installTrackzoAgent
} = require("./appsScriptService");
const crypto = require("crypto");
const GoogleAccount = require("../models/GoogleAccount");
const UserSettings = require("../models/UserSettings");
const User = require("../models/User");


async function getDriveClient(refreshToken){


    const oauth2Client =
        new google.auth.OAuth2(

            process.env.GOOGLE_CLIENT_ID,

            process.env.GOOGLE_CLIENT_SECRET,

            process.env.GOOGLE_REDIRECT_URI

        );


    oauth2Client.setCredentials({

        refresh_token:refreshToken

    });


    return google.drive({

        version:"v3",

        auth:oauth2Client

    });

}





async function createUserMasterSheet(userId){


    // ==========================
    // Récupérer utilisateur Google
    // ==========================

    const googleAccount =
        await GoogleAccount.findOne({

            where:{
                userId:userId
            }

        });


    if(!googleAccount){

        throw new Error(
            "Compte Google non connecté"
        );

    }



    // ==========================
    // Template actif
    // ==========================

    const template =
        await Template.findOne({

            where:{
                active:true
            }

        });



    if(!template){

        throw new Error(
            "Aucun modèle Trackzo actif"
        );

    }



    const drive =
        await getDriveClient(
            googleAccount.refreshToken
        );



    // ==========================
    // Récupérer dossier Trackzo
    // ==========================

    const folderId =
        googleAccount.trackzoFolderId;

    const settings =
await UserSettings.findOne({

    where:{
        userId:userId
    }

});


if(!settings){

    throw new Error(
        "Paramètres utilisateur introuvables"
    );

}



    if(!folderId){

        throw new Error(
            "Dossier Trackzo absent"
        );

    }




    // ==========================
    // Copier le modèle
    // ==========================


    const copy =
        await drive.files.copy({

            fileId:
                template.googleFileId,


            requestBody:{

                name:
                `Trackzo - ${settings.companyName || "Mon entreprise"}`,

                parents:[
                    folderId
                ]

            },


            fields:
            "id,name"

        });



    console.log(
        "📄 Maître client créé:",
        copy.data.id
    );


    // ======================================
// CRÉATION DU PROJET APPS SCRIPT
// ======================================
const agentToken =
    crypto.randomBytes(32).toString("hex");

const scriptProject =
    await createBoundScriptProject(

        googleAccount.refreshToken,

        copy.data.id,

        `Trackzo Agent - ${settings.companyName || "Mon entreprise"}`

    );


const scriptId =
    scriptProject.scriptId;


console.log(
    "🧩 Script ID :",
    scriptId
);


// ======================================
// INSTALLATION DE L'AGENT
// ======================================

await installTrackzoAgent(

    googleAccount.refreshToken,

    scriptId,

    agentToken,

    settings.timezone || "Africa/Abidjan",

    settings.dailySheetCreation || "00:05"

);


console.log(
    "🤖 Agent Trackzo installé"
);



    // ==========================
    // Sauvegarde
    // ==========================


    await UserSettings.update(

        {

            sheetId:copy.data.id,

            sheetUrl:
            `https://docs.google.com/spreadsheets/d/${copy.data.id}`,

            sheetName:
            copy.data.name,

            sheetCreated:true,

            scriptId: scriptId,

            templateId:template.id,

            lastTemplateVersion:
            template.version,

            agentToken: agentToken
            

        },

        {

            where:{
                userId:userId
            }

        }

    );

     

// ==========================
// Configuration du maître client
// ==========================

await updateSheetConfiguration(

    googleAccount.refreshToken,

    copy.data.id,

    {

        companyName:
        settings.companyName || "Mon entreprise",

        country:
        settings.country || "CI",

        timezone:
        settings.timezone || "Africa/Abidjan",

        openingTime:
        settings.openingTime || "08:00",

        closingTime:
        settings.closingTime || "22:00"

    }

);


console.log(
    "⚙️ Configuration maître appliquée"
);


    return copy.data;


}


module.exports={

    createUserMasterSheet

};