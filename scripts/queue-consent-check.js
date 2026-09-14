// Regression guard for the queue consent dialog (`.queue-consent`, built in
// queue-client.js) on the pages that actually host it.
//
// Bug it locks down: the <dialog> is appended to <body>, i.e. outside the
// .workspace grid, and on /game and /examine it inherited styles.css's form
// baseline — `label { display: grid }` and `input { width: 100%; border: 2px
// solid #dcd9ed; border-radius: 14px; padding: 14px }`. Every checkbox was
// therefore painted as a full-width rounded text field with its caption pushed
// onto the next line, so the dialog showed a stray empty box above each
// sentence and the captions were no longer attached to their boxes.
//
// The assertions below are geometric on purpose: "the caption is on the same
// row as its checkbox and starts to the right of it" is the property that was
// broken, and it is the property a stylesheet change can break again. The
// dialog is driven through the real client (`EvaluationQueue.submit`) with the
// consent GET stubbed, so the markup under test is the production markup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { listenForTest } = require('./test-http');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-consent-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATA_DIR: data,
  QUEUE_ENABLED: 'false',
  SESSION_SECRET: 'queue-consent-secret',
  COOKIE_SECURE: 'false',
  DINGTALK_APP_KEY: 'test',
  DINGTALK_APP_SECRET: 'test',
  DINGTALK_CORP_ID: 'test',
  APP_BASE_URL: '',
});
const { app, testHelpers } = require('../src/app');

const OUT = path.join(process.cwd(), 'output');
const ACCENT = 'rgb(101, 88, 232)';

// Collections the client can report: the two live capture modes plus the
// video-upload path, which sends none (an uploaded file always carries video).
const VARIANTS = [
  { name: 'audio', collection: 'audio', expect: 'audio', video: false },
  { name: 'camera', collection: 'camera', expect: 'camera', video: true },
  // No collection at all: the upload path, recorded as "upload" because no live
  // capture happened. It shares the video wording, so only the POST tells them
  // apart.
  { name: 'upload', collection: undefined, expect: 'upload', video: true },
];

function probe() {
  const dialog = document.querySelector('.queue-consent');
  if (!dialog) return { missing: true };
  const box = dialog.getBoundingClientRect();
  const reading = rect => ({
    left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
    w: rect.width, h: rect.height,
  });
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    box: reading(box),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    clipped: box.top < 0 || box.bottom > window.innerHeight ||
      box.left < 0 || box.right > window.innerWidth,
    scrollHeight: dialog.scrollHeight,
    clientHeight: dialog.clientHeight,
    heading: document.querySelector('.queue-consent h2')?.textContent || '',
    background: getComputedStyle(dialog).backgroundColor,
    headingInk: getComputedStyle(document.querySelector('.queue-consent h2')).color,
    paragraphInk: document.querySelector('.queue-consent p')
      ? getComputedStyle(document.querySelector('.queue-consent p')).color
      : null,
    text: (dialog.innerText || '').replace(/\s+/g, ' ').trim(),
    labels: [...dialog.querySelectorAll('label')].map(label => {
      const input = label.querySelector('input[type="checkbox"]');
      const ir = input.getBoundingClientRect();
      // Every client rect of every caption text node: one per rendered line.
      // A caption that is not a single element (a bare text run sharing the
      // label with the inline policy link) is broken up into several grid
      // items, and the link lands inside the checkbox column — visible as a
      // caption rect starting left of the checkbox's own right edge.
      const rects = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) if (rect.width > 1) rects.push(rect);
      }
      // Per text node, so an inline link is its own rect. Merge the rects that
      // share a rendered line to recover real line extents.
      const lines = [];
      for (const rect of rects.slice().sort((a, b) => a.top - b.top)) {
        const line = lines.find(entry => rect.top < entry.bottom - 1 && rect.bottom > entry.top + 1);
        if (line) {
          line.left = Math.min(line.left, rect.left);
          line.right = Math.max(line.right, rect.right);
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
        } else {
          lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        }
      }
      return {
        display: getComputedStyle(label).display,
        color: getComputedStyle(label).color,
        label: reading(label.getBoundingClientRect()),
        input: reading(ir),
        firstLine: lines.length ? reading(lines[0]) : null,
        // The left-most ink of the whole caption: it must clear the checkbox.
        captionLeft: rects.length ? Math.min(...rects.map(rect => rect.left)) : null,
        widest: lines.reduce((max, line) => Math.max(max, line.right - line.left), 0),
        lineCount: lines.length,
        text: (label.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    }),
    buttons: [...dialog.querySelectorAll('button')].map(button => {
      const style = getComputedStyle(button);
      return {
        value: button.value,
        label: (button.textContent || '').trim(),
        background: style.backgroundColor,
        color: style.color,
        disabled: button.disabled,
        ...reading(button.getBoundingClientRect()),
      };
    }),
  };
}

