const { getCurrentSubscription } = require("../services/subscriptionService");

/**
 * Bloque uniquement les fonctionnalités couvertes par l'abonnement.
 * requireAuth doit être exécuté avant ce middleware afin de fournir req.user.
 *
 * V52/V53 :
 * - abonnement expiré/inactif => réponse fonctionnelle claire, pas une erreur serveur ;
 * - l'utilisateur reste authentifié et peut accéder à son compte/paramètres ;
 * - l'abonnement actif est exposé dans req.subscription afin que le contrôleur SMS
 *   puisse appliquer la borne startsAt et refuser le rattrapage hors période.
 */
async function requireActiveSubscription(req, res, next) {
  try {
    const userId = req.user?.id ?? req.user?.userId ?? req.device?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        error: "Authentification requise"
      });
    }

    const subscription = await getCurrentSubscription(userId);
    const now = new Date();
    const expiresAt = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;
    const isActive = Boolean(
      subscription &&
      subscription.status === "ACTIVE" &&
      expiresAt &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt > now
    );

    if (!isActive) {
      return res.status(402).json({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        error: "Votre abonnement Trackzo est expiré ou inactif. Régularisez votre abonnement pour continuer à bénéficier des services Trackzo.",
        subscriptionStatus: subscription?.status || "NONE",
        expiresAt: subscription?.expiresAt || null
      });
    }

    req.subscription = subscription;
    return next();
  } catch (error) {
    console.error("❌ Vérification abonnement:", error?.message || error);
    return res.status(500).json({
      success: false,
      code: "SUBSCRIPTION_CHECK_FAILED",
      error: "Impossible de vérifier l’abonnement pour le moment."
    });
  }
}

module.exports = { requireActiveSubscription };
