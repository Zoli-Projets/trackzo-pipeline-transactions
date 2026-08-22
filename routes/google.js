const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const { google } = require("googleapis");


const {
    getAuthUrl,
    verifyState
} = require("../services/googleOAuthService");


const {
    createTrackzoStructure
} = require("../services/googleDriveService");


const {
    createUserMasterSheet
} = require("../services/userSheetService");


const {
    createDailySheet
} = require("../services/dailySheetService");


const {
    createOAuthClient
} = require("../config/googleOAuth");


const GoogleAccount =
require("../models/GoogleAccount");


const UserSettings =
require("../models/UserSettings");




// =================================
// Démarrer OAuth Google
// =================================

router.get("/connect", requireAuth, (req,res)=>{


    try{


        const userId = req.user.id;



        const url =
            getAuthUrl(userId);



        res.json({

            success:true,

            url:url

        });


    }
    catch(error){

        console.error(error);


        res.status(500).json({

            success:false,

            error:error.message

        });

    }


});




// =================================
// Statut de la connexion Google
// =================================

router.get("/status", requireAuth, async (req, res) => {

    try {

        const googleAccount =
            await GoogleAccount.findOne({
                where: {
                    userId: req.user.id
                }
            });

        return res.json({
            success: true,
            connected: !!googleAccount,
            googleEmail: googleAccount?.googleEmail || null
        });

    }
    catch (error) {

        console.error(
            "Erreur statut Google:",
            error
        );

        return res.status(500).json({
            success: false,
            error: error.message
        });

    }

});


// =================================
// Callback Google
// =================================

router.get("/callback", async(req,res)=>{


try{


const {
    code,
    state
} = req.query;



if(!code){

    return res.status(400)
    .send("Code Google absent");

}



const userId = verifyState(state);



if(!userId){

    return res.status(400)
    .send("Utilisateur introuvable");

}




// =================================
// Vérifier compte existant
// =================================

const existingAccount =
await GoogleAccount.findOne({

    where:{
        userId:userId
    }

});




// =================================
// Récupération token Google
// =================================

const client =
createOAuthClient();



const {tokens} =
await client.getToken(code);



client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date
});


await client.getAccessToken();

console.log(
"✅ Token Google validé"
);



if(!tokens.refresh_token && !existingAccount){

    return res.status(400)
    .send(
        "Refresh token Google absent"
    );

}



console.log(
    "✅ Token Google reçu"
);


console.log(
    "Refresh token Google reçu:",
    tokens.refresh_token ? "OUI" : "NON"
);




// =================================
// Informations compte Google
// =================================

const oauth2 =
google.oauth2({
    
    auth:client,

    version:"v2"

    
});



const userInfo =
await oauth2.userinfo.get({
    auth: client
});



const googleEmail =
userInfo.data.email;



console.log(
    "Compte Google:",
    googleEmail
);




// =================================
// Création ou mise à jour compte
// =================================

let googleAccount;



if(existingAccount){


    googleAccount =
    await existingAccount.update({

        googleEmail:googleEmail,


        refreshToken:
            tokens.refresh_token ||
            existingAccount.refreshToken,


        accessToken:
            tokens.access_token,

        expiryDate:
            tokens.expiry_date ||
            existingAccount.expiryDate


    });



    console.log(
        "✅ Compte Google mis à jour"
    );


}

else{


    googleAccount =
    await GoogleAccount.create({

        userId:userId,


        googleEmail:googleEmail,


        refreshToken:
            tokens.refresh_token,


        accessToken:
            tokens.access_token,
        
        expiryDate:
             tokens.expiry_date


    });



    console.log(
        "✅ Nouveau compte Google enregistré"
    );


}



// Recharge les données SQL à jour
await googleAccount.reload();






// =================================
// Création structure Drive client
// =================================


if(!googleAccount.trackzoFolderId){



    const folders =
    await createTrackzoStructure(

        googleAccount.refreshToken

    );



    await googleAccount.update({

        trackzoFolderId:
            folders.trackzoId,


        dailyFolderId:
            folders.journaliersId,


        reportsFolderId:
            folders.rapportsId


    });



    console.log(
        "✅ Structure Drive client créée"
    );


}
else{


    console.log(
        "📁 Structure Drive déjà existante"
    );


}






// =================================
// Création du maître client
// =================================


const settings =
await UserSettings.findOne({

    where:{
        userId:userId
    }

});



if(!settings){

    throw new Error(
        "Configuration utilisateur absente"
    );

}



if(!settings.sheetId){

    await createUserMasterSheet(userId);

    console.log(
        "✅ Maître client créé"
    );

}
else{

    console.log(
        "📄 Maître client déjà existant"
    );

}


// =================================
// Création immédiate du journalier du jour
// =================================
// Le maître est disponible : le premier journalier
// doit être créé immédiatement, sans attendre demain.

const dailySheet =
    await createDailySheet(userId);

console.log(
    "✅ Journalier du jour prêt:",
    dailySheet.spreadsheetId
);


res.send(`
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trackzo - Google connecté</title>
<style>
body{font-family:Arial,sans-serif;padding:32px;text-align:center;line-height:1.5}
.box{max-width:520px;margin:auto}
</style>
</head>
<body>
<div class="box">
<h2>✅ Google Drive connecté</h2>
<p>Votre maître Trackzo et le journalier d'aujourd'hui sont prêts.</p>
<p>Vous pouvez maintenant revenir dans l'application Trackzo.</p>
</div>
</body>
</html>
`);

}

catch(error){


console.error(
    "Erreur OAuth:",
    error
);



res.status(500)
.send(
    "Erreur OAuth : " + error.message
);


}


});



module.exports = router;