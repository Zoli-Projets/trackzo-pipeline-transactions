const express = require("express");
const { Op, fn, col, where } = require("sequelize");
const router = express.Router();

const User = require("../models/User");
const Device = require("../models/Device");
const Session = require("../models/Session");
const { createUserAccount } = require("../services/userService");
const { requireAuth } = require("../middleware/auth");
const { issueSession } = require("../services/sessionService");
const { createVerification, consumeVerification } = require("../services/verificationService");
const { getCurrentSubscription } = require("../services/subscriptionService");

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function publicDevice(device) {
  return {
    id: device.id,
    deviceUuid: device.deviceUuid,
    deviceName: device.deviceName,
    androidVersion: device.androidVersion,
    active: device.active,
    lastSeen: device.lastSeen,
    createdAt: device.createdAt
  };
}

async function findUserByIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (!value) return null;
  if (value.includes("@")) {
    return User.findOne({ where: where(fn("LOWER", col("email")), value.toLowerCase()) });
  }
  return User.findOne({ where: { phone: value } });
}

async function completeLogin(user, device) {
  const { accessToken, expiresAt } = await issueSession(user.id, device.id);
  await device.update({ lastSeen: new Date() });
  return { userId: user.id, accessToken, expiresAt };
}

function accountVerificationRequired() {
  return String(process.env.REQUIRE_ACCOUNT_VERIFICATION || "false").trim().toLowerCase() === "true";
}

async function authorizeNewDeviceWithoutVerification(user, {
  deviceUuid,
  deviceName,
  androidVersion,
  replaceDeviceId
}) {
  const subscription = await getCurrentSubscription(user.id);
  const maxDevices = subscription && subscription.status === "ACTIVE"
    ? Number(subscription.maxDevices || 1)
    : 1;

  const activeDevices = await Device.findAll({
    where: { userId: user.id, active: true },
    order: [["lastSeen", "ASC"]]
  });

  if (activeDevices.length >= maxDevices) {
    if (!replaceDeviceId) {
      const error = new Error(`Limite de ${maxDevices} appareil(s) atteinte`);
      error.code = "DEVICE_LIMIT_REACHED";
      error.devices = activeDevices.map(publicDevice);
      throw error;
    }

    const toReplace = activeDevices.find((d) => d.id === replaceDeviceId);
    if (!toReplace) {
      const error = new Error("Appareil à remplacer invalide");
      error.code = "INVALID_REPLACEMENT_DEVICE";
      throw error;
    }

    await toReplace.update({ active: false, authTokenHash: null });
    await Session.update(
      { revokedAt: new Date() },
      { where: { deviceId: toReplace.id, revokedAt: null } }
    );
  }

  const existingDevice = await Device.findOne({
    where: { deviceUuid: String(deviceUuid).trim() }
  });

  let device;
  if (existingDevice) {
    if (existingDevice.userId !== user.id) {
      const error = new Error("Cet appareil est déjà rattaché à un autre compte");
      error.code = "DEVICE_ALREADY_LINKED";
      throw error;
    }
    device = existingDevice;
    await device.update({
      deviceName: deviceName || device.deviceName || "Android",
      androidVersion: androidVersion || device.androidVersion || null,
      active: true,
      lastSeen: new Date()
    });
  } else {
    device = await Device.create({
      userId: user.id,
      deviceUuid: String(deviceUuid).trim(),
      deviceName: deviceName || "Android",
      androidVersion: androidVersion || null,
      active: true,
      lastSeen: new Date()
    });
  }

  return completeLogin(user, device);
}

