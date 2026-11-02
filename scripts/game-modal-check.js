// Regression guard for the prepare modal on /game and /examine, in both input
// modes (camera + audio only).
//
// Bug it locks down: index.html was missing the closing tag of `.prepare-content`,
// so `.prepare-footer`, `#recorderModalSlot`, `#discardModal` and
// `#privacyConsentModal` all ended up nested inside it. Two consequences:
//   * `#discardModal` / `#privacyConsentModal` became children of `#prepareModal`
//     and were invisible whenever the prepare modal was hidden.
//   * `#recorderModalSlot` sat inside `.prepare-content`, which
//     `.prepare-dialog.is-recording` sets to `display:none !important`. Clicking
//     "Start now" therefore moved the recorder into a hidden subtree and the modal
//     rendered as a blank card.
// The blank card differed per mode: with the camera on it swallowed the video
// preview, in audio-only mode it swallowed the question and controls, so both
// modes are exercised here.
// Admission is stubbed: the queue worker does not run here, and a modal-layout
// test must not depend on evaluation capacity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { listenForTest } = require('./test-http');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'game-modal-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATA_DIR: data,
  QUEUE_ENABLED: 'false',
  SESSION_SECRET: 'game-modal-secret',
  COOKIE_SECURE: 'false',
  DINGTALK_CLIENT_ID: 'test',
  DINGTALK_CLIENT_SECRET: 'test',
  DINGTALK_CORP_ID: 'test',
  APP_BASE_URL: '',
});
const { app, testHelpers } = require('../src/app');

const FAKE_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

const OUT = path.join(process.cwd(), 'output');
const REQUIRED_FIGURE_FIXTURE = path.resolve(__dirname, '../public/assets/figures/l13-research-statement-figure.png');
const MODES = { camera: 'true', audio: 'false' };
const GROUP_ONE_REQUIREMENT_PROMPTS = Object.freeze({
  'Writing a paper title and abstract for your research project': {
    sections: 2,
    items: 10,
    ordered: false,
  },
  'Writing an academic paper in English': {
    sections: 1,
    items: 5,
    ordered: true,
  },
});

function probe() {
  const pick = sel => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160),
      hidden: el.hidden,
      display: cs.display,
      visibility: cs.visibility,
      box: [Math.round(r.width), Math.round(r.height)],
      parent: el.parentElement?.id || el.parentElement?.className?.split(/\s+/)[0] || null,
    };
  };
  const dialog = document.querySelector('.prepare-dialog');
  const dr = dialog.getBoundingClientRect();
  const dcs = getComputedStyle(dialog);
  const modal = document.querySelector('#prepareModal');
  const mr = modal.getBoundingClientRect();
  const liveStream = document.querySelector('#preparePreview')?.srcObject
    || document.querySelector('#preview')?.srcObject || null;
  return {
    dialog: {
      classes: dialog.className, hidden: dialog.hidden, display: dcs.display,
      visibility: dcs.visibility, box: [Math.round(dr.width), Math.round(dr.height)],
    },
    // How the dialog sits inside the backdrop: a bottom-anchored sheet shows up
    // as an uneven (topGap, bottomGap) pair.
    placement: {
      align: getComputedStyle(modal).alignItems,
      topGap: Math.round(dr.top - mr.top),
      bottomGap: Math.round(mr.bottom - dr.bottom),
      clipped: dr.top < 0 || dr.bottom > window.innerHeight,
    },
    kicker: pick('#prepareModalKicker'),
    title: pick('#prepareModalTitle'),
    countdown: pick('#countdownDisplay'),
    hud: pick('#recordingBadge'),
    startNow: pick('#speakDirectlyButton'),
    slot: pick('#recorderModalSlot'),
    footer: pick('.prepare-footer'),
    guidance: pick('#prepareCameraGuidance'),
    previewWrap: pick('#preparePreviewWrap'),
    discardModal: pick('#discardModal'),
    consentModal: pick('#privacyConsentModal'),
    // All three backdrops centre their dialog; a `<=460px` block once set
    // `align-items: end` on them and bottom-anchored every modal on phones.
    modalAligns: ['#prepareModal', '#privacyConsentModal', '#discardModal']
      .map(sel => [sel, getComputedStyle(document.querySelector(sel)).alignItems]),
    recorder: (() => {
      const el = document.querySelector('#recorderModalSlot .recorder-panel') || document.querySelector('.recorder-panel');
      if (!el) return { missing: true };
      const r = el.getBoundingClientRect();
      return {
        inSlot: !!document.querySelector('#recorderModalSlot .recorder-panel'),
        box: [Math.round(r.width), Math.round(r.height)],
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160),
        question: pick('#recorderModalSlot .question-block'),
        actions: pick('#recorderModalSlot .recorder-actions'),
        videoFrame: pick('#recorderModalSlot .video-frame'),
        finish: pick('#recorderModalSlot #finishButton'),
      };
    })(),
    tracks: {
      audio: liveStream ? liveStream.getAudioTracks().length : -1,
      video: liveStream ? liveStream.getVideoTracks().length : -1,
    },
  };
}

