const User = require("../models/User");
const Device = require("../models/Device");
const Subscription = require("../models/Subscription");
const SubscriptionEvent = require("../models/SubscriptionEvent");
const UserSettings = require("../models/UserSettings");
const Template = require("../models/Template");
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

    const device = await Device.create({
      userId: user.id,
      deviceUuid: String(deviceUuid).trim(),
      deviceName: deviceName || "Android",
      androidVersion: androidVersion || null,
      active: true
    }, { transaction });

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
