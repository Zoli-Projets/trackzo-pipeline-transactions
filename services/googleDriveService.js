const { google } = require("googleapis");



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




async function createFolder(
    refreshToken,
    folderName,
    parentId=null
){


    const drive =
        await getDriveClient(refreshToken);



    const fileMetadata = {

        name:folderName,

        mimeType:
        "application/vnd.google-apps.folder"

    };



    if(parentId){

        fileMetadata.parents=[
            parentId
        ];

    }



    const folder =
        await drive.files.create({

            resource:fileMetadata,

            fields:"id,name"

        });



    return folder.data;

}




async function createTrackzoStructure(
    refreshToken
){


    const trackzo =
        await createFolder(
            refreshToken,
            "Trackzo"
        );


    const journaliers =
        await createFolder(

            refreshToken,

            "Journaliers",

            trackzo.id

        );


    const rapports =
        await createFolder(

            refreshToken,

            "Rapports",

            trackzo.id

        );


    return {

        trackzoId:trackzo.id,

        journaliersId:journaliers.id,

        rapportsId:rapports.id

    };

}



module.exports={

    createTrackzoStructure

};