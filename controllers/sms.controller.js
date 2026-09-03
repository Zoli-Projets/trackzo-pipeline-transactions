const SmsService = require("../services/SmsService");
const { requireAuth } = require("../middleware/auth");

exports.sendSms = [
    requireAuth,
    async (req, res) => {
        try {
            const userId =
                req.user?.id ??
                req.user?.userId ??
                req.device?.userId;

            const body = req.body && typeof req.body === "object" ? req.body : {};

            // Accepte uniquement les noms officiels envoyés par l'application.
            // La journalisation indique les clés reçues sans afficher le contenu du SMS.
            console.log("📩 SMS reçu par le backend", {
                contentType: req.get("content-type"),
                bodyKeys: Object.keys(body),
                bodyIsObject: typeof req.body === "object" && req.body !== null,
                authenticated: !!req.user,
                userIdPresent: !!userId,
                senderPresent: typeof body.sender === "string" && body.sender.trim() !== "",
                messagePresent: typeof body.message === "string" && body.message.trim() !== "",
                receivedAtPresent: body.receivedAt !== undefined && body.receivedAt !== null,
                hashPresent: typeof body.smsHash === "string" && body.smsHash.trim() !== ""
            });

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Utilisateur authentifié introuvable"
                });
            }

            const sender = typeof body.sender === "string" ? body.sender.trim() : "";
            const message = typeof body.message === "string" ? body.message.trim() : "";
            const smsHash = typeof body.smsHash === "string" ? body.smsHash.trim() : "";
            const receivedAt = body.receivedAt;

            const fields = {
                sender: sender.length > 0,
                message: message.length > 0,
                smsHash: smsHash.length > 0
            };

            if (!fields.sender || !fields.message || !fields.smsHash) {
                console.warn("⚠️ SMS rejeté — champs manquants", fields);
                return res.status(422).json({
                    success: false,
                    error: "Données SMS incomplètes",
                    fields
                });
            }

            const timestamp = Number(receivedAt);
            const normalizedReceivedAt = Number.isFinite(timestamp) && timestamp > 0
                ? Math.trunc(timestamp)
                : Date.now();

            const result = await SmsService.send({
                userId,
                sender,
                message,
                receivedAt: normalizedReceivedAt,
                smsHash
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
