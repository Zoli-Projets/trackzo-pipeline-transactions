const crypto = require("crypto");
const fetch = require("node-fetch");
const { Op } = require("sequelize");
const VerificationCode = require("../models/VerificationCode");

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function makeCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

async function deliverCode(channel, target, code, purpose) {
  const url = channel === "EMAIL"
    ? process.env.EMAIL_OTP_WEBHOOK_URL
    : process.env.SMS_OTP_WEBHOOK_URL;

  if (!url) {
    const error = new Error(`Fournisseur OTP ${channel} non configuré`);
    error.code = "OTP_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.OTP_WEBHOOK_SECRET
        ? { "X-Trackzo-OTP-Secret": process.env.OTP_WEBHOOK_SECRET }
        : {})
    },
    body: JSON.stringify({ channel, to: target, code, purpose })
  });

  if (!response.ok) {
    const error = new Error(`Échec d'envoi du code ${channel}`);
    error.code = "OTP_DELIVERY_FAILED";
    throw error;
  }
}

async function createVerification({ userId, channel, target, purpose, metadata = null }) {
  const recent = await VerificationCode.findOne({
    where: {
      userId, channel, target, purpose,
      createdAt: { [Op.gt]: new Date(Date.now() - 60 * 1000) }
    },
    order: [["createdAt", "DESC"]]
  });
  if (recent) {
    const error = new Error("Veuillez attendre une minute avant de demander un nouveau code");
    error.code = "VERIFICATION_RATE_LIMIT";
    throw error;
  }

  await VerificationCode.update(
    { consumedAt: new Date() },
    {
      where: {
        userId,
        channel,
        target,
        purpose,
        consumedAt: null
      }
    }
  );

  const code = makeCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const record = await VerificationCode.create({
    userId,
    channel,
    target,
    purpose,
    codeHash: hashCode(code),
    expiresAt,
    metadata
  });

  try {
    await deliverCode(channel, target, code, purpose);
  } catch (error) {
    await record.destroy();
    throw error;
  }

  return { challengeId: record.id, expiresAt };
}

async function consumeVerification({ challengeId, code, purpose, consume = true }) {
  const record = await VerificationCode.findOne({
    where: {
      id: challengeId,
      purpose,
      consumedAt: null,
      expiresAt: { [Op.gt]: new Date() }
    }
  });

  if (!record) {
    const error = new Error("Code expiré ou demande introuvable");
    error.code = "VERIFICATION_EXPIRED";
    throw error;
  }

  if (record.attempts >= 5) {
    const error = new Error("Trop de tentatives. Demandez un nouveau code.");
    error.code = "VERIFICATION_LOCKED";
    throw error;
  }

  if (hashCode(String(code).trim()) !== record.codeHash) {
    await record.increment("attempts");
    const error = new Error("Code incorrect");
    error.code = "VERIFICATION_INVALID";
    throw error;
  }

  if (consume) await record.update({ consumedAt: new Date() });
  return record;
}

module.exports = { createVerification, consumeVerification };
