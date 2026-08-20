const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey() {
    const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!raw) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY est obligatoire pour chiffrer les tokens Google");
    return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(value) {
    if (value == null || value === "") return value;
    if (String(value).startsWith(PREFIX)) return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function decrypt(value) {
    if (value == null || value === "" || !String(value).startsWith(PREFIX)) return value;
    const data = Buffer.from(String(value).slice(PREFIX.length), "base64url");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
