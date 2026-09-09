const crypto = require("crypto");
const Session = require("../models/Session");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createAccessToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function issueSession(userId, deviceId) {
  const accessToken = createAccessToken();
  const tokenHash = hashToken(accessToken);
  const ttlDays = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 90));
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await Session.create({ userId, deviceId, tokenHash, expiresAt });
  return { accessToken, expiresAt };
}

async function revokeUserSessions(userId) {
  await Session.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null } }
  );
}

module.exports = { hashToken, createAccessToken, issueSession, revokeUserSessions };
