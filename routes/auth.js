const express = require("express");

const router = express.Router();

const User = require("../models/User");
const Device = require("../models/Device");
const { createUserAccount } = require("../services/userService");
const { createAccessToken, hashToken, requireAuth } = require("../middleware/auth");


// ======================================
// INSCRIPTION UTILISATEUR
// ======================================

router.post("/register", async (req, res) => {

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
        } = req.body;



        // Vérification des champs obligatoires

        if (!name || !phone) {

            return res.status(400).json({

                success:false,

                error:
                "Nom et téléphone obligatoires"

            });

        }



        if (!deviceUuid) {

            return res.status(400).json({

                success:false,

                error:
                "Identifiant appareil obligatoire"

            });

        }



        // Vérifier si utilisateur existe déjà

        const existingUser =
            await User.findOne({

                where:{
                    phone:phone
                }

            });



        if(existingUser){

            return res.status(400).json({

                success:false,

                error:
                "Utilisateur déjà existant"

            });

        }




        // Création complète du compte

        const user =
            await createUserAccount({

                name,

                phone,

                email,

                country,

                companyName,

                deviceUuid,

                deviceName,

                androidVersion

            });



        const device = await Device.findOne({
            where: { userId: user.id, deviceUuid: String(deviceUuid).trim(), active: true }
        });

        if (!device) {
            throw new Error("Appareil créé introuvable");
        }

        const accessToken = createAccessToken();
        await device.update({
            authTokenHash: hashToken(accessToken),
            lastSeen: new Date()
        });

        res.json({
            success: true,
            message: "Compte créé avec période d'essai de 7 jours",
            userId: user.id,
            accessToken
        });



    }
    catch(error){


        console.error(
            "Erreur création compte:",
            error
        );


        res.status(500).json({

            success:false,

            error:error.message

        });


    }


});



// ======================================
// CONNEXION UTILISATEUR
// ======================================

router.post("/login", async (req, res) => {

    try {

        const {
            phone,
            deviceUuid
        } = req.body;

        if (!phone || !deviceUuid) {

            return res.status(400).json({
                success: false,
                error: "Téléphone et identifiant appareil obligatoires"
            });

        }

        const user = await User.findOne({
            where: {
                phone: String(phone).trim()
            }
        });

        if (!user) {

            return res.status(404).json({
                success: false,
                error: "Compte introuvable"
            });

        }

        const device = await Device.findOne({
            where: {
                userId: user.id,
                deviceUuid: String(deviceUuid).trim(),
                active: true
            }
        });

        if (!device) {

            return res.status(403).json({
                success: false,
                error: "Cet appareil n'est pas associé à ce compte"
            });

        }

        const accessToken = createAccessToken();
        await device.update({
            authTokenHash: hashToken(accessToken),
            lastSeen: new Date()
        });

        return res.json({
            success: true,
            message: "Connexion réussie",
            userId: user.id,
            accessToken
        });

    }
    catch (error) {

        console.error(
            "❌ Erreur connexion:",
            error
        );

        return res.status(500).json({
            success: false,
            error: error.message
        });

    }

});



// ======================================
// VÉRIFICATION DE SESSION
// ======================================
router.get("/me", requireAuth, async (req, res) => {
    return res.json({
        success: true,
        user: {
            id: req.user.id,
            name: req.user.name,
            phone: req.user.phone,
            email: req.user.email,
            country: req.user.country
        }
    });
});


// ======================================
// DÉCONNEXION / RÉVOCATION DE SESSION
// ======================================
router.post("/logout", requireAuth, async (req, res) => {
    try {
        await req.device.update({ authTokenHash: null });
        return res.json({ success: true });
    } catch (error) {
        console.error("❌ Erreur logout:", error);
        return res.status(500).json({ success: false, error: "Impossible de fermer la session" });
    }
});

module.exports = router;