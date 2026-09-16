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
        lastSeen: new Date()
      }, { transaction });
    } else {
      device = await Device.create({
        userId: user.id,
        deviceUuid: normalizedDeviceUuid,
        deviceName: deviceName || "Android",
        androidVersion: androidVersion || null,
        active: true
      }, { transaction });
    }

    const now = new Date();
    const subscription = await Subscription.create({
      userId: user.id,
      plan: "TRIAL",
      type: "TRIAL",
      status: "ACTIVE",
      startsAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      maxDevices: 1
    }, { transaction });

    await SubscriptionEvent.create({
      userId: user.id,
      subscriptionId: subscription.id,
      action: "CREATED",
      actor: "SYSTEM",
      reason: "Essai gratuit de 7 jours créé à l'inscription",
      afterState: {
        plan: "TRIAL",
        type: "TRIAL",
        status: "ACTIVE",
        startsAt: subscription.startsAt,
        expiresAt: subscription.expiresAt,
        maxDevices: 1
      }
    }, { transaction });

    const activeTemplate = await Template.findOne({ where: { active: true }, transaction });
    await UserSettings.create({
      userId: user.id,
      companyName: companyName || null,
      templateId: activeTemplate ? activeTemplate.id : null
    }, { transaction });

    return { user, device };
  });
}

module.exports = { createUserAccount };