// The dialog must actually paint: a non-zero box and real text. A zero-sized box
// is exactly what "I can not see anything on the modal" looks like.
function assertVisible(label, node) {
  assert.ok(!node.missing, `${label}: element missing`);
  assert.equal(node.hidden, false, `${label}: still has the hidden attribute`);
  assert.notEqual(node.display, 'none', `${label}: display:none`);
  assert.equal(node.visibility, 'visible', `${label}: visibility hidden`);
  assert.ok(node.box[0] > 0 && node.box[1] > 0, `${label}: zero-sized box ${JSON.stringify(node.box)}`);
}

// The prepare dialog is vertically centred in its backdrop at every width. A
// `align-items: end` override once bottom-anchored it on phones (<=460px) and
// stranded the question card under the viewport; the dialog's own max-height
// keeps a centred dialog from clipping, so both halves are asserted together.
function assertCentred(label, dialog, placement) {
  assert.equal(placement.align, 'center', `${label}: .prepare-modal align-items is ${placement.align}`);
  assert.ok(Math.abs(placement.topGap - placement.bottomGap) <= 6,
    `${label}: dialog is not centred — topGap=${placement.topGap} bottomGap=${placement.bottomGap}`);
  assert.ok(!placement.clipped,
    `${label}: a centred dialog is clipped by the viewport — dialog=${JSON.stringify(dialog.box)}`);
}

// The consent and discard backdrops are never opened by this script, so only
// their computed alignment is observable here — but that is exactly what the
// regression changed.
function assertBackdropsCentre(label, modalAligns) {
  for (const [sel, align] of modalAligns) {
    assert.equal(align, 'center', `${label}: ${sel} align-items is ${align}`);
  }
}

// "Not painted" = no box of its own, or sitting in a subtree taken out of layout.
function assertNotPainted(label, node) {
  assert.ok(!node.missing, `${label}: element missing`);
  assert.ok(node.display === 'none' || node.box[0] === 0 || node.box[1] === 0,
    `${label}: still painted ${JSON.stringify(node)}`);
}

