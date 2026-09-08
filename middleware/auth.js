const { Op } = require("sequelize");
const Device = require("../models/Device");
const User = require("../models/User");
const Session = require("../models/Session");
const { hashToken, createAccessToken } = require("../services/sessionService");

async function requireAuth(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ success: false, error: "Authentification requise" });

    const tokenHash = hashToken(match[1].trim());
    let session = await Session.findOne({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() }
      }
    });

    let device;
    let user;

    if (session) {
      device = await Device.findOne({ where: { id: session.deviceId, active: true } });
      user = device ? await User.findByPk(session.userId) : null;
    } else {
      // Compatibilité avec les tokens des versions antérieures à la table sessions.
      device = await Device.findOne({ where: { authTokenHash: tokenHash, active: true } });
      user = device ? await User.findByPk(device.userId) : null;
      if (device && user && user.status === "ACTIVE") {
        const anyPreviousSession = await Session.findOne({ where: { tokenHash } });
        if (!anyPreviousSession) {
          const ttlDays = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 90));
          session = await Session.create({
            tokenHash,
            userId: user.id,
            deviceId: device.id,
            expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
            lastSeenAt: new Date()
          });
        } else {
          device = null;
          user = null;
        }
      }
    }

    if (!device || !user) return res.status(401).json({ success: false, error: "Session invalide ou expirée" });
    if (user.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DISABLED",
        error: user.status === "SUSPENDED" ? "Compte suspendu" : "Compte désactivé"
      });
    }

    const now = new Date();
    await device.update({ lastSeen: now });
    if (session) await session.update({ lastSeenAt: now });

    req.user = user;
    req.device = device;
    req.session = session;
    next();
  } catch (error) {
    console.error("Erreur authentification:", error);
    return res.status(500).json({ success: false, error: "Erreur d'authentification" });
  }
}

module.exports = { requireAuth, createAccessToken, hashToken };
