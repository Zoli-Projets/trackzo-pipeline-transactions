const express = require("express");

const router =
    express.Router();

const { requireAuth } = require("../middleware/auth");

const UserSettings =
    require("../models/UserSettings");

const Subscription =
    require("../models/Subscription");

const GoogleAccount =
    require("../models/GoogleAccount");

const DailySheet =
    require("../models/DailySheet");

const {
    createDailySheet
} =
    require("../services/dailySheetService");

const {
    generateInstantStats
} =
    require("../services/instantStatsService");

const {
    installTrackzoAgent
} =
    require("../services/appsScriptService");

const {
    processDailySheet
} = require("../services/dailySheetProcessorService");

 

// ======================================
// SETTINGS
// ======================================

async function getUserSettings(
    userId
) {

    return await UserSettings.findOne({

        where: {
            userId
        }

    });

}


// ======================================
// DAILY SYNC
// ======================================

router.post(
    "/daily-sync",
    async (req, res) => {

        try {

            const {
                agentToken,
                spreadsheetId
            } = req.body;

            if (
                !agentToken ||
                !spreadsheetId
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "agentToken et spreadsheetId obligatoires"

                });

            }

            const settings =
                await UserSettings.findOne({

                    where: {
                        agentToken
                    }

                });

            if (!settings) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Agent Trackzo invalide"

                });

            }

            if (
                settings.sheetId !==
                spreadsheetId
            ) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Maître Trackzo non reconnu"

                });

            }

            const subscription =
                await Subscription.findOne({

                    where: {
                        userId:
                            settings.userId
                    }

                });

            if (!subscription) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Abonnement introuvable"

                });

            }

            const now =
                new Date();

            if (
                subscription.status !==
                    "ACTIVE" ||
                new Date(
                    subscription.expiresAt
                ) <= now
            ) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Abonnement expiré ou inactif",

                    subscriptionStatus:
                        subscription.status,

                    expiresAt:
                        subscription.expiresAt

                });

            }

            const googleAccount =
                await GoogleAccount.findOne({

                    where: {
                        userId:
                            settings.userId
                    }

                });

            if (!googleAccount) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Compte Google non connecté"

                });

            }

            const dailySheet =
                await createDailySheet(
                    settings.userId
                );

            return res.json({

                success: true,

                message:
                    "Journalier Trackzo prêt",

                userId:
                    settings.userId,

                timezone:
                    settings.timezone,

                date:
                    dailySheet.date,

                dailySheet: {

                    spreadsheetId:
                        dailySheet.spreadsheetId,

                    spreadsheetName:
                        dailySheet.spreadsheetName,

                    url:
                        dailySheet.url

                },

                dailySheetCreation:
                    settings.dailySheetCreation,

                ready:
                    true

            });

        }
        catch (error) {

            console.error(
                "❌ Erreur daily-sync:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// ======================================
// AUJOURD'HUI / STATS INSTANTANEES
// ======================================

router.get(
    "/today-stats",
    requireAuth,
    async (req, res) => {

        try {

            const userId = req.user.id;

            const stats =
                await generateInstantStats(
                    userId
                );

            return res.json({

                success: true,

                stats

            });

        }
        catch (error) {

            console.error(
                "❌ Erreur today-stats:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// ======================================
// HISTORIQUE
// ======================================

router.get(
    "/daily-sheets",
    requireAuth,
    async (req, res) => {

        try {

            const userId = req.user.id;

            const dailySheets =
                await DailySheet.findAll({

                    where: {
                        userId
                    },

                    order: [
                        [
                            "date",
                            "DESC"
                        ]
                    ]

                });

            return res.json({

                success: true,

                count:
                    dailySheets.length,

                dailySheets:
                    dailySheets.map(
                        sheet => ({

                            id:
                                sheet.id,

                            date:
                                sheet.date,

                            name:
                                sheet.spreadsheetName,

                            spreadsheetId:
                                sheet.spreadsheetId,

                            url:
                                sheet.url,

                            timezone:
                                sheet.timezone

                        })
                    )

            });

        }
        catch (error) {

            console.error(
                "❌ Erreur historique:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// ======================================
// SETTINGS GET
// ======================================

router.get(
    "/settings",
    requireAuth,
    async (req, res) => {

        try {

            const userId = req.user.id;

            const settings =
                await getUserSettings(
                    userId
                );

            if (!settings) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Paramètres introuvables"

                });

            }

            return res.json({

                success: true,

                settings: {

                    companyName:
                        settings.companyName,

                    country:
                        settings.country,

                    timezone:
                        settings.timezone,

                    openingTime:
                        settings.openingTime,

                    closingTime:
                        settings.closingTime,

                    dailySheetCreation:
                        settings.dailySheetCreation,

                    sheetId:
                        settings.sheetId,

                    sheetUrl:
                        settings.sheetUrl

                }

            });

        }
        catch (error) {

            console.error(
                "❌ Erreur settings:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


// ======================================
// SETTINGS UPDATE
// ======================================

router.put(
    "/settings",
    requireAuth,
    async (req, res) => {

        try {

            const {
                companyName,
                country,
                timezone,
                openingTime,
                closingTime,
                dailySheetCreation
            } = req.body;
            const userId = req.user.id;

            const settings =
                await getUserSettings(
                    userId
                );

            if (!settings) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Paramètres introuvables"

                });

            }

            await settings.update({

                companyName:
                    companyName ??
                    settings.companyName,

                country:
                    country ??
                    settings.country,

                timezone:
                    timezone ??
                    settings.timezone,

                openingTime:
                    openingTime ??
                    settings.openingTime,

                closingTime:
                    closingTime ??
                    settings.closingTime,

                dailySheetCreation:
                    dailySheetCreation ??
                    settings.dailySheetCreation

            });

            let agentUpdated =
                false;

            if (
                settings.scriptId &&
                settings.agentToken
            ) {

                const googleAccount =
                    await GoogleAccount.findOne({

                        where: {
                            userId
                        }

                    });

                if (googleAccount) {

                    try {

                        await installTrackzoAgent(

                            googleAccount.refreshToken,

                            settings.scriptId,

                            settings.agentToken,

                            settings.timezone,

                            settings.dailySheetCreation

                        );

                        agentUpdated =
                            true;

                    }
                    catch (error) {

                        console.error(
                            "⚠️ Agent non reconfiguré:",
                            error.message
                        );

                    }

                }

            }

            return res.json({

                success: true,

                message:
                    "Paramètres enregistrés",

                agentUpdated

            });

        }
        catch (error) {

            console.error(
                "❌ Erreur settings update:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

// ======================================
// TRAITEMENT DU JOURNALIER
// ======================================

router.post(
    "/process-daily-sheet",
    async (req, res) => {

        try {

            const {
                agentToken,
                spreadsheetId
            } = req.body;


            // ==============================
            // VALIDATION
            // ==============================

            if (
                !agentToken ||
                !spreadsheetId
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "agentToken et spreadsheetId obligatoires"

                });

            }


            // ==============================
            // IDENTIFIER UTILISATEUR
            // ==============================

            const settings =
                await UserSettings.findOne({

                    where: {
                        agentToken:
                            agentToken
                    }

                });


            if (!settings) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Agent Trackzo invalide"

                });

            }


            // ==============================
            // JOURNALIER
            // ==============================

            const dailySheet =
                await DailySheet.findOne({

                    where: {

                        userId:
                            settings.userId,

                        spreadsheetId:
                            spreadsheetId

                    }

                });


            if (!dailySheet) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Journalier introuvable"

                });

            }


            console.log(
                "🔄 Traitement journalier:",
                spreadsheetId
            );


             // ======================================
            // GOOGLE
            // ======================================

            const googleAccount =
                await GoogleAccount.findOne({

                    where: {

                        userId:
                            settings.userId

                    }

                });


            if (!googleAccount) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Compte Google non connecté"

                });

            }


            // ======================================
            // TRAITEMENT
            // ======================================
const result =
    await processDailySheet(
        googleAccount.refreshToken,
        spreadsheetId
    );

return res.json({

    success: true,

    message:
        "Journalier traité",

    date:
        dailySheet.date,

    spreadsheetId:
        dailySheet.spreadsheetId,

    spreadsheetName:
        dailySheet.spreadsheetName,

    processing:
        result,

    ready:
        true

});
             

        }
        catch (error) {

            console.error(

                "❌ Erreur process-daily-sheet:",

                error

            );


            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);

// ======================================
// GARANTIR LE JOURNALIER DU JOUR
// ======================================

router.post(
    "/ensure-today",
    requireAuth,
    async (req, res) => {

        try {

            const userId = req.user.id;


            const settings =
                await UserSettings.findOne({

                    where: {
                        userId:
                            userId
                    }

                });


            if (!settings) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Paramètres introuvables"

                });

            }


            const timezone =
                settings.timezone ||
                "Africa/Abidjan";


            const localDate =
                require("../services/dailySheetService")
                    .getLocalDate(
                        timezone
                    );


            let dailySheet =
                await DailySheet.findOne({

                    where: {

                        userId:
                            userId,

                        date:
                            localDate

                    }

                });


            let created =
                false;


            if (!dailySheet) {

                dailySheet =
                    await createDailySheet(
                        userId
                    );

                created = true;

            }


            return res.json({

                success: true,

                created:

                    created,

                date:
                    dailySheet.date,

                dailySheet: {

                    id:
                        dailySheet.id,

                    spreadsheetId:
                        dailySheet.spreadsheetId,

                    spreadsheetName:
                        dailySheet.spreadsheetName,

                    url:
                        dailySheet.url

                }

            });

        }
        catch (error) {

            console.error(
                "❌ Erreur ensure-today:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


module.exports = router;