async function run(browser, base, route, width, mode, sessionName = 'Modal Tester', height = 900) {
  const context = await browser.newContext({
    viewport: { width, height },
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 500) console.log(`  HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  await context.addInitScript(mode => {
    try { localStorage.setItem('oscanner-use-camera', mode); } catch {}
    let queue;
    Object.defineProperty(window, 'EvaluationQueue', {
      configurable: true,
      get: () => queue,
      set: value => {
        queue = value;
        if (value && typeof value.admit === 'function') value.admit = async () => ({ state: 'admitted' });
      },
    });
  }, MODES[mode]);

  const label = `${route} @ ${width} [${mode}]`;
  await context.addCookies([{
    name: 'englisheval_session',
    value: testHelpers.createSessionToken({ openId: `modal-${route}-${width}-${mode}`, name: sessionName }),
    url: base,
  }]);

  console.log(`\n=== ${label} ===`);
  await page.goto(base + route, { waitUntil: 'networkidle' });
  // Consent up front so the run reaches the real Start -> countdown -> record path.
  await page.evaluate(async () => {
    await VisitorSession.fetch('/api/privacy-consent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  if (route.startsWith('/game')) {
    await page.waitForFunction(() => {
      const t = document.querySelector('#gameTopicTitle');
      return t && t.textContent && !/Loading/.test(t.textContent);
    }, null, { timeout: 15000 });
  }
  await page.waitForFunction(() => !!document.querySelector('#useCamera'), null, { timeout: 10000 });

  const structuredQuestion = await page.evaluate(() => ({
    title: document.querySelector('#questionText')?.textContent.trim(),
    beats: document.querySelectorAll('#questionPrompt .prompt-beat').length,
    requirementSections: document.querySelectorAll('#questionPrompt .prompt-requirement-card').length,
    requirementItems: document.querySelectorAll('#questionPrompt .prompt-requirement-list li').length,
    requirementListTag: document.querySelector('#questionPrompt .prompt-requirement-list')?.tagName || '',
    titleSize: parseFloat(getComputedStyle(document.querySelector('#questionText')).fontSize),
    promptWidth: document.querySelector('#questionPrompt')?.getBoundingClientRect().width || 0,
    promptOverflow: (() => {
      const prompt = document.querySelector('#questionPrompt');
      return prompt ? prompt.scrollWidth > prompt.clientWidth + 1 : false;
    })(),
    duplicateOverviewQuestion: Boolean(document.querySelector('#gameTopicQuestion')),
  }));
  assert.equal(structuredQuestion.duplicateOverviewQuestion, false,
    `${label}: the duplicate game-overview question is still rendered`);
  if (route === '/game') {
    const expectedPrompt = GROUP_ONE_REQUIREMENT_PROMPTS[structuredQuestion.title];
    assert.ok(expectedPrompt, `${label}: unexpected current Group 1 task: ${structuredQuestion.title}`);
    assert.equal(structuredQuestion.requirementSections, expectedPrompt.sections,
      `${label}: the writing requirements are not split into readable cards`);
    assert.equal(structuredQuestion.requirementItems, expectedPrompt.items,
      `${label}: a current writing requirement is missing`);
    assert.equal(structuredQuestion.requirementListTag, expectedPrompt.ordered ? 'OL' : 'UL',
      `${label}: the writing requirement list type is wrong`);
    assert.ok(structuredQuestion.titleSize <= 32,
      `${label}: the structured paper-writing title is still oversized`);
    assert.equal(structuredQuestion.promptOverflow, false,
      `${label}: the requirement cards overflow their container`);
  }
  if (route === '/game?group=g2') {
    if (structuredQuestion.beats) {
      assert.equal(structuredQuestion.beats, 5, `${label}: the five beats are not split into readable cards`);
      assert.ok(structuredQuestion.title.length < 100, `${label}: the structured title is still an essay`);
      assert.ok(structuredQuestion.titleSize <= 32, `${label}: the structured title is still oversized`);
      assert.ok(structuredQuestion.promptWidth > 0 && structuredQuestion.promptWidth <= width,
        `${label}: the structured prompt overflows the viewport`);
    }
    if (structuredQuestion.requirementSections) {
      assert.equal(structuredQuestion.requirementSections, 1,
        `${label}: the Group 2 writing task is not split into a readable card`);
      assert.equal(structuredQuestion.requirementItems, 5,
        `${label}: the Group 2 writing task lost a step`);
      assert.equal(structuredQuestion.requirementListTag, 'OL',
        `${label}: the Group 2 writing steps are not ordered`);
    }
  }

  // The private make-up page is pinned to group 2's lesson 1: no group picker,
  // and a link to that week's public standings.
  if (route === '/game/first-lesson') {
    const makeUp = await page.evaluate(() => ({
      topic: document.querySelector('#gameTopicTitle').textContent,
      week: document.querySelector('#gameWeekLabel').textContent,
      groupPickerHidden: document.querySelector('#gameGroupPicker').hidden,
      standingsHidden: document.querySelector('[data-first-lesson-standings]').hidden,
      standingsHref: document.querySelector('[data-first-lesson-standings]').getAttribute('href'),
    }));
    assert.equal(makeUp.topic, 'Explaining an experimental figure', `${label}: wrong make-up topic`);
    assert.match(makeUp.week, /Make-up lesson/, `${label}: the week label does not mark the make-up lesson`);
    assert.equal(makeUp.groupPickerHidden, true, `${label}: the group picker is still offered`);
    assert.equal(makeUp.standingsHidden, false, `${label}: the standings link is not shown`);
    assert.equal(makeUp.standingsHref, '/leaderboard?group=g2&challengeId=weekly-2026-09-28-g2',
      `${label}: the standings link points at the wrong week`);
  }

  const group = new URL(route, base).searchParams.get('group');
  const cameraRequired = route.startsWith('/game')
    && (route.startsWith('/game/first-lesson') || group !== 'g3');
  const wantCamera = cameraRequired || mode === 'camera';
  const initial = await page.evaluate(() => ({
    // app.js keeps the checkbox in sync with the persisted mode, so the DOM is
    // the observable contract here.
    useCamera: document.querySelector('#useCamera').checked,
    checked: document.querySelector('#useCamera').checked,
    disabled: document.querySelector('#useCamera').disabled,
    requiredClass: document.querySelector('#cameraOption').classList.contains('is-required'),
    savedPreference: localStorage.getItem('oscanner-use-camera'),
    hint: (() => {
      const el = document.querySelector('#audioOnlyHint');
      return { hidden: el.hidden, display: getComputedStyle(el).display };
    })(),
    requiredHint: (() => {
      const el = document.querySelector('#cameraRequiredHint');
      return { hidden: el.hidden, display: getComputedStyle(el).display };
    })(),
  }));
  const tag = `${route.replace(/\W/g, '')}-${mode}-${width}`;
  await page.screenshot({ path: path.join(OUT, `workflow-entry-${tag}.png`) });
  assert.equal(initial.useCamera, wantCamera, `${label}: state.useCamera is ${initial.useCamera}`);
  assert.equal(initial.checked, wantCamera, `${label}: the Use camera checkbox is ${initial.checked}`);
  assert.equal(initial.disabled, cameraRequired,
    `${label}: camera-required checkbox disabled=${initial.disabled}`);
  assert.equal(initial.requiredClass, cameraRequired,
    `${label}: camera-required styling is ${initial.requiredClass}`);
  assert.equal(initial.hint.hidden, wantCamera,
    `${label}: the audio-only hint is ${initial.hint.hidden ? 'hidden' : 'shown'}`);
  assert.equal(initial.requiredHint.hidden, !cameraRequired,
    `${label}: the required-camera hint is ${initial.requiredHint.hidden ? 'hidden' : 'shown'}`);
  if (cameraRequired) {
    assert.equal(initial.savedPreference, MODES[mode],
      `${label}: forcing camera overwrote the saved ${mode} preference`);
  }

  // The modals must not be trapped inside the prepare modal.
  const nesting = await page.evaluate(probe);
  assert.notEqual(nesting.discardModal.parent, 'prepareModal', 'discard modal is nested in the prepare modal');
  assert.notEqual(nesting.consentModal.parent, 'prepareModal', 'privacy modal is nested in the prepare modal');
  assert.equal(nesting.footer.parent, 'prepare-dialog',
    `.prepare-footer must be a direct child of .prepare-dialog, found ${nesting.footer.parent}`);
  assert.equal(nesting.slot.parent, 'prepare-dialog',
    `#recorderModalSlot must be a direct child of .prepare-dialog, found ${nesting.slot.parent}`);

  // The consent gate must describe the collection that is actually about to
  // happen. Audio-only answers never upload video, so promising video there
  // (and asking for facial images) claims more than we do. Toggling the real
  // checkbox on purpose — it is the listener that repaints the copy — and the
  // mode is restored afterwards, because the toggle also flips the dialog's
  // `audio-only` class that later steps assert on.
  const copy = await page.evaluate(required => {
    const read = () => ({
      summary: document.querySelector('#privacyConsentSummary').textContent,
      highlight: document.querySelector('#privacyConsentHighlight').textContent,
      consent: document.querySelector('#sensitiveInfoText').textContent,
    });
    const box = document.querySelector('#useCamera');
    const original = box.checked;
    const set = on => { box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })); };
    const before = read();
    if (required) {
      set(false);
      const forced = read();
      return {
        before,
        forced,
        checkedAfterAttempt: box.checked,
        disabledAfterAttempt: box.disabled,
      };
    }
    set(false);
    const audio = read();
    set(true);
    const camera = read();
    set(original);
    return { before, audio, camera };
  }, cameraRequired);
  const VIDEO_WORDS = /视频|面部|抽帧/;
  if (cameraRequired) {
    for (const [name, variant] of [['summary', copy.before.summary], ['highlight', copy.before.highlight], ['consent', copy.before.consent]]) {
      assert.ok(VIDEO_WORDS.test(variant), `${label}: required-camera ${name} lost its video wording: ${variant}`);
    }
    assert.deepEqual(copy.forced, copy.before,
      `${label}: the disabled camera control changed the consent to audio-only`);
    assert.equal(copy.checkedAfterAttempt, true,
      `${label}: the camera checkbox was unchecked despite the group requirement`);
    assert.equal(copy.disabledAfterAttempt, true,
      `${label}: the camera checkbox became editable despite the group requirement`);
  } else {
    for (const [name, variant] of [['summary', copy.camera.summary], ['highlight', copy.camera.highlight], ['consent', copy.camera.consent]]) {
      assert.ok(VIDEO_WORDS.test(variant), `${label}: camera-mode ${name} lost its video wording: ${variant}`);
    }
    for (const [name, variant] of [['summary', copy.audio.summary], ['highlight', copy.audio.highlight], ['consent', copy.audio.consent]]) {
      assert.ok(!VIDEO_WORDS.test(variant),
        `${label}: audio-only ${name} still promises video: ${variant}`);
    }
    assert.ok(/麦克风音频/.test(copy.audio.summary) && /音频/.test(copy.audio.consent),
      `${label}: audio-only consent copy dropped the microphone/audio wording`);
    assert.deepEqual(copy.before, wantCamera ? copy.camera : copy.audio,
      `${label}: the consent copy painted on load does not match the persisted mode`);
  }

  // A challenge can require a learner-supplied figure. Seed one through the
  // normal upload control so this layout check remains date-independent.
  if (route.startsWith('/game') && route !== '/game/first-lesson') {
    await page.waitForFunction(() => Boolean(state.gameChallenge));
    if (await page.evaluate(() => state.gameChallenge?.requiresFigureUpload === true)) {
      await page.locator('#questionFigure [data-figure-input]').setInputFiles(REQUIRED_FIGURE_FIXTURE);
    }
  }

  // 1. Start challenge -> countdown modal with the question and "Start now".
  await page.locator('#generateButton').click();
  await page.waitForFunction(() => {
    const a = document.querySelector('#prepareActions');
    return a && !a.hidden && !document.querySelector('#prepareModal').hidden;
  }, null, { timeout: 25000 });

  const countdown = await page.evaluate(probe);
  console.log(`countdown: ${countdown.dialog.box.join('x')} audio-only=${/audio-only/.test(countdown.dialog.classes)} | ${countdown.title.text.slice(0, 60)}`);
  assert.ok(/is-countdown/.test(countdown.dialog.classes), 'dialog is not in countdown mode');
  assert.equal(/audio-only/.test(countdown.dialog.classes), !wantCamera,
    `${label}: countdown dialog audio-only class is wrong`);
  assertVisible('prepare dialog', countdown.dialog);
  assertCentred(label, countdown.dialog, countdown.placement);
  assertBackdropsCentre(label, countdown.modalAligns);
  assertVisible('question title', countdown.title);
  assertVisible('countdown', countdown.countdown);
  assertVisible('Start now button', countdown.startNow);
  assert.ok(countdown.title.text.length > 10, `countdown shows no question: ${JSON.stringify(countdown.title.text)}`);
  assert.equal(countdown.startNow.text, 'Start now');
  if (route === '/game?group=g2') {
    const modalPrompt = await page.evaluate(() => {
      const body = document.querySelector('#prepareModalPrompt .prompt-beat-body');
      return {
        beats: document.querySelectorAll('#prepareModalPrompt .prompt-beat').length,
        title: document.querySelector('#prepareModalTitle').textContent.trim(),
        titleSize: parseFloat(getComputedStyle(document.querySelector('#prepareModalTitle')).fontSize),
        bodySize: body ? parseFloat(getComputedStyle(body).fontSize) : 0,
      };
    });
    if (modalPrompt.beats) {
      assert.equal(modalPrompt.beats, 5, `${label}: the modal lost the five-beat structure`);
      assert.ok(modalPrompt.title.length < 100, `${label}: the modal still uses the full essay as its title`);
      assert.ok(modalPrompt.titleSize <= 28 && modalPrompt.bodySize <= 14,
        `${label}: the structured modal text is not compact enough`);
    }
    const reachableTop = await page.evaluate(() => {
      const dialog = document.querySelector('.prepare-dialog');
      const title = document.querySelector('#prepareModalTitle');
      dialog.scrollTop = 0;
      const dialogBox = dialog.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      return {
        scrollTop: dialog.scrollTop,
        titleInside: titleBox.top >= dialogBox.top - 1,
        dialogHeight: dialogBox.height,
        scrollHeight: dialog.scrollHeight,
      };
    });
    assert.equal(reachableTop.scrollTop, 0, `${label}: the modal did not reset to the top`);
    assert.equal(reachableTop.titleInside, true,
      `${label}: content above the scroll origin is clipped: ${JSON.stringify(reachableTop)}`);
  }
  if (route === '/game') {
    const requirementPrompt = await page.evaluate(() => ({
      sections: document.querySelectorAll('#prepareModalPrompt .prompt-requirement-card').length,
      items: document.querySelectorAll('#prepareModalPrompt .prompt-requirement-list li').length,
      listTag: document.querySelector('#prepareModalPrompt .prompt-requirement-list')?.tagName || '',
      title: document.querySelector('#prepareModalTitle').textContent.trim(),
    }));
    const expectedPrompt = GROUP_ONE_REQUIREMENT_PROMPTS[requirementPrompt.title];
    assert.ok(expectedPrompt, `${label}: unexpected current Group 1 task: ${requirementPrompt.title}`);
    assert.equal(requirementPrompt.sections, expectedPrompt.sections,
      `${label}: the countdown lost the requirement-card structure`);
    assert.equal(requirementPrompt.items, expectedPrompt.items,
      `${label}: the countdown lost a current writing requirement`);
    assert.equal(requirementPrompt.listTag, expectedPrompt.ordered ? 'OL' : 'UL',
      `${label}: the countdown requirement list type is wrong`);
  }
  if (wantCamera) {
    assertVisible('camera preview', countdown.previewWrap);
    assertVisible('camera guidance', countdown.guidance);
  } else {
    assertNotPainted('camera preview', countdown.previewWrap);
  }
  await page.screenshot({ path: path.join(OUT, `modal-countdown-${tag}.png`) });

  // 2. Start now -> the recorder moves into the dialog and must stay visible.
  await page.locator('#speakDirectlyButton').click();
  await page.waitForFunction(
    () => document.querySelector('.prepare-dialog')?.classList.contains('is-recording'),
    null, { timeout: 20000 },
  );
  await page.waitForTimeout(600);
  assert.match(await page.locator('#recordingRemaining').textContent(), /^03:\d\d$/,
    `${label}: the browser recorder is not using the 3:30 ceiling`);

  const recording = await page.evaluate(probe);
  console.log(`recording: ${recording.dialog.box.join('x')} recorder ${recording.recorder.box.join('x')} video-frame=${recording.recorder.videoFrame.display} tracks a${recording.tracks.audio}/v${recording.tracks.video}`);
  assert.ok(/audio-only/.test(recording.dialog.classes) === !wantCamera,
    `${label}: recording dialog audio-only class is wrong`);
  assertVisible('prepare dialog (recording)', recording.dialog);
  assertCentred(label, recording.dialog, recording.placement);
  assert.ok(recording.recorder.inSlot, 'recorder panel was not moved into #recorderModalSlot');
  assert.ok(recording.recorder.box[0] > 0 && recording.recorder.box[1] > 100,
    `recorder panel collapsed: ${JSON.stringify(recording.recorder.box)}`);
  assert.ok(recording.recorder.text.length > 10, 'recorder panel has no visible content');
  if (route === '/game?group=g2') {
    const beats = await page.locator('#recorderModalSlot #questionPrompt .prompt-beat').count();
    if (beats) {
      assert.equal(beats, 5, `${label}: the recording view lost the five-beat structure`);
    }
    const requirementCards = await page.locator('#recorderModalSlot #questionPrompt .prompt-requirement-card').count();
    if (requirementCards) {
      assert.equal(requirementCards, 1,
        `${label}: the Group 2 recording view lost the writing card`);
      assert.equal(
        await page.locator('#recorderModalSlot #questionPrompt .prompt-requirement-list').evaluate(node => node.tagName),
        'OL',
        `${label}: the Group 2 recording view lost ordered steps`,
      );
    }
  }
  if (route === '/game') {
    const recordingTitle = (await page.locator('#prepareModalTitle').textContent()).trim();
    const expectedPrompt = GROUP_ONE_REQUIREMENT_PROMPTS[recordingTitle];
    assert.ok(expectedPrompt, `${label}: unexpected current Group 1 task: ${recordingTitle}`);
    assert.equal(await page.locator('#recorderModalSlot #questionPrompt .prompt-requirement-card').count(), expectedPrompt.sections,
      `${label}: the recording view lost the requirement-card structure`);
    assert.deepEqual(
      await page.locator('#recorderModalSlot #questionPrompt .prompt-requirement-list')
        .evaluateAll(nodes => nodes.map(node => node.tagName)),
      Array(expectedPrompt.sections).fill(expectedPrompt.ordered ? 'OL' : 'UL'),
      `${label}: the recording requirement list type is wrong`,
    );
  }
  assertVisible('question block', recording.recorder.question);
  assertVisible('recorder controls', recording.recorder.actions);
  assertVisible('Finish button', recording.recorder.finish);
  assertNotPainted('countdown', recording.countdown);
  assertNotPainted('Start now button', recording.startNow);
  assertNotPainted('prepare footer', recording.footer);

  if (wantCamera) {
    // Regression: the panel kept `align-items: start` from the desktop grid rule
    // while a flex override shrank the layout, so .video-frame collapsed to an
    // 8px sliver — technically painted, practically invisible.
    assert.ok(recording.recorder.videoFrame.box[0] > 200,
      `video frame collapsed to ${JSON.stringify(recording.recorder.videoFrame.box)}`);
    assertVisible('video frame', recording.recorder.videoFrame);
    assert.ok(recording.tracks.video >= 1, `${label}: no live video track`);
  } else {
    assertNotPainted('video frame', recording.recorder.videoFrame);
    assert.equal(recording.tracks.video, 0, `${label}: audio-only must not open a video track`);
  }
  assert.ok(recording.tracks.audio >= 1, `${label}: no live audio track`);

  // The timer bar must render inside the dialog, as its header row — absolutely
  // positioned it detached to the top of the viewport instead.
  const hudInDialog = await page.evaluate(() => {
    const hud = document.querySelector('#recordingBadge');
    const dialog = document.querySelector('.prepare-dialog');
    const h = hud.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    return { w: h.width, h: h.height,
      inside: h.top >= d.top - 1 && h.bottom <= d.bottom + 1
        && h.left >= d.left - 1 && h.right <= d.right + 1 };
  });
  assert.ok(hudInDialog.w > 200 && hudInDialog.h > 30,
    `recording HUD collapsed: ${JSON.stringify(hudInDialog)}`);
  assert.ok(hudInDialog.inside,
    `recording HUD escaped the dialog: ${JSON.stringify(hudInDialog)}`);
  assert.ok(!/Recording in progress/.test(recording.recorder.text),
    'the "Recording in progress" note is still shown');
  await page.screenshot({ path: path.join(OUT, `modal-recording-${tag}.png`) });

  // Harness noise: no queue worker (/api/admission 404) and no INTERNAL_LLM_API_KEY,
  // where /api/generate-question answers 500 with its fallback question on purpose.
  const real = errors.filter(e => !/404|500/.test(e));
  assert.deepEqual(real, [], `console/page errors:\n${real.join('\n')}`);
  await context.close();
}

