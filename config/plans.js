const PLAN_CONFIG = Object.freeze({
  TRIAL: { code: "TRIAL", name: "Essai gratuit", price: 0, currency: "XOF", durationDays: 30, maxDevices: 5, purchasable: false },
  BASIC: { code: "BASIC", name: "Basic", price: 3000, currency: "XOF", durationDays: 30, maxDevices: 2, purchasable: true },
  PRO: { code: "PRO", name: "Pro", price: 5000, currency: "XOF", durationDays: 30, maxDevices: 5, purchasable: true },
  ENTERPRISE: { code: "ENTERPRISE", name: "Enterprise", price: 30000, currency: "XOF", durationDays: 365, maxDevices: 10, purchasable: true }
});

module.exports = { PLAN_CONFIG };
