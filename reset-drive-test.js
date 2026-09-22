require("dotenv").config();

const sequelize = require("./database/database");
const GoogleAccount = require("./models/GoogleAccount");
const UserSettings = require("./models/UserSettings");

const EMAIL = "mobilemoney.ci@gmail.com";

async function main() {
    try {
        await sequelize.authenticate();
        console.log("✅ Base de données connectée");

        const googleAccount = await GoogleAccount.findOne({
            where: { googleEmail: EMAIL }
        });

        if (!googleAccount) {
            console.log(`❌ Aucun compte Google trouvé pour ${EMAIL}`);
            return;
        }

        const userId = googleAccount.userId;

        console.log("👤 Compte trouvé :", googleAccount.googleEmail);
        console.log("🆔 userId :", userId);

        const settings = await UserSettings.findOne({
            where: { userId }
        });

        console.log("\n--- AVANT NETTOYAGE ---");
        console.log({
            trackzoFolderId: googleAccount.trackzoFolderId,
            dailyFolderId: googleAccount.dailyFolderId,
            reportsFolderId: googleAccount.reportsFolderId,
            sheetId: settings?.sheetId ?? null,
            sheetUrl: settings?.sheetUrl ?? null,
            sheetName: settings?.sheetName ?? null,
            sheetCreated: settings?.sheetCreated ?? null
        });

        await sequelize.transaction(async (transaction) => {
            await googleAccount.update(
                {
                    trackzoFolderId: null,
                    dailyFolderId: null,
                    reportsFolderId: null
                },
                { transaction }
            );

            if (settings) {
                await settings.update(
                    {
                        sheetId: null,
                        sheetUrl: null,
                        sheetName: null,
                        sheetCreated: false
                    },
                    { transaction }
                );
            }
        });

        console.log("\n✅ Nettoyage terminé.");
        console.log("Les éléments suivants ont été conservés :");
        console.log("- compte Google");
        console.log("- refresh token");
        console.log("- access token");
        console.log("- utilisateur");
        console.log("- abonnement");
        console.log("- transactions / SMS");
        console.log("- paramètres métier");
        console.log("- templateId");
        console.log("- lastTemplateVersion");

        console.log("\n📁 Tu peux maintenant supprimer manuellement");
        console.log("l'ancien dossier Trackzo dans Google Drive,");
        console.log("puis reconnecter Google dans Trackzo.");

    } catch (error) {
        console.error("❌ ERREUR :", error);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

main();