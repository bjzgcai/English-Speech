// Keep scripts local except for the pinned DingTalk SDK needed by native sign-in.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://g.alicdn.com/dingding/dingtalk-jsapi/2.14.1/dingtalk.open.js",
  "script-src-attr 'none'",
  // Existing score charts and layout controls set inline CSS custom properties.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(self)',
  });
  // TLS termination at nginx supplies HSTS itself. Never trust arbitrary
  // X-Forwarded-Proto headers or force HTTPS on the local HTTP development port.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  if (/^\/(api|auth)(\/|$)/.test(req.path)) res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { securityHeaders };
