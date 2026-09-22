const express = require("express");
const { Op, fn, col, where } = require("sequelize");
const router = express.Router();

const { requireAdmin } = require("../middleware/adminAuth");
const User = require("../models/User");
const Device = require("../models/Device");
const Subscription = require("../models/Subscription");
const SubscriptionEvent = require("../models/SubscriptionEvent");
const Payment = require("../models/Payment");
const Session = require("../models/Session");
const AccountDeletionRequest = require("../models/AccountDeletionRequest");
const { deleteUserAccount } = require("../services/accountDeletionService");
const { grantSubscription, cancelSubscription, getCurrentSubscription } = require("../services/subscriptionService");
const { revokeUserSessions } = require("../services/sessionService");

router.use(requireAdmin);

router.get("/users", async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const clauses = [];
    if (req.query.status) clauses.push({ status: String(req.query.status).toUpperCase() });
    if (req.query.search) {
      const search = `%${String(req.query.search).trim().toLowerCase()}%`;
      clauses.push({
        [Op.or]: [
          where(fn("LOWER", col("name")), { [Op.like]: search }),
          where(fn("LOWER", col("email")), { [Op.like]: search }),
          { phone: { [Op.like]: `%${String(req.query.search).trim()}%` } }
        ]
      });
    }

    const result = await User.findAndCountAll({
      where: clauses.length ? { [Op.and]: clauses } : {},
      include: [
        { model: Subscription, as: "subscription", required: false },
        { model: Device, as: "devices", attributes: ["id", "deviceName", "active", "lastSeen"] }
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true
    });

    const users = [];
    for (const user of result.rows) {
      const subscription = await getCurrentSubscription(user.id);
      const item = user.toJSON();
      item.subscription = subscription ? subscription.toJSON() : null;
      item.subscriptionStatus = subscription?.status || "NONE";
      users.push(item);
    }
    return res.json({ success: true, count: result.count, users });
  } catch (error) {
    console.error("Admin list users:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/users/:userId", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId, {
      include: [
        { model: Subscription, as: "subscription", required: false },
        { model: Device, as: "devices" },
        { model: Payment, as: "payments", required: false }
      ]
    });
    if (!user) return res.status(404).json({ success: false, error: "Utilisateur introuvable" });
    const subscription = await getCurrentSubscription(user.id);
    const userJson = user.toJSON();
    userJson.subscription = subscription ? subscription.toJSON() : null;
    const events = await SubscriptionEvent.findAll({ where: { userId: user.id }, order: [["createdAt", "DESC"]], limit: 100 });
    return res.json({ success: true, user: userJson, subscriptionEvents: events });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/users/:userId/status", async (req, res) => {
  try {
    const status = String(req.body.status || "").toUpperCase();
    const reason = String(req.body.reason || "").trim();
    if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) return res.status(400).json({ success: false, error: "Statut invalide" });
    if (!reason) return res.status(400).json({ success: false, error: "Motif obligatoire" });

    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: "Utilisateur introuvable" });
    const previous = user.status;

    await user.update({
      status,
      disabledReason: status === "ACTIVE" ? null : reason,
      disabledAt: status === "ACTIVE" ? null : new Date()
    });

    if (status !== "ACTIVE") {
      await revokeUserSessions(user.id);
      await Device.update({ authTokenHash: null }, { where: { userId: user.id } });
    }

    const subscription = await Subscription.findOne({ where: { userId: user.id } });
    await SubscriptionEvent.create({
      userId: user.id,
      subscriptionId: subscription ? subscription.id : null,
      action: status === "ACTIVE" ? "USER_REACTIVATED" : status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_DISABLED",
      actor: req.adminActor,
      reason,
      beforeState: { userStatus: previous },
      afterState: { userStatus: status }
    });

    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/users/:userId/subscription/grant", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: "Utilisateur introuvable" });

    const subscription = await grantSubscription({
      userId: user.id,
      plan: req.body.plan,
      type: String(req.body.type || "GIFT").toUpperCase(),
      durationDays: req.body.durationDays,
      reason: req.body.reason,
      notes: req.body.notes,
      actor: req.adminActor
    });

    return res.json({ success: true, subscription });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/users/:userId/subscription/cancel", async (req, res) => {
  try {
    const subscription = await cancelSubscription({
      userId: req.params.userId,
      reason: req.body.reason,
      actor: req.adminActor
    });
    return res.json({ success: true, subscription });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.delete("/users/:userId", async (req, res) => {
  try {
    const confirmation = String(req.body.confirmation || "").trim();
    const reason = String(req.body.reason || "").trim();

    if (confirmation !== "SUPPRIMER") {
      return res.status(400).json({
        success: false,
        error: 'Confirmation invalide. Saisis exactement "SUPPRIMER".'
      });
    }
    if (!reason) {
      return res.status(400).json({ success: false, error: "Motif obligatoire" });
    }

    const user = await User.findByPk(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "Utilisateur introuvable" });
    }

    const deletedUser = {
      id: user.id,
      name: user.name || null,
      email: user.email || null,
      phone: user.phone || null
    };

    await deleteUserAccount(user.id);

    console.log("[ADMIN] Compte Trackzo supprimé", {
      actor: req.adminActor,
      reason,
      user: deletedUser
    });

    return res.json({
      success: true,
      message: "Compte Trackzo supprimé définitivement de la base de données.",
      deletedUser
    });
  } catch (error) {
    console.error("Admin suppression directe compte:", error);
    const status = error.code === "USER_NOT_FOUND" ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
});


