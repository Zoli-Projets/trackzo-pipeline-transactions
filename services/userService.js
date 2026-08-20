const User = require("../models/User");
const Device = require("../models/Device");
const Subscription = require("../models/Subscription");
const UserSettings = require("../models/UserSettings");
const Template = require("../models/Template");

const sequelize = require("../database/database");




async function createUserAccount(data){


    const transaction =
        await sequelize.transaction();


    try {


        const {

            name,
            phone,
            email,
            country,
            companyName,
            deviceUuid,
            deviceName,
            androidVersion

        } = data;



        // ======================================
        // 1 - Création utilisateur
        // ======================================

        const user =
            await User.create({

                name,
                phone,
                email,
                country

            },
            {
                transaction
            });



        console.log(
            "👤 Utilisateur créé :",
            user.id
        );



        // ======================================
        // 2 - Enregistrement appareil
        // ======================================

        await Device.create({

            userId:user.id,

            deviceUuid,

            deviceName,

            androidVersion

        },
        {
            transaction
        });



        console.log(
            "📱 Appareil enregistré"
        );



        // ======================================
        // 3 - Abonnement essai
        // ======================================

        await Subscription.create({

            userId:user.id,

            plan:"TRIAL",

            type:"TRIAL",

            status:"ACTIVE",

            expiresAt:
            new Date(
                Date.now()
                +
                7 * 24 * 60 * 60 * 1000
            ),

            maxDevices:1

        },
        {
            transaction
        });



        console.log(
            "🎁 Essai 7 jours activé"
        );



        // ======================================
        // 4 - Recherche modèle actif
        // ======================================

        const activeTemplate =
            await Template.findOne({

                where:{
                    active:true
                },

                transaction

            });



        if(!activeTemplate){
            console.warn("⚠️ Aucun modèle Google Sheet actif : inscription créée sans template");
        }



        console.log(
            "📄 Modèle trouvé :",
            activeTemplate.googleFileId
        );



        // ======================================
        // 5 - Création paramètres utilisateur
        // ======================================

        const settings =
            await UserSettings.create({

                userId:user.id,

                companyName: companyName,

                templateId:
                activeTemplate ? activeTemplate.id : null

            },
            {
                transaction
            });



        // Validation PostgreSQL

        await transaction.commit();


        console.log(
            "✅ Base SQL validée"
        );



        return user;



    }
    catch(error){


        if(!transaction.finished){

            await transaction.rollback();

        }


        console.error(
            "❌ Création compte échouée :",
            error
        );


        throw error;

    }

}



module.exports = {

    createUserAccount

};