async function checkCameraPreferenceRestoration(browser, base) {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await context.addInitScript(() => localStorage.setItem('oscanner-use-camera', 'false'));
  await context.addCookies([{
    name: 'englisheval_session',
    value: testHelpers.createSessionToken({ openId: 'camera-preference-restore', name: 'Modal Tester' }),
    url: base,
  }]);
  const page = await context.newPage();
  const read = () => page.evaluate(() => ({
    checked: document.querySelector('#useCamera').checked,
    disabled: document.querySelector('#useCamera').disabled,
    saved: localStorage.getItem('oscanner-use-camera'),
  }));
  await page.goto(`${base}/game?group=g2`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const title = document.querySelector('#gameTopicTitle')?.textContent || '';
    return title && !/Loading/.test(title);
  });
  assert.deepEqual(await read(), { checked: true, disabled: true, saved: 'false' },
    'Group 2 must force camera without overwriting the saved audio-only preference');
  await page.goto(`${base}/game?group=g3`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const title = document.querySelector('#gameTopicTitle')?.textContent || '';
    return title && !/Loading/.test(title);
  });
  assert.deepEqual(await read(), { checked: false, disabled: false, saved: 'false' },
    'Group 3 must restore the saved audio-only preference');
  await context.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await listenForTest(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: FAKE_ARGS });
  try {
    // /examine shares the same app shell and prepare modal as /game; Group 1
    // forces camera even when an old audio-only preference is present.
    for (const route of ['/game', '/examine']) {
      for (const mode of ['camera', 'audio']) {
        for (const width of [1440, 390]) await run(browser, base, route, width, mode);
      }
    }
    // Group 2 also forces camera, while Group 3 preserves both input modes.
    for (const mode of ['camera', 'audio']) {
      for (const route of ['/game?group=g2', '/game?group=g3']) {
        for (const width of [1440, 390]) await run(browser, base, route, width, mode);
      }
    }
    // Matches the tall, narrow desktop capture where the centered audio-only
    // grid previously hid the top of the prompt above the scroll origin.
    await run(browser, base, '/game?group=g2', 928, 'audio', 'Modal Tester', 966);
    // The private make-up page runs the same recorder, but only for the
    // learners it is assigned to (the name fallback the gate honours).
    for (const learner of ['张鳐', '吴衍标']) {
      await run(browser, base, '/game/first-lesson', 1440, 'camera', learner);
    }
    await run(browser, base, '/game/first-lesson', 1440, 'audio', '张鳐');
    await checkCameraPreferenceRestoration(browser, base);
    console.log('\nOK: the prepare modal renders on /game, /examine and the private /game/first-lesson make-up page; Groups 1/2 force camera and Group 3 keeps both input modes');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
