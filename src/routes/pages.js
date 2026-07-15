const path = require("path");
const { openApiFile, publicDir } = require("../config");

function registerPageRoutes(app) {
  app.get("/openapi.yaml", (_req, res) => {
    res.type("application/yaml").sendFile(openApiFile);
  });

  app.get(["/api-docs", "/api-docs/"], (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EnglishEval Partner API</title><link rel="stylesheet" href="/api-docs/assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="/api-docs/assets/swagger-ui-bundle.js"></script>
<script src="/api-docs/assets/swagger-ui-standalone-preset.js"></script><script>
SwaggerUIBundle({url:"/openapi.yaml",dom_id:"#swagger-ui",deepLinking:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"StandaloneLayout"});
</script></body></html>`);
  });

  const sendAppShell = (_req, res) => res.sendFile(path.join(publicDir, "index.html"));
  app.get("/", sendAppShell);
  app.get("/examine", sendAppShell);
  app.get("/practice", sendAppShell);
  app.get("/history", sendAppShell);
  app.get("/methodology", (_req, res) => res.sendFile(path.join(publicDir, "docs.html")));
  app.get("/prepare", (_req, res) => res.sendFile(path.join(publicDir, "prepare.html")));
  app.get(["/privacy", "/policy"], (_req, res) =>
    res.sendFile(path.join(publicDir, "privacy.html")),
  );
}

module.exports = { registerPageRoutes };
