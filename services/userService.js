const User = require("../models/User");
const Device = require("../models/Device");
const Subscription = require("../models/Subscription");
const SubscriptionEvent = require("../models/SubscriptionEvent");
const UserSettings = require("../models/UserSettings");
const Template = require("../models/Template");
const Session = require("../models/Session");
const { Op } = require("sequelize");
const sequelize = require("../database/database");

async function createUserAccount(data) {
  return sequelize.transaction(async (transaction) => {
    const {
      name, phone, email, country, companyName,
      deviceUuid, deviceName, androidVersion
    } = data;

    const user = await User.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      phoneVerified: false,
      email: email ? String(email).trim().toLowerCase() : null,
      emailVerified: false,
      country: country || "CI",
      status: "ACTIVE"
    }, { transaction });

    // A physical device can be reused for a new Trackzo account after the
    // previous account has been logged out. deviceUuid remains globally unique:
    // we transfer the existing Device row instead of inserting a duplicate.
    const normalizedDeviceUuid = String(deviceUuid).trim();
    let device = await Device.findOne({
      where: { deviceUuid: normalizedDeviceUuid },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    // L'historique d'essai appartient à l'appareil et survit au transfert
    // de la ligne Device vers un autre compte.
    const deviceAlreadyUsedTrial = Boolean(device && device.trialUsedAt);

    if (device) {
      const liveSession = await Session.findOne({
        where: {
          deviceId: device.id,
          revokedAt: null,
          expiresAt: { [Op.gt]: new Date() }
        },
        transaction
      });

      if (liveSession) {
        const error = new Error("Cet appareil est encore connecté à un autre compte. Déconnectez d'abord l'ancien compte.");
        error.code = "DEVICE_IN_USE";
        throw error;
      }

      // Expired/revoked sessions stay as audit history but cannot authenticate.
      await device.update({
        userId: user.id,
        authTokenHash: null,
        deviceName: deviceName || device.deviceName || "Android",
        androidVersion: androidVersion || device.androidVersion || null,
        active: true,
        trusted: true,
        lastSeen: new Date()
      }, { transaction });
    } else {
      device = await Device.create({
        userId: user.id,
        deviceUuid: normalizedDeviceUuid,
        deviceName: deviceName || "Android",
        androidVersion: androidVersion || null,
        active: true,
        trusted: true
      }, { transaction });
    }

    const now = new Date();
    const trialGranted = !deviceAlreadyUsedTrial;
    const subscription = await Subscription.create({
      userId: user.id,
      plan: "TRIAL",
      type: "TRIAL",
      status: trialGranted ? "ACTIVE" : "EXPIRED",
      startsAt: now,
      expiresAt: trialGranted
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        : now,
      maxDevices: 5,
      notes: trialGranted ? null : "Essai non accordé : appareil ayant déjà participé à un essai Trackzo"
    }, { transaction });

    // Le premier appareil consomme l'éligibilité d'essai dès la création du
    // compte. Cette trace reste attachée à l'appareil même s'il change de compte.
    if (trialGranted && !device.trialUsedAt) {
      await device.update({ trialUsedAt: now }, { transaction });
    }

    await SubscriptionEvent.create({
      userId: user.id,
      subscriptionId: subscription.id,
      action: "CREATED",
      actor: "SYSTEM",
      reason: trialGranted
        ? "Essai gratuit de 30 jours créé à l'inscription"
        : "Essai gratuit non accordé : appareil déjà utilisé pendant un essai",
      afterState: {
        plan: "TRIAL",
        type: "TRIAL",
        status: subscription.status,
        startsAt: subscription.startsAt,
        expiresAt: subscription.expiresAt,
        maxDevices: 5
      }
    }, { transaction });

    const activeTemplate = await Template.findOne({ where: { active: true }, transaction });
    await UserSettings.create({
      userId: user.id,
      companyName: companyName || null,
      templateId: activeTemplate ? activeTemplate.id : null
    }, { transaction });

    return { user, device, trialGranted };
  });
}

module.exports = { createUserAccount };
