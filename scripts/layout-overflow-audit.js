#!/usr/bin/env node
/**
 * scripts/layout-overflow-audit.js — does content stay inside the box that
 * owns it?
 *
 * Background: the camera guidance card lays its label, paragraph and device
 * chips out in one bar. The chip pair is bilingual in 中 mode and measures
 * ~515px, so when it was placed in an `auto`/`1fr` grid track the track could
 * never shrink below the chips' content width and the row pushed the chips
 * past the card border on every desktop width -- the card's `border-radius`
 * made it obvious, nothing caught it.
 *
 * The recorder panel sits behind authentication, so this unhides the panel in
 * the DOM instead of signing in. Everything it checks is pure CSS layout.
 *
 * Usage:
 *   AUDIT_BASE_URL=http://10.1.130.9:3199 node scripts/layout-overflow-audit.js
 *   node scripts/layout-overflow-audit.js                 # localhost:3199
 *
 * Exits non-zero when anything overflows, so it can gate a release.
 */
const { chromium } = require("playwright");

const BASE = process.env.AUDIT_BASE_URL || "http://localhost:3199";

/* Widths that bracket the breakpoints the guidance bar uses: the stacked
   mobile layout, the 821px hand-off to the inline bar, and the desktop range
   where the bilingual chips are wider than the card. */
const INLINE_VIEWPORTS = [
  [390, 844],
  [768, 900],
  [821, 900],
  [900, 900],
  [960, 900],
  [1000, 900],
  [1080, 900],
  [1200, 900],
  [1440, 900],
];

/* The recording dialog squeezes the same chips into a ~250px column. */
const DIALOG_VIEWPORTS = [
  [1440, 900],
  [1280, 900],
  [900, 800],
  [500, 420],
  [390, 844],
];

/**
 * Runs inside the page: reveals the recorder panel without signing in and
 * returns every .camera-guidance descendant that leaves the card's padding box.
 */
function inspect() {
  const panel = document.querySelector(".recorder-panel");
  if (!panel) return { error: "no .recorder-panel in the document" };

  // The router hides inactive views with the `hidden` attribute or with an
  // inline display:none; both have to go before anything can be measured.
  for (let el = panel; el; el = el.parentElement) {
    el.removeAttribute("hidden");
    if (el.style && el.style.display === "none") el.style.display = "";
  }
  for (const node of panel.querySelectorAll("[hidden]")) {
    if (node.closest("dialog") || node.tagName === "BUTTON") continue;
    if (node.matches(".discard-modal, .video-modal, .discard-dialog, [role=dialog]")) continue;
    node.removeAttribute("hidden");
  }

  const card = panel.querySelector(".camera-guidance");
  if (!card) return { error: "no .camera-guidance inside the recorder panel" };

  const cs = getComputedStyle(card);
  const rect = card.getBoundingClientRect();
  const left = rect.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const right = rect.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
  const overflows = [];

  for (const node of card.querySelectorAll("*")) {
    if (getComputedStyle(node).display === "none") continue;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    // Distance past whichever edge is crossed: `left - r.left` on the left,
    // `r.right - right` on the right. Anything at or inside the padding box is
    // negative here, so a single threshold covers both directions.
    const out = Math.max(left - r.left, r.right - right);
    if (out > 1) {
      overflows.push({
        selector: node.tagName.toLowerCase() + (node.className ? "." + String(node.className).trim().split(/\s+/).join(".") : ""),
        text: (node.textContent || "").trim().slice(0, 48),
        overflowBy: Math.round(out),
      });
    }
  }

  const scrollers = [];
  for (const [name, el] of [["card", card], ["panel", panel]]) {
    const diff = el.scrollWidth - el.clientWidth;
    if (diff > 1) scrollers.push({ name, diff });
  }

  return {
    language: document.documentElement.getAttribute("data-lang-mode") || "en",
    settled: !!card.querySelector(".device-status > span"),
    chipCount: card.querySelectorAll(".device-status > span").length,
    overflows,
    scrollers,
    documentOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  };
}

/** Replaces the guidance bar with the markup the recorder moves into the dialog. */
function openRecordingDialog() {
  const dialog = document.querySelector(".prepare-dialog");
  const slot = document.getElementById("recorderModalSlot");
  const panel = document.querySelector(".recorder-panel");
  if (!dialog || !slot || !panel) return false;
  slot.appendChild(panel);
  slot.removeAttribute("hidden");
  dialog.classList.add("is-recording");
  dialog.classList.remove("is-countdown");
  const modal = document.getElementById("prepareModal");
  if (modal) modal.removeAttribute("hidden");
  for (const node of dialog.querySelectorAll(".prepare-content")) node.setAttribute("hidden", "");
  return true;
}

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  let checks = 0;
  try {
    for (const [mode, setup, viewports] of [
      ["en", "inline", INLINE_VIEWPORTS],
      ["zh", "inline", INLINE_VIEWPORTS],
      ["zh", "dialog", DIALOG_VIEWPORTS],
      ["en", "dialog", DIALOG_VIEWPORTS],
    ]) {
      const ctx = await browser.newContext({ deviceScaleFactor: 1 });
      await ctx.addInitScript((lang) => {
        try {
          window.localStorage.setItem("oscanner-lang-mode", lang);
        } catch (e) {}
      }, mode);
      const page = await ctx.newPage();

      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        await page.goto(BASE + "/game", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(400);
        if (setup === "dialog") {
          const moved = await page.evaluate(openRecordingDialog);
          if (!moved) {
            failures.push({ where: `${mode} dialog`, detail: "recorder panel could not be moved into the prepare dialog" });
            continue;
          }
          await page.waitForTimeout(150);
        }
        // First call reveals the panel and forces a layout; the second one
        // measures it once the browser has settled.
        await page.evaluate(inspect);
        const result = await page.evaluate(inspect);
        checks += 1;

        const where = `${mode} ${setup} ${width}x${height}`;
        if (result.error) {
          failures.push({ where, detail: result.error });
          continue;
        }
        if (result.language !== mode) {
          failures.push({ where, detail: `language mode did not settle (${result.language})` });
        }
        if (!result.settled || result.chipCount < 2) {
          failures.push({ where, detail: `device status chips missing (found ${result.chipCount})` });
        }
        for (const o of result.overflows) {
          failures.push({ where, detail: `${o.selector} "${o.text}" leaves the card by ${o.overflowBy}px` });
        }
        for (const s of result.scrollers) {
          failures.push({ where, detail: `${s.name} scrolls horizontally by ${s.diff}px` });
        }
        if (result.documentOverflow > 1) {
          failures.push({ where, detail: `page scrolls horizontally by ${result.documentOverflow}px` });
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  for (const f of failures) console.log(`  OVERFLOW  ${f.where}: ${f.detail}`);
  console.log(`\nlayout overflow audit: ${checks} layouts rendered, ${failures.length} failing.`);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
