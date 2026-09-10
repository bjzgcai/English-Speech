/* Quick verification of the Eng/中 language toggle (run against a local dev server). */
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3199";
const OUT = "/Users/carter/working/EnglishEval/output";

function ok(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
  if (!condition) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // --- Desktop: leaderboard ---
  await page.goto(`${BASE}/leaderboard`, { waitUntil: "domcontentloaded" });
  const toggle = page.locator(".lang-toggle");
  ok("toggle rendered in header", await toggle.count() === 1);
  ok("default mode is English", (await page.getAttribute("html", "data-lang-mode")) === "en");
  ok("no Chinese subs in Eng mode", (await page.locator("[data-lang-zh]").count()) === 0);

  await toggle.locator("button[data-lang-mode='zh']").click();
  await page.waitForTimeout(300);
  ok("html switches to zh mode", (await page.getAttribute("html", "data-lang-mode")) === "zh");
  const subCount = await page.locator("[data-lang-zh]").count();
  ok("Chinese subs injected", subCount > 0, `${subCount} subs`);
  const navZh = await page.locator(".main-nav a", { hasText: "排行榜" }).count();
  ok("nav link shows 排行榜", navZh >= 1);

  // Persistence across reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  ok("mode persists after reload (zh)", (await page.getAttribute("html", "data-lang-mode")) === "zh");
  ok("subs restored after reload", (await page.locator("[data-lang-zh]").count()) > 0);
  await page.screenshot({ path: `${OUT}/i18n-leaderboard-zh.png`, fullPage: false });

  // Switch back to Eng
  await toggle.locator("button[data-lang-mode='en']").click();
  await page.waitForTimeout(200);
  ok("switching back to Eng removes subs", (await page.locator("[data-lang-zh]").count()) === 0);

  // --- Examine page (static content + dynamic status) ---
  await page.goto(`${BASE}/examine`, { waitUntil: "domcontentloaded" });
  await page.locator(".lang-toggle button[data-lang-mode='zh']").click();
  await page.waitForTimeout(300);
  const examineSubs = await page.locator("[data-lang-zh]").count();
  ok("examine page gets bilingual subs", examineSubs > 0, `${examineSubs} subs`);
  await page.screenshot({ path: `${OUT}/i18n-examine-zh.png`, fullPage: false });

  // --- Methodology page ---
  await page.goto(`${BASE}/methodology`, { waitUntil: "domcontentloaded" });
  await page.locator(".lang-toggle button[data-lang-mode='zh']").click();
  await page.waitForTimeout(300);
  const docSubs = await page.locator("[data-lang-zh]").count();
  ok("methodology page gets bilingual subs", docSubs > 0, `${docSubs} subs`);
  await page.screenshot({ path: `${OUT}/i18n-methodology-zh.png`, fullPage: false });

  // --- Mobile 390: leaderboard ---
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${BASE}/leaderboard`, { waitUntil: "domcontentloaded" });
  await mobile.locator(".lang-toggle button[data-lang-mode='zh']").click();
  await mobile.waitForTimeout(300);
  ok("mobile: zh mode active", (await mobile.getAttribute("html", "data-lang-mode")) === "zh");
  ok("mobile: subs injected", (await mobile.locator("[data-lang-zh]").count()) > 0);
  await mobile.screenshot({ path: `${OUT}/i18n-mobile-zh.png`, fullPage: false });

  await browser.close();
  console.log("DONE");
})().catch((error) => {
  console.error("ERROR:", error);
  process.exitCode = 1;
});
