const path = require("path");
const { openApiFile, publicDir, rootDir } = require("../config");

function registerPageRoutes(app, { requirePageAuth }) {
  app.get("/openapi.yaml", (_req, res) => {
    res.type("application/yaml").sendFile(openApiFile);
  });

  app.get(["/api-docs", "/api-docs/"], (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OScanner-Eng Partner API</title><link rel="stylesheet" href="/api-docs/assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="/api-docs/assets/swagger-ui-bundle.js"></script>
<script src="/api-docs/assets/swagger-ui-standalone-preset.js"></script><script>
SwaggerUIBundle({url:"/openapi.yaml",dom_id:"#swagger-ui",deepLinking:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"StandaloneLayout"});
</script></body></html>`);
  });

  const sendAppShell = (_req, res) => res.sendFile(path.join(publicDir, "index.html"));
  const protectedAppRoutes = ["/leaderboard", "/game", "/examine", "/practice", "/history"];

  app.get("/", requirePageAuth, (_req, res) => res.redirect(302, "/leaderboard"));
  app.get(protectedAppRoutes, requirePageAuth, sendAppShell);
  app.get("/admin", requirePageAuth, (_req, res) =>
    res.sendFile(path.join(rootDir, "views", "admin.html")),
  );

  // Public page whitelist: these routes intentionally remain available without a session.
  app.get("/intro", (_req, res) => res.sendFile(path.join(publicDir, "intro.html")));
  app.get("/methodology", (_req, res) => res.sendFile(path.join(publicDir, "docs.html")));
  app.get("/prepare", (_req, res) => res.sendFile(path.join(publicDir, "prepare.html")));
  app.get(["/privacy", "/policy"], (_req, res) =>
    res.sendFile(path.join(publicDir, "privacy.html")),
  );
}

module.exports = { registerPageRoutes };
