const crypto = require("crypto");
const { createOAuthClient } = require("../config/googleOAuth");

function getStateSecret() {
    const secret = process.env.OAUTH_STATE_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error("OAUTH_STATE_SECRET doit contenir au moins 32 caractères");
    }
    return secret;
}

function createState(userId) {
    const payload = Buffer.from(JSON.stringify({
        userId,
        nonce: crypto.randomBytes(16).toString("hex"),
        exp: Date.now() + 10 * 60 * 1000
    })).toString("base64url");
    const signature = crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

function verifyState(state) {
    const [payload, signature] = String(state || "").split(".");
    if (!payload || !signature) throw new Error("State OAuth invalide");
    const expected = crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new Error("State OAuth invalide");
    }
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.userId || !data.exp || Date.now() > data.exp) throw new Error("State OAuth expiré");
    return data.userId;
}

function getAuthUrl(userId) {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile"
        ],
        prompt: "consent",
        state: createState(userId)
    });
}

module.exports = { getAuthUrl, verifyState };
