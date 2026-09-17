const SmsService = require("../services/SmsService");
const { requireAuth } = require("../middleware/auth");
const { requireActiveSubscription } = require("../middleware/subscription");

exports.sendSms = [
    requireAuth,
    requireActiveSubscription,
    async (req, res) => {
        try {
            const userId =
                req.user?.id ??
                req.user?.userId ??
                req.device?.userId;

            const body = (req.body && typeof req.body === "object") ? req.body : {};

            console.log("📩 SMS API reçu", {
                method: req.method,
                contentType: req.get("content-type"),
                bodyKeys: Object.keys(body),
                bodyType: typeof req.body,
                senderPresent: typeof body.sender === "string" && body.sender.trim().length > 0,
                messagePresent: typeof body.message === "string" && body.message.trim().length > 0,
                receivedAtPresent: body.receivedAt !== undefined && body.receivedAt !== null,
                smsHashPresent: typeof body.smsHash === "string" && body.smsHash.trim().length > 0,
                userIdPresent: !!userId
            });

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Utilisateur authentifié introuvable"
                });
            }

            const sender = String(body.sender ?? "").trim();
            const message = String(body.message ?? "").trim();
            const smsHash = String(body.smsHash ?? "").trim();
            const receivedAt = Number(body.receivedAt);

            const fields = {
                sender: sender.length > 0,
                message: message.length > 0,
                smsHash: smsHash.length > 0
            };

            if (!fields.sender || !fields.message || !fields.smsHash) {
                console.warn("⚠️ SMS rejeté — champs manquants", {
                    ...fields,
                    bodyKeys: Object.keys(body)
                });
                return res.status(422).json({
                    success: false,
                    error: "Données SMS incomplètes",
                    fields
                });
            }

            const normalizedReceivedAt =
                Number.isFinite(receivedAt) && receivedAt > 0
                    ? Math.trunc(receivedAt)
                    : Date.now();

            // V53 — pas de rattrapage gratuit après expiration.
            // requireActiveSubscription a placé la période courante dans req.subscription.
            // Après une réactivation, startsAt est remis à la date de réactivation :
            // tout SMS reçu avant cette nouvelle période est définitivement non éligible.
            const coverageStartsAt = req.subscription?.startsAt
                ? new Date(req.subscription.startsAt).getTime()
                : 0;
            if (coverageStartsAt > 0 && normalizedReceivedAt < coverageStartsAt) {
                return res.status(410).json({
                    success: false,
                    code: "SUBSCRIPTION_PERIOD_NOT_COVERED",
                    error: "Ce SMS a été reçu hors de votre période d’abonnement active et ne sera pas traité.",
                    coverageStartsAt: req.subscription.startsAt
                });
            }

            const result = await SmsService.send({
                userId,
                sender,
                message,
                receivedAt: normalizedReceivedAt,
                smsHash
            });

            if (result?.processing) {
                return res.status(409).json({
                    success: false,
                    processing: true,
                    error: "SMS déjà en cours de traitement"
                });
            }

            return res.json({
                success: true,
                ...result
            });
        } catch (err) {
            console.error("❌ Erreur envoi SMS:", err);

            const statusCode =
                Number.isInteger(err?.statusCode)
                    ? err.statusCode
                    : 500;

            return res.status(statusCode).json({
                success: false,
                error: err.message || "Erreur serveur"
            });
        }
    }
];