router.get("/account-deletion-requests", async (req, res) => {
  try {
    const status = String(req.query.status || "PENDING").toUpperCase();
    const where = ["PENDING", "COMPLETED", "REJECTED"].includes(status)
      ? { status }
      : {};
    const requests = await AccountDeletionRequest.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 200
    });
    return res.json({ success: true, requests });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/account-deletion-requests/:requestId/complete", async (req, res) => {
  try {
    const request = await AccountDeletionRequest.findByPk(req.params.requestId);
    if (!request) {
      return res.status(404).json({ success: false, error: "Demande introuvable" });
    }
    if (request.status !== "PENDING") {
      return res.status(409).json({ success: false, error: "Cette demande a déjà été traitée" });
    }

    const identifier = String(request.identifier || "").trim();
    let user = null;
    if (identifier.includes("@")) {
      user = await User.findOne({
        where: where(fn("LOWER", col("email")), identifier.toLowerCase())
      });
    } else {
      user = await User.findOne({ where: { phone: identifier } });
    }

    if (!user) {
      await request.update({
        status: "COMPLETED",
        completedAt: new Date(),
        notes: "Aucun compte actif correspondant au moment du traitement."
      });
      return res.json({
        success: true,
        message: "Aucun compte actif correspondant; demande clôturée."
      });
    }

    await deleteUserAccount(user.id);
    await request.update({
      status: "COMPLETED",
      completedAt: new Date(),
      notes: String(req.body.notes || "Suppression validée par l'administrateur")
    });

    return res.json({ success: true, message: "Compte supprimé et demande clôturée." });
  } catch (error) {
    console.error("Admin suppression compte:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/account-deletion-requests/:requestId/reject", async (req, res) => {
  try {
    const request = await AccountDeletionRequest.findByPk(req.params.requestId);
    if (!request) {
      return res.status(404).json({ success: false, error: "Demande introuvable" });
    }
    await request.update({
      status: "REJECTED",
      completedAt: new Date(),
      notes: String(req.body.notes || "Identité non vérifiée")
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/subscription-events", async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const events = await SubscriptionEvent.findAll({ order: [["createdAt", "DESC"]], limit });
  return res.json({ success: true, events });
});

router.get("/subscriptions", async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const subscriptions = await Subscription.findAll({
    include: [{ model: User, as: "user", attributes: ["id", "name", "phone", "email", "status"] }],
    order: [["updatedAt", "DESC"]],
    limit
  });
  const refreshedSubscriptions = [];
  for (const subscription of subscriptions) {
    refreshedSubscriptions.push(
      (await getCurrentSubscription(subscription.userId)) || subscription
    );
  }
  return res.json({ success: true, subscriptions: refreshedSubscriptions });
});

module.exports = router;
