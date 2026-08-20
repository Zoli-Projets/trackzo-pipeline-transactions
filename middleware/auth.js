const crypto = require("crypto");
const Device = require("../models/Device");
const User = require("../models/User");

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function createAccessToken() {
    return crypto.randomBytes(32).toString("hex");
}

async function requireAuth(req, res, next) {
    try {
        const header = req.get("authorization") || "";
        const match = header.match(/^Bearer\s+(.+)$/i);

        if (!match) {
            return res.status(401).json({
                success: false,
                error: "Authentification requise"
            });
        }

        const authTokenHash = hashToken(match[1].trim());
        const device = await Device.findOne({
            where: { authTokenHash, active: true }
        });

        if (!device) {
            return res.status(401).json({
                success: false,
                error: "Session invalide ou expirée"
            });
        }

        const user = await User.findByPk(device.userId);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: "Utilisateur introuvable"
            });
        }

        await device.update({ lastSeen: new Date() });
        req.user = user;
        req.device = device;
        next();
    } catch (error) {
        console.error("Erreur authentification:", error);
        return res.status(500).json({
            success: false,
            error: "Erreur d'authentification"
        });
    }
}

module.exports = {
    requireAuth,
    createAccessToken,
    hashToken
};