router.post("/register", async (req, res) => {
  try {
    const { name, phone, email, country, companyName, deviceUuid, deviceName, androidVersion } = req.body;
    if (!name || !phone || !email) {
      return res.status(400).json({ success: false, error: "Nom, téléphone et email obligatoires" });
    }
    if (!deviceUuid) return res.status(400).json({ success: false, error: "Identifiant appareil obligatoire" });

    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({
      where: {
        [Op.or]: [
          { phone: String(phone).trim() },
          where(fn("LOWER", col("email")), normalizedEmail)
        ]
      }
    });
    if (existing) return res.status(409).json({ success: false, error: "Un compte existe déjà avec ce téléphone ou cet email" });

    const { user, device } = await createUserAccount({
      name, phone, email: normalizedEmail, country, companyName,
      deviceUuid, deviceName, androidVersion
    });
    const session = await completeLogin(user, device);

    return res.status(201).json({
      success: true,
      message: "Compte créé avec période d'essai de 7 jours",
      ...session,
      emailVerificationRecommended: accountVerificationRequired()
    });
  } catch (error) {
    console.error("Erreur création compte:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { identifier, phone, deviceUuid, deviceName, androidVersion, replaceDeviceId } = req.body;
    const loginIdentifier = identifier || phone;
    if (!loginIdentifier || !deviceUuid) {
      return res.status(400).json({ success: false, error: "Téléphone/email et identifiant appareil obligatoires" });
    }

    const user = await findUserByIdentifier(loginIdentifier);
    if (!user) return res.status(404).json({ success: false, error: "Compte introuvable" });
    if (user.status !== "ACTIVE") {
      return res.status(403).json({ success: false, code: "ACCOUNT_DISABLED", error: user.status === "SUSPENDED" ? "Compte suspendu" : "Compte désactivé" });
    }

    const knownDevice = await Device.findOne({
      where: { userId: user.id, deviceUuid: String(deviceUuid).trim(), active: true }
    });
    if (knownDevice) {
      const session = await completeLogin(user, knownDevice);
      return res.json({ success: true, message: "Connexion réussie", ...session });
    }

    if (!accountVerificationRequired()) {
      try {
        const session = await authorizeNewDeviceWithoutVerification(user, {
          deviceUuid,
          deviceName,
          androidVersion,
          replaceDeviceId
        });
        return res.json({
          success: true,
          message: "Nouvel appareil autorisé sans OTP (vérification temporairement désactivée)",
          verificationRequired: false,
          ...session
        });
      } catch (error) {
        if (error.code === "DEVICE_LIMIT_REACHED") {
          return res.status(409).json({
            success: false,
            code: error.code,
            error: error.message,
            devices: error.devices
          });
        }
        if (["INVALID_REPLACEMENT_DEVICE", "DEVICE_ALREADY_LINKED"].includes(error.code)) {
          return res.status(409).json({ success: false, code: error.code, error: error.message });
        }
        throw error;
      }
    }

    let channel;
    let target;
    if (user.emailVerified && user.email) {
      channel = "EMAIL";
      target = user.email;
    } else if (user.phoneVerified && user.phone) {
      channel = "PHONE";
      target = user.phone;
    } else {
      return res.status(403).json({
        success: false,
        code: "RECOVERY_NOT_CONFIGURED",
        error: "Nouvel appareil détecté. Aucune méthode de récupération vérifiée n'est disponible. Contactez le support Trackzo."
      });
    }

    const challenge = await createVerification({
      userId: user.id,
      channel,
      target,
      purpose: "LOGIN_NEW_DEVICE",
      metadata: {
        deviceUuid: String(deviceUuid).trim(),
        deviceName: deviceName || "Android",
        androidVersion: androidVersion || null
      }
    });

    return res.status(202).json({
      success: true,
      verificationRequired: true,
      challengeId: challenge.challengeId,
      channel,
      maskedTarget: channel === "EMAIL" ? target.replace(/(^.).*(@.*$)/, "$1***$2") : `***${target.slice(-4)}`,
      expiresAt: challenge.expiresAt
    });
  } catch (error) {
    console.error("Erreur connexion:", error);
    const status = error.code === "OTP_PROVIDER_NOT_CONFIGURED" ? 503 : 500;
    return res.status(status).json({ success: false, code: error.code, error: error.message });
  }
});

router.post("/login/verify", async (req, res) => {
  try {
    if (!accountVerificationRequired()) {
      return res.status(409).json({
        success: false,
        code: "VERIFICATION_DISABLED",
        error: "La vérification OTP est temporairement désactivée"
      });
    }
    const { challengeId, code, replaceDeviceId } = req.body;
    if (!challengeId || !code) return res.status(400).json({ success: false, error: "Code et challenge obligatoires" });

    const verification = await consumeVerification({ challengeId, code, purpose: "LOGIN_NEW_DEVICE", consume: false });
    const user = await User.findByPk(verification.userId);
    if (!user || user.status !== "ACTIVE") return res.status(403).json({ success: false, error: "Compte indisponible" });

    const subscription = await getCurrentSubscription(user.id);
    const maxDevices = subscription && subscription.status === "ACTIVE" ? subscription.maxDevices : 1;
    const activeDevices = await Device.findAll({ where: { userId: user.id, active: true }, order: [["lastSeen", "ASC"]] });

    if (activeDevices.length >= maxDevices) {
      if (!replaceDeviceId) {
        return res.status(409).json({
          success: false,
          code: "DEVICE_LIMIT_REACHED",
          error: `Limite de ${maxDevices} appareil(s) atteinte`,
          devices: activeDevices.map(publicDevice)
        });
      }
      const toReplace = activeDevices.find((d) => d.id === replaceDeviceId);
      if (!toReplace) return res.status(400).json({ success: false, error: "Appareil à remplacer invalide" });
      await toReplace.update({ active: false, authTokenHash: null });
      await Session.update({ revokedAt: new Date() }, { where: { deviceId: toReplace.id, revokedAt: null } });
    }

    const metadata = verification.metadata || {};
    const [device] = await Device.findOrCreate({
      where: { deviceUuid: metadata.deviceUuid },
      defaults: {
        userId: user.id,
        deviceName: metadata.deviceName || "Android",
        androidVersion: metadata.androidVersion || null,
        active: true,
        lastSeen: new Date()
      }
    });

    if (device.userId !== user.id) return res.status(409).json({ success: false, error: "Cet appareil est déjà rattaché à un autre compte" });
    if (!device.active) await device.update({ active: true });

    const session = await completeLogin(user, device);
    await verification.update({ consumedAt: new Date() });
    return res.json({ success: true, message: "Nouvel appareil autorisé", ...session });
  } catch (error) {
    const status = ["VERIFICATION_EXPIRED", "VERIFICATION_INVALID", "VERIFICATION_LOCKED"].includes(error.code) ? 400 : 500;
    return res.status(status).json({ success: false, code: error.code, error: error.message });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const subscription = await getCurrentSubscription(req.user.id);
  const devices = await Device.findAll({ where: { userId: req.user.id }, order: [["lastSeen", "DESC"]] });
  return res.json({
    success: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      phone: req.user.phone,
      phoneVerified: req.user.phoneVerified,
      email: req.user.email,
      emailVerified: req.user.emailVerified,
      country: req.user.country,
      status: req.user.status
    },
    subscription,
    devices: devices.map(publicDevice),
    currentDeviceId: req.device.id
  });
});

router.post("/email/verification/request", requireAuth, async (req, res) => {
  try {
    if (!accountVerificationRequired()) {
      return res.status(409).json({
        success: false,
        code: "VERIFICATION_DISABLED",
        error: "La vérification OTP est temporairement désactivée"
      });
    }
    if (!req.user.email) return res.status(400).json({ success: false, error: "Aucun email enregistré" });
    const challenge = await createVerification({
      userId: req.user.id,
      channel: "EMAIL",
      target: req.user.email,
      purpose: "VERIFY_EMAIL"
    });
    return res.json({ success: true, ...challenge });
  } catch (error) {
    const status = error.code === "OTP_PROVIDER_NOT_CONFIGURED" ? 503 : 500;
    return res.status(status).json({ success: false, code: error.code, error: error.message });
  }
});

router.post("/email/verification/confirm", requireAuth, async (req, res) => {
  try {
    const verification = await consumeVerification({ challengeId: req.body.challengeId, code: req.body.code, purpose: "VERIFY_EMAIL" });
    if (verification.userId !== req.user.id || normalizeEmail(verification.target) !== normalizeEmail(req.user.email)) {
      return res.status(400).json({ success: false, error: "Vérification invalide" });
    }
    await req.user.update({ emailVerified: true });
    return res.json({ success: true, message: "Email vérifié" });
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code, error: error.message });
  }
});

