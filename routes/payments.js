const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { PLAN_CONFIG } = require("../config/plans");
const { createWavePayment, getUserPayment, processWaveEvent } = require("../services/paymentService");
const { verifyWebhookSignature } = require("../services/waveService");
const manual = require("../services/manualPaymentService");

async function waveWebhook(req, res) {
  try {
    const raw = req.body;
    if (!verifyWebhookSignature(raw, req.get("Wave-Signature"))) return res.status(401).json({ success: false });
    const event = JSON.parse(raw.toString("utf8"));
    await processWaveEvent(event);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Wave webhook:", error);
    return res.status(500).json({ success: false });
  }
}

router.get("/plans", requireAuth, (req, res) => {
  const plans = Object.values(PLAN_CONFIG).filter((p) => p.purchasable);
  const waveDirectAvailable = Boolean(process.env.WAVE_API_KEY && process.env.WAVE_WEBHOOK_SIGNING_SECRET && process.env.PUBLIC_BASE_URL);
  res.json({ success: true, plans, waveDirectAvailable });
});
router.get("/manual/methods", requireAuth, async (req, res) => {
  try { return res.json({ success: true, methods: await manual.publicMethods() }); }
  catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});
router.post("/manual/create", requireAuth, async (req, res) => {
  try { return res.status(201).json({ success: true, payment: await manual.createManualPayment(req.user.id, req.body?.plan, req.body?.method) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});
router.post("/manual/:reference/submit", requireAuth, async (req, res) => {
  try { return res.json({ success: true, payment: await manual.submitReference(req.user.id, req.params.reference, req.body?.operatorReference) }); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
});
router.post("/wave/checkout", requireAuth, async (req, res) => {
  try {
    const payment = await createWavePayment(req.user.id, req.body?.plan);
    res.status(201).json({ success: true, payment });
  } catch (error) {
    console.error("Wave checkout:", error);
    res.status(error.status || 503).json({ success: false, code: error.code, error: error.message || "Paiement indisponible" });
  }
});
router.get("/:reference", requireAuth, async (req, res) => {
  const payment = await getUserPayment(req.user.id, req.params.reference, req.query.verify === "1");
  if (!payment) return res.status(404).json({ success: false, error: "Paiement introuvable" });
  res.json({ success: true, payment });
});

module.exports = { router, waveWebhook };
