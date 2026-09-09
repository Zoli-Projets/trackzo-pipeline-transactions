const sequelize = require("../database/database");
const Subscription = require("../models/Subscription");
const SubscriptionEvent = require("../models/SubscriptionEvent");

const PLAN_CONFIG = {
  TRIAL: { durationDays: 7, maxDevices: 1 },
  BASIC: { durationDays: 30, maxDevices: 1 },
  PRO: { durationDays: 30, maxDevices: 3 },
  ENTERPRISE: { durationDays: 365, maxDevices: 10 }
};

function snapshot(subscription) {
  if (!subscription) return null;
  const json = subscription.toJSON ? subscription.toJSON() : subscription;
  return {
    plan: json.plan,
    type: json.type,
    status: json.status,
    startsAt: json.startsAt,
    expiresAt: json.expiresAt,
    maxDevices: json.maxDevices,
    notes: json.notes || null
  };
}

async function syncSubscriptionStatus(subscription, actor = "SYSTEM") {
  if (!subscription) return null;
  if (subscription.status === "ACTIVE" && new Date(subscription.expiresAt) <= new Date()) {
    const beforeState = snapshot(subscription);
    await subscription.update({ status: "EXPIRED" });
    await SubscriptionEvent.create({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      action: "EXPIRED",
      actor,
      reason: "Expiration automatique",
      beforeState,
      afterState: snapshot(subscription)
    });
  }
  return subscription;
}

async function getCurrentSubscription(userId) {
  const subscription = await Subscription.findOne({ where: { userId } });
  return syncSubscriptionStatus(subscription);
}

async function grantSubscription({ userId, plan, type = "GIFT", durationDays, reason, actor, notes }) {
  const normalizedPlan = String(plan || "").toUpperCase();
  const normalizedType = String(type || "GIFT").toUpperCase();
  if (!PLAN_CONFIG[normalizedPlan]) throw new Error("Plan invalide");
  if (!["TRIAL", "PAID", "GIFT"].includes(normalizedType)) throw new Error("Type d’abonnement invalide");
  if (!reason || !String(reason).trim()) throw new Error("Motif obligatoire");

  const config = PLAN_CONFIG[normalizedPlan];
  const days = Number(durationDays || config.durationDays);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new Error("Durée invalide");

  return sequelize.transaction(async (transaction) => {
    let subscription = await Subscription.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    const beforeState = snapshot(subscription);
    const now = new Date();
    const base = subscription && subscription.status === "ACTIVE" && new Date(subscription.expiresAt) > now
      ? new Date(subscription.expiresAt)
      : now;
    const expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    if (!subscription) {
      subscription = await Subscription.create({
        userId,
        plan: normalizedPlan,
        type: normalizedType,
        status: "ACTIVE",
        startsAt: now,
        expiresAt,
        maxDevices: config.maxDevices,
        notes: notes || null
      }, { transaction });
    } else {
      await subscription.update({
        plan: normalizedPlan,
        type: normalizedType,
        status: "ACTIVE",
        startsAt: subscription.startsAt || now,
        expiresAt,
        maxDevices: config.maxDevices,
        notes: notes || subscription.notes || null
      }, { transaction });
    }

    const action = normalizedType === "GIFT"
      ? "GIFT_GRANTED"
      : beforeState && beforeState.plan !== normalizedPlan
        ? "PLAN_CHANGED"
        : beforeState && beforeState.status === "ACTIVE"
          ? "EXTENDED"
          : "ACTIVATED";

    await SubscriptionEvent.create({
      userId,
      subscriptionId: subscription.id,
      action,
      actor,
      reason: String(reason).trim(),
      beforeState,
      afterState: snapshot(subscription)
    }, { transaction });

    return subscription;
  });
}

async function cancelSubscription({ userId, reason, actor }) {
  if (!reason || !String(reason).trim()) throw new Error("Motif obligatoire");
  const subscription = await Subscription.findOne({ where: { userId } });
  if (!subscription) throw new Error("Abonnement introuvable");
  const beforeState = snapshot(subscription);
  await subscription.update({ status: "CANCELLED" });
  await SubscriptionEvent.create({
    userId,
    subscriptionId: subscription.id,
    action: "CANCELLED",
    actor,
    reason: String(reason).trim(),
    beforeState,
    afterState: snapshot(subscription)
  });
  return subscription;
}

module.exports = { PLAN_CONFIG, getCurrentSubscription, syncSubscriptionStatus, grantSubscription, cancelSubscription };
