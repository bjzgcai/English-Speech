const crypto = require("node:crypto");

const guestCookieName = "englisheval_guest";
const accessCookieName = "englisheval_access";
const guestTtlMs = 180 * 24 * 60 * 60 * 1000;
const guestIdPattern = /^guest:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isGuest(user) {
  return user?.identityType === "guest" || String(user?.openId || "").startsWith("guest:");
}

function createVisitorAccess({ readSession, parseCookies, useSecureSessionCookie }) {
  const signature = payload => {
    const secret = process.env.SESSION_SECRET || process.env.DINGTALK_APP_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is required when DingTalk credentials are absent.");
    return crypto.createHmac("sha256", secret).update(`guest\0${payload}`).digest("base64url");
  };

  function readGuest(req) {
    try {
      const [payload, signed, extra] = (parseCookies(req)[guestCookieName] || "").split(".");
      if (!payload || !signed || extra) return null;
      const expected = signature(payload);
      if (signed.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return null;
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!guestIdPattern.test(data.id) || !Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
      return data.id;
    } catch { return null; }
  }

  function resolveVisitor(req, res) {
    if (req.visitor) return req.visitor;
    const signedIn = readSession(req);
    if (signedIn?.openId && !isGuest(signedIn)) {
      req.visitor = { ...signedIn, identityType: "dingtalk" };
    } else {
      const id = readGuest(req) || `guest:${crypto.randomUUID()}`;
      const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + guestTtlMs })).toString("base64url");
      res.cookie(guestCookieName, `${payload}.${signature(payload)}`, {
        httpOnly: true, sameSite: "lax", secure: useSecureSessionCookie(),
        maxAge: guestTtlMs, path: "/",
      });
      req.visitor = {
        openId: id, identityType: "guest", name: `Guest ${id.slice(6, 14)}`,
        userId: "", unionId: "", jobNumber: "", email: "", orgEmail: "",
      };
    }
    res.set("Cache-Control", "no-store");
    res.set("X-Identity-Owner", req.visitor.openId);
    return req.visitor;
  }

  function setGuestSession(res, id) {
    const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + guestTtlMs })).toString("base64url");
    res.cookie(guestCookieName, `${payload}.${signature(payload)}`, { httpOnly: true, sameSite: "lax", secure: useSecureSessionCookie(), maxAge: guestTtlMs, path: "/" });
    res.cookie(accessCookieName, `${id}.${signature(id)}`, { httpOnly: true, sameSite: "lax", secure: useSecureSessionCookie(), maxAge: guestTtlMs, path: "/" });
  }

  function hasAccess(req, user) {
    if (user?.identityType === "dingtalk") return true;
    const value = (parseCookies(req)[accessCookieName] || "").split(".");
    return value.length === 2 && value[0] === user?.openId && value[1] === signature(value[0]);
  }

  function requireAccess(req, res, next) {
    requireVisitor(req, res, () => {
      if (hasAccess(req, req.user)) return next();
      return res.status(401).json({ code: "AUTH_REQUIRED", error: "DingTalk sign-in or an invitation code is required.", loginUrl: "/auth/dingtalk", inviteUrl: "/invite" });
    });
  }

  function requireVisitor(req, res, next) {
    try { req.user = resolveVisitor(req, res); }
    catch { return res.status(503).json({ error: "Visitor sessions are not configured." }); }
    const expected = req.get("X-Expected-Owner");
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if ((mutation || expected !== undefined) && expected !== req.user.openId) {
      return res.status(409).json({ code: "IDENTITY_CHANGED", error: "Your active identity changed. Refresh before continuing." });
    }
    next();
  }

  return { resolveVisitor, requireVisitor, requireAccess, hasAccess, setGuestSession };
}

module.exports = { createVisitorAccess, isGuest, guestCookieName, guestTtlMs };
