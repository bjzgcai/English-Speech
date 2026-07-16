const assert = require("node:assert/strict");
const test = require("node:test");
const QRCode = require("qrcode");

process.env.NODE_ENV = "test";
process.env.APP_BASE_URL = "https://english.example.test/service";

const { app } = require("../src/app");

test("share QR points to the configured public service origin", async (context) => {
  const server = app.listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/share-qr`);
  const actual = Buffer.from(await response.arrayBuffer());
  const expected = await QRCode.toBuffer("https://english.example.test/service/", {
    type: "png",
    width: 320,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#17201B",
      light: "#FFFFFFFF",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(actual, expected);
});