// WCAG relative luminance / contrast ratio, so the dialog's own palette is
// checked where it is rendered (`--muted` on `--panel` and white on `--accent`
// are both one shade away from failing).
function luminance(color) {
  const channels = (color.match(/\d+/g) || []).slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertDialog(label, state, { wantVideo }) {
  assert.ok(!state.missing, `${label}: .queue-consent was never created`);
  assert.ok(state.box.w > 200 && state.box.h > 150,
    `${label}: dialog collapsed to ${Math.round(state.box.w)}x${Math.round(state.box.h)}`);
  assert.ok(!state.clipped,
    `${label}: dialog escapes the ${state.viewport.w}x${state.viewport.h} viewport — ${JSON.stringify(state.box)}`);
  assert.ok(state.overflowX <= 0, `${label}: page scrolls horizontally by ${state.overflowX}px`);
  assert.equal(state.scrollHeight, state.clientHeight,
    `${label}: the dialog's content overflows its own height cap`);
  // Centred: the two gaps around it are the same.
  const topGap = state.box.top;
  const bottomGap = state.viewport.h - state.box.bottom;
  assert.ok(Math.abs(topGap - bottomGap) <= 8,
    `${label}: dialog is not centred — topGap=${Math.round(topGap)} bottomGap=${Math.round(bottomGap)}`);

  assert.equal(state.labels.length, 2, `${label}: expected two acknowledgements`);
  for (const [index, entry] of state.labels.entries()) {
    const where = `${label}: acknowledgement ${index + 1}`;
    // The regression: the checkbox was a full-width text field (~450px).
    assert.ok(entry.input.w >= 14 && entry.input.w <= 24 && entry.input.h >= 14 && entry.input.h <= 24,
      `${where} — the checkbox is ${Math.round(entry.input.w)}x${Math.round(entry.input.h)}, not a native control (did the global input restyle leak back in?): ${entry.text}`);
    assert.ok(entry.firstLine, `${where} has no measurable caption line`);
    // Caption beside the box, not under it.
    assert.ok(entry.firstLine.left >= entry.input.right - 1,
      `${where} — the caption starts at x=${Math.round(entry.firstLine.left)}, left of/over the checkbox ending at x=${Math.round(entry.input.right)} (wrap onto the next line?)`);
    // No caption ink may fall inside the checkbox column. This is what an
    // unwrapped caption looks like: the inline policy link becomes its own grid
    // item and is dropped into the 20px column, where it breaks mid-word.
    assert.ok(entry.captionLeft >= entry.input.right + 4,
      `${where} — caption text starts at x=${Math.round(entry.captionLeft)}, inside the checkbox column (right edge x=${Math.round(entry.input.right)}). Is the caption still a single element in the label?`);
    // Same visual row: the middle of the first caption line meets the middle of
    // the box.
    const inputMiddle = (entry.input.top + entry.input.bottom) / 2;
    const lineMiddle = (entry.firstLine.top + entry.firstLine.bottom) / 2;
    assert.ok(Math.abs(inputMiddle - lineMiddle) <= 5,
      `${where} — the checkbox sits ${Math.round(lineMiddle - inputMiddle)}px off its caption's first line`);
    // The caption has real width to wrap into; a caption squeezed into a narrow
    // column (or broken one word per line) never gets there.
    assert.ok(entry.widest >= 120,
      `${where} — the widest caption line is only ${Math.round(entry.widest)}px: the caption has no usable column`);
  }

  assert.equal(state.buttons.length, 2, `${label}: expected cancel + accept`);
  const cancel = state.buttons.find(button => button.value === 'cancel');
  const accept = state.buttons.find(button => button.value === 'accept');
  assert.ok(cancel && accept, `${label}: missing a cancel/accept button`);
  for (const button of state.buttons) {
    assert.ok(button.w >= 120, `${label}: "${button.label}" was squeezed to ${Math.round(button.w)}px`);
    assert.ok(button.top >= state.box.top && button.bottom <= state.box.bottom,
      `${label}: "${button.label}" left the dialog`);
    assert.ok(!button.disabled, `${label}: "${button.label}" is disabled`);
  }
  // Cancel is the quiet action, accept the primary one.
  assert.equal(accept.background, ACCENT, `${label}: accept is not the primary colour (${accept.background})`);
  assert.notEqual(cancel.background, accept.background,
    `${label}: cancel and accept are painted identically`);

  // Every piece of text has to stay readable on whatever it is painted on.
  const surfaces = [
    ['heading', state.headingInk], ['paragraph', state.paragraphInk],
    ...state.labels.map((entry, index) => [`caption ${index + 1}`, entry.color]),
    ...state.buttons.map(button => [`"${button.label}"`, button.color, button.background]),
  ];
  for (const [what, foreground, ownBackground] of surfaces) {
    if (!foreground) continue;
    const ratio = contrast(foreground, ownBackground || state.background);
    assert.ok(ratio >= 4.5,
      `${label}: ${what} is only ${ratio.toFixed(2)}:1 on ${ownBackground || state.background} — below AA`);
  }

  // Wording follows the collection. Promising video on an audio-only answer —
  // or dropping it for an uploaded video — is the defect this surface shares
  // with the prepare-dialog gate. Audio-only is allowed to *mention* video only
  // to disclaim it ("collects no video and samples no frames"), so a bare
  // keyword search would be wrong in both directions.
  assert.ok(/audio/i.test(state.text), `${label}: no audio wording at all — ${state.text}`);
  const videoSentences = state.text.split(/(?<=\.)\s+/).filter(sentence => /video|frames/i.test(sentence));
  if (wantVideo) {
    assert.ok(videoSentences.length > 0, `${label}: the copy never mentions the video it collects — ${state.text}`);
    const disclaiming = videoSentences.filter(sentence => /no video|no frames/i.test(sentence));
    assert.deepEqual(disclaiming, [], `${label}: the video copy disclaims the video: ${disclaiming.join(' | ')}`);
  } else {
    assert.ok(videoSentences.length > 0,
      `${label}: audio-only copy is silent about video — it must say no video is collected — ${state.text}`);
    const promising = videoSentences.filter(sentence => !/no video|no frames/i.test(sentence));
    assert.deepEqual(promising, [],
      `${label}: audio-only copy still promises video: ${promising.join(' | ')}`);
  }

  return { cancel, accept };
}

async function run(browser, base, { route, width, variant }) {
  const label = `${route} @ ${width} [${variant.name}]`;
  const owner = `consent-${route}-${width}-${variant.name}`;
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.route('**/api/privacy-consent', route_ => {
    const request = route_.request();
    if (request.method() === 'GET') {
      return route_.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agreed: false, policyVersion: 'test', collectionMode: null, acceptedAt: null }) });
    }
    const body = JSON.parse(request.postData() || '{}');
    posts.push(body);
    return route_.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ agreed: true, policyVersion: 'test', collectionMode: body.collectionMode || null, acceptedAt: new Date().toISOString() }) });
  });
  await context.addCookies([{
    name: 'englisheval_session',
    value: testHelpers.createSessionToken({ openId: owner, name: 'Consent Tester' }),
    url: base,
  }]);

  console.log(`\n=== ${label} ===`);
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.EvaluationQueue && window.VisitorSession, null, { timeout: 15000 });

  // Drive the production path: retain the draft, resolve the identity, then let
  // consent() build and open the dialog. The rejection on cancel is captured so
  // the run stays free of console noise.
  await page.evaluate(({ collection, owner }) => {
    const form = new FormData();
    form.append('video', new File([new Uint8Array([1, 2, 3])], 'answer.webm', { type: 'video/webm' }));
    form.append('submissionId', 'consent-probe');
    window.__consent = window.EvaluationQueue
      .submit(form, collection ? { owner, collection } : { owner })
      .then(() => 'resolved', error => (error.name === 'AbortError' ? 'canceled' : `error: ${error.message}`));
  }, { collection: variant.collection, owner });

  await page.locator('.queue-consent').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(200);
  const state = await page.evaluate(probe);
  const { cancel } = assertDialog(label, state, { wantVideo: variant.video });

  const tag = `${variant.name}-${width}${route === '/examine' ? '' : '-' + route.replace(/\W/g, '')}`;
  await page.screenshot({ path: path.join(OUT, `queue-consent-${tag}.png`) });

  // Two buttons on one row while there is room, stacked on a phone.
  const tops = state.buttons.map(button => Math.round(button.top));
  if (width >= 600) {
    assert.equal(new Set(tops).size, 1, `${label}: the buttons did not share a row (tops ${tops})`);
    assert.ok(Math.max(...state.buttons.map(button => button.h)) <= 56,
      `${label}: a button wrapped onto a second line`);
  } else {
    assert.ok(Math.abs(tops[0] - tops[1]) > 20, `${label}: the buttons did not stack on a phone (tops ${tops})`);
  }

  // Cancel must close it; the dialog is a gate, not a page.
  await page.locator('.queue-consent button[value="cancel"]').click();
  await page.locator('.queue-consent').waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__consent), 'canceled',
    `${label}: cancelling did not abort the submission`);

  const real = errors.filter(error => !/404|500/.test(error));
  assert.deepEqual(real, [], `${label}: console/page errors:\n${real.join('\n')}`);

  // Second pass, accepting this time: the recorded mode has to reach the server.
  // The upload variant shares the camera wording, so only the POST separates them.
  await page.evaluate(({ collection, owner }) => {
    const form = new FormData();
    form.append('video', new File([new Uint8Array([1, 2, 3])], 'answer.webm', { type: 'video/webm' }));
    form.append('submissionId', 'consent-probe-accept');
    window.__consent2 = window.EvaluationQueue
      .submit(form, collection ? { owner, collection } : { owner })
      .then(() => 'resolved', error => `ended: ${error.name}`);
  }, { collection: variant.collection, owner });
  await page.locator('.queue-consent').waitFor({ state: 'visible', timeout: 10000 });
  // Both acknowledgements are `required`: with either box unticked the accept
  // button must be inert, or a consent record could be written without one.
  await page.locator('.queue-consent button[value="accept"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.queue-consent').count(), 1,
    `${label}: the dialog closed on accept while both acknowledgements were unticked`);
  assert.equal(posts.length, 0, `${label}: consent was recorded before the boxes were ticked`);
  const boxes = page.locator('.queue-consent input[type="checkbox"]');
  for (let index = 0; index < await boxes.count(); index++) await boxes.nth(index).check();
  await page.locator('.queue-consent button[value="accept"]').click();
  for (let attempt = 0; attempt < 50 && !posts.length; attempt++) await page.waitForTimeout(100);
  assert.equal(posts.length, 1, `${label}: accepting posted ${posts.length} consent records`);
  assert.equal(posts[0].collectionMode, variant.expect,
    `${label}: recorded collectionMode=${JSON.stringify(posts[0].collectionMode)}`);

  await context.close();
  console.log(`  ok — dialog ${Math.round(state.box.w)}x${Math.round(state.box.h)}, checkbox ${Math.round(state.labels[0].input.w)}px, ${cancel.label}/${state.buttons.find(b => b.value === 'accept').label}, recorded ${posts[0].collectionMode}`);
}

