const crypto = require("crypto");
const fetch = require("node-fetch");

const BASE_URL = "https://api.wave.com";

function requireApiKey() {
  const key = String(process.env.WAVE_API_KEY || "").trim();
  if (!key) {
    const error = new Error("Paiement Wave temporairement indisponible");
    error.code = "WAVE_NOT_CONFIGURED";
    throw error;
  }
  return key;
}

function signatureFor(body) {
  const secret = String(process.env.WAVE_API_SIGNING_SECRET || "").trim();
  if (!secret) return null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = crypto.createHmac("sha256", secret).update(timestamp + body).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function waveRequest(method, path, payload) {
  const body = payload == null ? "" : JSON.stringify(payload);
  const headers = { Authorization: `Bearer ${requireApiKey()}` };
  if (payload != null) headers["Content-Type"] = "application/json";
  const signature = signatureFor(body);
  if (signature) headers["Wave-Signature"] = signature;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(payload == null ? {} : { body })
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    console.error("Wave API error", response.status, data);
    const error = new Error("Wave n’a pas pu initialiser ou vérifier le paiement");
    error.code = "WAVE_API_ERROR";
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

function publicReturnUrl(kind) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base || !/^https:\/\//i.test(base)) throw new Error("PUBLIC_BASE_URL HTTPS est requis pour Wave");
  return `${base}/payment/wave/${kind}`;
}

async function createCheckout({ amount, currency, clientReference }) {
  return waveRequest("POST", "/v1/checkout/sessions", {
    amount: String(amount),
    currency,
    client_reference: clientReference,
    success_url: publicReturnUrl("success"),
    error_url: publicReturnUrl("error")
  });
}

async function getCheckout(id) {
  return waveRequest("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`);
}

function verifyWebhookSignature(rawBody, header) {
  const secret = String(process.env.WAVE_WEBHOOK_SIGNING_SECRET || "").trim();
  if (!secret || !Buffer.isBuffer(rawBody) || !header) return false;
  const parts = String(header).split(",").map((v) => v.trim());
  const timestamp = parts.find((v) => v.startsWith("t="))?.slice(2);
  const signatures = parts.filter((v) => v.startsWith("v1=")).map((v) => v.slice(3));
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + rawBody.toString("utf8")).digest("hex");
  return signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(candidate, "hex"));
  });
}

module.exports = { createCheckout, getCheckout, verifyWebhookSignature };
