#!/usr/bin/env node
/**
 * scripts/contrast-audit.js — WCAG text/background contrast check.
 *
 * Renders every page in both language modes, resolves the surface each text
 * run actually sits on (compositing ancestor background layers), and reports
 * anything below WCAG AA: 4.5:1 for body text, 3:1 for large text.
 *
 * Background: the Chinese companion line injected by i18n.js lands on every
 * kind of surface, including accent-filled buttons and dark video panels. A
 * colour that reads well on one surface disappears on another, so this runs
 * the whole app rather than spot-checking a component.
 *
 * Usage:
 *   node scripts/contrast-audit.js              # resting state, Eng + 中
 *   node scripts/contrast-audit.js --states     # + hover, focus and 390px
 *   AUDIT_BASE_URL=http://10.1.130.9:3199 node scripts/contrast-audit.js
 *
 * Exits non-zero when anything fails, so it can gate a release.
 */
const { chromium } = require("playwright");

const BASE = process.env.AUDIT_BASE_URL || "http://localhost:3199";
const WITH_STATES = process.argv.includes("--states");

const PAGES = [
  ["Leaderboard", "/index.html"],
  ["Methodology", "/docs.html"],
  ["Prepare", "/prepare.html"],
  ["Intro", "/intro.html"],
  ["Privacy", "/privacy.html"],
  ["Invitation codes", "/invitation-codes.html"],
  ["Invite", "/invite"],
];

/**
 * Runs inside the page. Walks every element that owns text and returns the
 * contrast of that text against its effective background.
 */
function measure(root) {
  // getComputedStyle returns modern colour syntax verbatim for anything that is
  // not a plain rgb() -- `color(srgb 0.54 0.67 0.60)` for a color-mix(), oklch(),
  // etc. String parsing silently drops those, the ancestor walk then falls
  // through to the page background, and the result is wrong. Painting one pixel
  // is the only conversion that normalises every syntax the browser can produce
  // (canvas fillStyle by itself echoes the modern form back).
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const probe = canvas.getContext("2d", { willReadFrequently: true });
  const parseRGB = (s) => {
    if (!s) return null;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "rgba(0, 0, 0, 0)";
    probe.fillStyle = s;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList && el.classList.length) s += "." + [...el.classList].join(".");
    if (el.hasAttribute("data-lang-zh")) s += "[zh]";
    return s;
  };

  const out = [];
  // `root` is either document.body (whole page) or a single hovered control.
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "LINK") continue;

    let text = "";
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    if (tag === "INPUT" && el.placeholder) text = "placeholder: " + el.placeholder;
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    // Collect the background stack and the accumulated opacity.
    const bgStack = [];
    let opacity = 1;
    let hidden = false;
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") {
        hidden = true;
        break;
      }
      opacity *= parseFloat(cs.opacity);
      // An element's own background paints behind its own text.
      const bg = parseRGB(cs.backgroundColor);
      if (bg && bg.a > 0) bgStack.push(bg);
      node = node.parentElement;
    }
    if (hidden) continue;
    // Only skip what is effectively invisible. A blanket "opacity < 0.95"
    // guard would silently discard deliberately translucent text -- which is
    // precisely how the Chinese companion line was failing (opacity: .85) --
    // so the page is settled first and opacity is then taken at face value.
    if (opacity < 0.05) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    // Skip links sit off-canvas until focused.
    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth + 5000) continue;

    const cs = getComputedStyle(el);
    const fgRaw = parseRGB(cs.color);
    if (!fgRaw || fgRaw.a === 0) continue;

    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = bgStack.length - 1; i >= 0; i--) bg = over(bgStack[i], bg);
    const fg = over({ ...fgRaw, a: fgRaw.a * opacity }, bg);

    const fontSize = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const value = Math.round(ratio(fg, bg) * 100) / 100;

    out.push({
      text: text.slice(0, 60),
      selector: describe(el),
      fg: hex(fg),
      bg: hex(bg),
      ratio: value,
      required,
      fontSize,
      lang: el.hasAttribute("data-lang-zh") ? "zh" : "primary",
    });
  }
  return out;
}