// The prepare-dialog gate (app.js) is the other place a consent record is
// written. It reads the same camera toggle, so the mode it reports is asserted
// here too — a wrong value in a consent record is silent otherwise.
async function runGate(browser, base, { useCamera }) {
  const label = `/examine gate [${useCamera ? 'camera' : 'audio'}]`;
  const owner = `consent-gate-${useCamera ? 'camera' : 'audio'}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let posted = null;
  await page.route('**/api/privacy-consent', route_ => {
    const request = route_.request();
    if (request.method() === 'GET') {
      return route_.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agreed: false, policyVersion: 'test', collectionMode: null, acceptedAt: null }),
      });
    }
    posted = JSON.parse(request.postData() || '{}');
    return route_.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ agreed: true, policyVersion: 'test', collectionMode: posted.collectionMode || null, acceptedAt: new Date().toISOString() }),
    });
  });
  await context.addCookies([{
    name: 'englisheval_session',
    value: testHelpers.createSessionToken({ openId: owner, name: 'Gate Tester' }),
    url: base,
  }]);
  await context.addInitScript(mode => { try { localStorage.setItem('oscanner-use-camera', mode); } catch {} },
    useCamera ? 'true' : 'false');

  console.log(`\n=== ${label} ===`);
  await page.goto(base + '/examine', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const button = document.querySelector('#generateButton');
    return button && !button.disabled;
  }, null, { timeout: 15000 });
  await page.locator('#generateButton').click();
  // The gate opens before the question request, so no model call is needed.
  await page.waitForFunction(() => document.querySelector('#privacyConsentModal')?.hidden === false,
    null, { timeout: 15000 });
  await page.locator('#acceptPrivacyButton').click();
  for (let attempt = 0; attempt < 50 && !posted; attempt++) await page.waitForTimeout(100);

  assert.ok(posted, `${label}: accepting the gate never posted a consent`);
  assert.equal(posted.privacyAgreed, true, `${label}: privacyAgreed missing from the consent POST`);
  assert.equal(posted.sensitiveInfoAgreed, true, `${label}: sensitiveInfoAgreed missing from the consent POST`);
  assert.equal(posted.collectionMode, useCamera ? 'camera' : 'audio',
    `${label}: the gate recorded collectionMode=${JSON.stringify(posted.collectionMode)}`);
  console.log(`  ok — gate posted collectionMode=${posted.collectionMode}`);
  await context.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await listenForTest(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    // /examine is where the misalignment was reported; the other two hosts
    // prove the dialog does not depend on one page's layout. /docs.html is the
    // interesting one: it never loads styles.css, so the resets must be
    // self-sufficient there as well.
    for (const variant of VARIANTS) {
      for (const width of [1440, 390]) {
        await run(browser, base, { route: '/examine', width, variant });
      }
    }
    await run(browser, base, { route: '/game', width: 1440, variant: VARIANTS[0] });
    await run(browser, base, { route: '/docs.html', width: 1440, variant: VARIANTS[0] });
    for (const useCamera of [true, false]) await runGate(browser, base, { useCamera });
    console.log('\nOK: the queue consent dialog is aligned, centred and mode-accurate on every host');
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
