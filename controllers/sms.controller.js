const SmsService = require("../services/SmsService");
const { requireAuth } = require("../middleware/auth");

exports.sendSms = [
    requireAuth,
    async (req, res) => {
        try {
            // Selon la définition du modèle User, l'identifiant peut être exposé
            // par Sequelize sous "id" ou sous "userId". Le device authentifié
            // possède dans tous les cas la relation userId.
            const userId =
                req.user?.id ??
                req.user?.userId ??
                req.device?.userId;

            const body = req.body || {};
            const sender = body.sender;
            const message = body.message;
            const receivedAt = body.receivedAt;
            const smsHash = body.smsHash;

            console.log("📩 SMS reçu par le backend", {
                authenticated: !!req.user,
                userIdPresent: !!userId,
                senderPresent: !!sender,
                messagePresent: !!message,
                receivedAtPresent: receivedAt !== undefined && receivedAt !== null,
                hashPresent: !!smsHash
            });

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Utilisateur authentifié introuvable"
                });
            }

            if (
                sender === undefined ||
                sender === null ||
                String(sender).trim() === "" ||
                message === undefined ||
                message === null ||
                String(message).trim() === "" ||
                smsHash === undefined ||
                smsHash === null ||
                String(smsHash).trim() === ""
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Données SMS incomplètes"
                });
            }

            const result = await SmsService.send({
                userId,
                sender: String(sender),
                message: String(message),
                receivedAt,
                smsHash: String(smsHash)
            });

            return res.json({
                success: true,
                ...result
            });
        } catch (err) {
            console.error("❌ Erreur envoi SMS:", err);

            const status =
                /incomplètes|introuvables|non connecté/i.test(err.message || "")
                    ? 400
                    : 500;

            return res.status(status).json({
                success: false,
                error: err.message || "Erreur serveur"
            });
        }
    }
];
