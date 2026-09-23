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

async function deliverEmailWithBrevo(target, code, purpose) {
  const apiKey = String(process.env.BREVO_API_KEY || "").trim();
  const fromEmail = String(process.env.OTP_FROM_EMAIL || "support@trackzo.app").trim();
  const fromName = String(process.env.OTP_FROM_NAME || "Trackzo").trim();

  if (!apiKey || !fromEmail) {
    const error = new Error("Service de vérification temporairement indisponible. Veuillez réessayer plus tard.");
    error.code = "OTP_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const isNewDevice = purpose === "LOGIN_NEW_DEVICE";
  const subject = isNewDevice ? "Votre code de vérification Trackzo" : "Votre code Trackzo";
  const textContent = [
    `Votre code de vérification Trackzo est : ${code}`,
    "",
    "Ce code expire dans 10 minutes.",
    isNewDevice ? "Il permet d'autoriser la connexion d'un nouvel appareil à votre compte." : "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."
  ].filter(Boolean).join("\n");

  let response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "api-key": apiKey
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: target }],
        subject,
        textContent
      })
    });
  } catch (_) {
    const error = new Error("Service de vérification temporairement indisponible. Veuillez réessayer plus tard.");
    error.code = "OTP_DELIVERY_FAILED";
    throw error;
  }

  if (!response.ok) {
    // Ne jamais renvoyer au client le détail de Brevo ni une information sensible.
    let providerCode = "";
    try {
      const body = await response.json();
      providerCode = String(body && body.code || "").toLowerCase();
    } catch (_) {}

    const error = new Error("Impossible d'envoyer le code de vérification pour le moment. Veuillez réessayer plus tard.");
    error.code = response.status === 429 || providerCode.includes("limit") || providerCode.includes("quota")
      ? "OTP_PROVIDER_QUOTA_REACHED"
      : "OTP_DELIVERY_FAILED";
    throw error;
  }
}

async function deliverCode(channel, target, code, purpose) {
  if (channel === "EMAIL") {
    return deliverEmailWithBrevo(target, code, purpose);
  }

  const url = process.env.SMS_OTP_WEBHOOK_URL;
  if (!url) {
    const error = new Error("Service de vérification temporairement indisponible. Veuillez réessayer plus tard.");
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
    const error = new Error("Impossible d'envoyer le code de vérification pour le moment. Veuillez réessayer plus tard.");
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