router.patch("/profile", requireAuth, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name != null) updates.name = String(req.body.name).trim();
    if (req.body.country != null) updates.country = String(req.body.country).trim();
    if (!updates.name && req.body.name != null) return res.status(400).json({ success: false, error: "Nom invalide" });
    await req.user.update(updates);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/phone/change/request", requireAuth, async (req, res) => {
  try {
    const newPhone = String(req.body.newPhone || "").trim();
    if (!newPhone) return res.status(400).json({ success: false, error: "Nouveau numéro obligatoire" });

    const existing = await User.findOne({ where: { phone: newPhone } });
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ success: false, error: "Ce numéro est déjà utilisé" });
    }

    if (!accountVerificationRequired()) {
      await req.user.update({ phone: newPhone, phoneVerified: false });
      return res.json({
        success: true,
        verificationRequired: false,
        message: "Numéro modifié sans OTP (vérification temporairement désactivée)"
      });
    }

    const canVerifyNewPhone = Boolean(process.env.SMS_OTP_WEBHOOK_URL);
    if (!canVerifyNewPhone && (!req.user.emailVerified || !req.user.email)) {
      return res.status(403).json({ success: false, code: "VERIFIED_EMAIL_REQUIRED", error: "Vérifiez d'abord votre email pour sécuriser le changement de numéro" });
    }
    const challenge = await createVerification({
      userId: req.user.id,
      channel: canVerifyNewPhone ? "PHONE" : "EMAIL",
      target: canVerifyNewPhone ? newPhone : req.user.email,
      purpose: "CHANGE_PHONE",
      metadata: { newPhone, verifiesNewPhone: canVerifyNewPhone }
    });
    return res.json({ success: true, ...challenge });
  } catch (error) {
    const status = error.code === "OTP_PROVIDER_NOT_CONFIGURED" ? 503 : 500;
    return res.status(status).json({ success: false, code: error.code, error: error.message });
  }
});

