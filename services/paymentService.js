const crypto = require("crypto");
const sequelize = require("../database/database");
const Payment = require("../models/Payment");
const Subscription = require("../models/Subscription");
const SubscriptionEvent = require("../models/SubscriptionEvent");
const { PLAN_CONFIG } = require("../config/plans");
const wave = require("./waveService");

function reference() {
  return `TZ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function paymentJson(payment) {
  return {
    reference: payment.paymentReference,
    plan: payment.plan,
    amount: Number(payment.amount),
    currency: payment.currency,
    provider: payment.provider,
    status: payment.status,
    checkoutUrl: payment.status === "PENDING" ? payment.checkoutUrl : null,
    failureReason: payment.failureReason,
    paidAt: payment.paidAt
  };
}

async function createWavePayment(userId, requestedPlan) {
  const plan = String(requestedPlan || "").toUpperCase();
  const config = PLAN_CONFIG[plan];
  if (!config || !config.purchasable) {
    const error = new Error("Formule non disponible au paiement"); error.status = 400; throw error;
  }
  const payment = await Payment.create({
    userId, plan, amount: config.price, currency: config.currency,
    provider: "WAVE", paymentReference: reference(), status: "PENDING"
  });
  try {
    const checkout = await wave.createCheckout({
      amount: config.price, currency: config.currency, clientReference: payment.paymentReference
    });
    if (!checkout.id || !checkout.wave_launch_url) throw new Error("Réponse Wave incomplète");
    await payment.update({ providerSessionId: checkout.id, checkoutUrl: checkout.wave_launch_url });
    return paymentJson(payment);
  } catch (error) {
    await payment.update({ status: "FAILED", failureReason: "Initialisation Wave impossible" });
    throw error;
  }
}

async function activatePaidSubscription(payment, verified, eventId = null) {
  const config = PLAN_CONFIG[payment.plan];
  if (!config || Number(verified.amount) !== Number(payment.amount) || verified.currency !== payment.currency ||
      verified.payment_status !== "succeeded" || verified.checkout_status !== "complete" ||
      verified.client_reference !== payment.paymentReference || verified.id !== payment.providerSessionId) {
    const error = new Error("La transaction Wave ne correspond pas au paiement Trackzo");
    error.code = "PAYMENT_MISMATCH"; throw error;
  }

  return sequelize.transaction(async (transaction) => {
    const locked = await Payment.findByPk(payment.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!locked || locked.status === "SUCCESS") return locked;
    if (locked.status !== "PENDING") return locked;

    let subscription = await Subscription.findOne({ where: { userId: locked.userId }, transaction, lock: transaction.LOCK.UPDATE });
    const beforeState = subscription ? subscription.toJSON() : null;
    const now = new Date();
    const active = subscription && subscription.status === "ACTIVE" && new Date(subscription.expiresAt) > now;
    const base = active ? new Date(subscription.expiresAt) : now;
    const expiresAt = new Date(base.getTime() + config.durationDays * 86400000);
    if (!subscription) {
      subscription = await Subscription.create({
        userId: locked.userId, plan: locked.plan, type: "PAID", status: "ACTIVE",
        startsAt: now, expiresAt, maxDevices: config.maxDevices,
        paymentProvider: "WAVE", paymentReference: locked.paymentReference
      }, { transaction });
    } else {
      await subscription.update({
        plan: locked.plan, type: "PAID", status: "ACTIVE",
        startsAt: active ? (subscription.startsAt || now) : now,
        expiresAt, maxDevices: config.maxDevices,
        paymentProvider: "WAVE", paymentReference: locked.paymentReference
      }, { transaction });
    }
    await locked.update({
      status: "SUCCESS", subscriptionId: subscription.id,
      providerTransactionId: verified.transaction_id || null,
      providerEventId: eventId || locked.providerEventId,
      paidAt: verified.when_completed ? new Date(verified.when_completed) : now,
      failureReason: null
    }, { transaction });
    await SubscriptionEvent.create({
      userId: locked.userId, subscriptionId: subscription.id,
      action: beforeState && active ? (beforeState.plan === locked.plan ? "EXTENDED" : "PLAN_CHANGED") : "ACTIVATED",
      actor: "WAVE", reason: `Paiement Wave ${locked.paymentReference}`,
      beforeState,
      afterState: subscription.toJSON()
    }, { transaction });
    return locked;
  });
}

async function verifyAndApply(payment, eventId = null) {
  if (!payment || payment.status === "SUCCESS") return payment;
  const checkout = await wave.getCheckout(payment.providerSessionId);
  if (checkout.payment_status === "succeeded" && checkout.checkout_status === "complete") {
    return activatePaidSubscription(payment, checkout, eventId);
  }
  return payment;
}

async function getUserPayment(userId, ref, verify = false) {
  let payment = await Payment.findOne({ where: { userId, paymentReference: ref } });
  if (!payment) return null;
  if (verify && payment.status === "PENDING" && payment.providerSessionId) {
    try { payment = await verifyAndApply(payment); } catch (e) { console.error("Wave status verification:", e.message); }
  }
  await payment.reload();
  return paymentJson(payment);
}

async function processWaveEvent(event) {
  const data = event && event.data;
  if (!event?.id || !data?.id) return;
  let payment = await Payment.findOne({ where: { providerSessionId: data.id } });
  if (!payment && data.client_reference) payment = await Payment.findOne({ where: { paymentReference: data.client_reference } });
  if (!payment) return;
  if (payment.providerEventId === event.id || payment.status === "SUCCESS") return;

  if (event.type === "checkout.session.completed") {
    const verified = await wave.getCheckout(payment.providerSessionId);
    await activatePaidSubscription(payment, verified, event.id);
  } else if (event.type === "checkout.session.payment_failed") {
    await payment.update({ failureReason: data.last_payment_error?.message || data.last_payment_error?.code || "Paiement Wave non finalisé" });
  }
}

module.exports = { createWavePayment, getUserPayment, processWaveEvent };
