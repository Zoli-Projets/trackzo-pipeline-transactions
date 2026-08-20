const express =
    require("express");

const router =
    express.Router();

const { requireAuth } = require("../middleware/auth");

const {
    generateInstantStats
} =
    require("../services/instantStatsService");


router.get(
    "/",
    requireAuth,
    async (req, res) => {

        try {

            const userId = req.user.id;

            const stats =
                await generateInstantStats(
                    userId
                );


            return res.json({

                success:
                    true,

                dashboard:
                    stats

            });

        }
        catch (error) {

            console.error(
                "Dashboard:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    error.message

            });

        }

    }

);


module.exports =
    router;