router.post("/phone/change/confirm", requireAuth, async (req, res) => {
  try {
    if (!accountVerificationRequired()) {
      return res.status(409).json({
        success: false,
        code: "VERIFICATION_DISABLED",
        error: "La vérification OTP est temporairement désactivée"
      });
    }
    const verification = await consumeVerification({ challengeId: req.body.challengeId, code: req.body.code, purpose: "CHANGE_PHONE" });
    if (verification.userId !== req.user.id) return res.status(400).json({ success: false, error: "Vérification invalide" });
    const newPhone = String((verification.metadata || {}).newPhone || "").trim();
    if (!newPhone) return res.status(400).json({ success: false, error: "Nouveau numéro introuvable" });
    const existing = await User.findOne({ where: { phone: newPhone } });
    if (existing && existing.id !== req.user.id) return res.status(409).json({ success: false, error: "Ce numéro est déjà utilisé" });
    const phoneVerified = (verification.metadata || {}).verifiesNewPhone === true;
    await req.user.update({ phone: newPhone, phoneVerified });
    return res.json({ success: true, message: phoneVerified ? "Numéro modifié et vérifié" : "Numéro modifié via récupération email; le nouveau numéro reste non vérifié" });
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code, error: error.message });
  }
});

router.post("/devices/:deviceId/deactivate", requireAuth, async (req, res) => {
  const device = await Device.findOne({ where: { id: req.params.deviceId, userId: req.user.id } });
  if (!device) return res.status(404).json({ success: false, error: "Appareil introuvable" });
  if (device.id === req.device.id) return res.status(400).json({ success: false, error: "Utilisez Déconnexion pour l'appareil actuel" });
  await device.update({ active: false, authTokenHash: null });
  await Session.update({ revokedAt: new Date() }, { where: { deviceId: device.id, revokedAt: null } });
  return res.json({ success: true });
});

router.post("/logout", requireAuth, async (req, res) => {
  try {
    if (req.session) await req.session.update({ revokedAt: new Date() });
    await req.device.update({ authTokenHash: null });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Impossible de fermer la session" });
  }
});

module.exports = router;