const MEASURE_SRC = measure.toString();
const measurePage = (page) => page.evaluate((src) => eval("(" + src + ")")(document.body), MEASURE_SRC);

/**
 * Scroll the page so every fade-in section has settled before measuring.
 * `html { scroll-behavior: smooth }` makes programmatic scrollTo animate, so
 * the loop never actually reaches the bottom and low sections stay at
 * opacity 0 -- force instant scrolling for the duration, then wait until every
 * .reveal has actually flipped to its visible state.
 */
async function settle(page) {
  await page.evaluate(async () => {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
    root.style.scrollBehavior = previous;
  });
  await page
    .waitForFunction(
      () => [...document.querySelectorAll(".reveal")].every((el) => el.classList.contains("is-visible")),
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  let scanned = 0;

  try {
    for (const mode of ["en", "zh"]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((m) => {
        try {
          window.localStorage.setItem("oscanner-lang-mode", m);
        } catch (e) {}
      }, mode);
      const page = await ctx.newPage();
      for (const [name, path] of PAGES) {
        try {
          await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(700);
          await settle(page);
          const rows = await measurePage(page);
          scanned += rows.length;
          for (const r of rows) {
            if (r.ratio < r.required) failures.push({ mode, name, state: "resting", ...r });
          }
        } catch (e) {
          failures.push({ mode, name, state: "resting", error: e.message.split("\n")[0] });
        }

        if (!WITH_STATES) continue;

        // Hover every control that carries a Chinese companion line, and tab
        // into the skip link, which is only visible while focused.
        for (const host of await page.$$("button, a")) {
          if (!(await host.evaluate((n) => !!n.querySelector("[data-lang-zh]")))) continue;
          try {
            await host.hover({ timeout: 1200 });
          } catch {
            continue;
          }
          await page.waitForTimeout(120);
          for (const r of await host.evaluate(measure)) {
            scanned += 1;
            if (r.ratio < r.required) failures.push({ mode, name, state: "hover", ...r });
          }
        }
        await page.keyboard.press("Tab");
        await page.waitForTimeout(200);
        if (await page.evaluate(() => document.activeElement?.classList.contains("skip-link"))) {
          for (const r of await measurePage(page)) {
            if (r.ratio < r.required) failures.push({ mode, name, state: "focus-skip", ...r });
          }
        }
      }
      await ctx.close();
    }

    if (WITH_STATES) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(() => {
        try {
          window.localStorage.setItem("oscanner-lang-mode", "zh");
        } catch (e) {}
      });
      const page = await ctx.newPage();
      for (const [name, path] of PAGES) {
        await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(700);
        await settle(page);
        for (const r of await measurePage(page)) {
          scanned += 1;
          if (r.ratio < r.required) failures.push({ mode: "zh", name, state: "390px", ...r });
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        if (overflow > 1) failures.push({ mode: "zh", name, state: "390px", overflow, error: `horizontal overflow ${overflow}px` });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  for (const f of failures) {
    if (f.error) {
      console.log(`  ERROR               [${f.state}] ${f.mode} ${f.name}: ${f.error}`);
      continue;
    }
    console.log(
      `  ${String(f.ratio).padStart(5)}:1 (need ${f.required}) [${f.state}] ${f.mode.padEnd(2)} ${f.name.padEnd(
        17
      )} ${String(Math.round(f.fontSize)).padStart(2)}px ${f.lang.padEnd(7)} ${f.fg} on ${f.bg} | ${f.selector} | ${f.text}`
    );
  }
  console.log(
    `\ncontrast audit: ${scanned} text runs measured across ${PAGES.length} pages × ${WITH_STATES ? "2 modes + states + 390px" : "2 modes"}, ${failures.length} failing.`
  );
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
