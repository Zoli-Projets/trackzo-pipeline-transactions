const crypto = require("crypto");

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function requireAdmin(req, res, next) {
  const configured = process.env.TRACKZO_ADMIN_API_KEY;
  if (!configured) {
    return res.status(503).json({ success: false, error: "Administration non configurée" });
  }

  const provided = req.get("x-admin-key") || "";
  if (!safeEqual(provided, configured)) {
    return res.status(401).json({ success: false, error: "Accès administrateur refusé" });
  }

  req.adminActor = req.get("x-admin-actor") || "ADMIN";
  next();
}

module.exports = { requireAdmin };
