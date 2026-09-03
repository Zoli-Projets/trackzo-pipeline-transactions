const SmsService = require("../services/SmsService");
const { requireAuth } = require("../middleware/auth");

function normalizeSmsBody(body) {
    const source = body && typeof body === "object" ? body : {};
    return {
        sender: typeof source.sender === "string" ? source.sender.trim() : source.sender,
        message: typeof source.message === "string" ? source.message.trim() : source.message,
        receivedAt: source.receivedAt,
        smsHash: typeof source.smsHash === "string" ? source.smsHash.trim() : source.smsHash
    };
}

exports.sendSms = [
    requireAuth,
    async (req, res) => {
        try {
            const userId = req.user?.id ?? req.user?.userId ?? req.device?.userId;
            const { sender, message, receivedAt, smsHash } = normalizeSmsBody(req.body);

            console.log("📩 SMS API", {
                contentType: req.get("content-type"),
                bodyKeys: Object.keys(req.body || {}),
                userIdPresent: !!userId,
                senderPresent: typeof sender === "string" && sender.length > 0,
                messagePresent: typeof message === "string" && message.length > 0,
                receivedAtPresent: receivedAt !== undefined && receivedAt !== null,
                hashPresent: typeof smsHash === "string" && smsHash.length > 0
            });

            if (!userId) {
                return res.status(401).json({ success: false, error: "Utilisateur authentifié introuvable" });
            }

            if (typeof sender !== "string" || !sender || typeof message !== "string" || !message || typeof smsHash !== "string" || !smsHash) {
                return res.status(422).json({
                    success: false,
                    error: "Données SMS incomplètes",
                    fields: {
                        sender: typeof sender === "string" && sender.length > 0,
                        message: typeof message === "string" && message.length > 0,
                        smsHash: typeof smsHash === "string" && smsHash.length > 0
                    }
                });
            }

            const result = await SmsService.send({
                userId,
                sender,
                message,
                receivedAt,
                smsHash
            });

            return res.status(200).json({
                success: true,
                duplicate: result.duplicate === true,
                spreadsheetId: result.spreadsheetId || null
            });
        } catch (err) {
            console.error("❌ Erreur envoi SMS:", err);

            const message = err.message || "Erreur serveur";
            const status = /Paramètres utilisateur introuvables|Compte Google non connecté/i.test(message)
                ? 409
                : 500;

            return res.status(status).json({ success: false, error: message });
        }
    }
];
