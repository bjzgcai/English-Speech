const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { listenForTest } = require('./test-http');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'invitation-browser-'));
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: data, QUEUE_ENABLED: 'false', SESSION_SECRET: 'invitation-browser-secret', COOKIE_SECURE: 'false', DINGTALK_APP_KEY: 'test', DINGTALK_APP_SECRET: 'test', DINGTALK_CORP_ID: 'test', APP_BASE_URL: '' });
const { app, testHelpers } = require('../src/app');
const occupiedMessage = "Your invitation code is occupied. Ask Beijing zhongguancun Academy's friend for one exclusive invitation code";

async function open(browser, viewport) {
  // Mirror real devices: the phone context has no hover, so the tap path is exercised there.
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}
function accessDialog(page) {
  return page.locator('.access-dialog:not(.occupied-dialog)');
}
// An invitation link must land on the invitation-code path only, with the code
// already filled in: DingTalk sign-in is hidden so it cannot distract the invitee.
async function assertInvitationOnly(page) {
  const dialog = accessDialog(page);
  assert.equal(await dialog.locator('.access-login').isVisible(), false, 'DingTalk sign-in is offered on an invitation link');
  assert.equal(await dialog.locator('.access-divider').isVisible(), false, 'the "or use an invitation code" divider survives on an invitation link');
  assert.equal(await dialog.locator('.access-intro').innerText(), 'Your invitation code is already filled in. Add your name to continue.');
  assert.equal(await page.locator('#invite-code-line').isVisible(), true, 'the invitee cannot see the code they arrived with');
}
async function signIn(page, code, name) {
  await page.locator('#access-code').fill(code);
  await page.locator('#access-name').fill(name);
  await page.locator('.access-form .access-submit').click();
}
async function identity(page) {
  return page.evaluate(async () => (await VisitorSession.refresh()).user);
}
async function createCode(page, previous = '') {
  await page.locator('#create').click();
  await page.waitForFunction(previous => document.querySelector('#qr-code').textContent !== previous, previous);
  await page.waitForFunction(() => document.querySelector('#qr-preview').naturalWidth === 480);
  return page.locator('#qr-code').innerText();
}
async function seedHistory(page) {
  await page.evaluate(async () => {
    await VisitorSession.fetch('/api/privacy-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }) });
    const created = await (await VisitorSession.fetch('/api/game/question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const saved = await VisitorSession.fetch('/api/save-answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId: created.question.id }) });
    if (!saved.ok) throw new Error('Unable to seed guest history');
  });
}
async function main() {
  const server = await listenForTest(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390]) {
      const viewport = { width, height: 900 };

      // Owner: generate codes, share the QR, and see the name bound to each used code.
      const owner = await open(browser, viewport);
      await owner.context.addCookies([{ name: 'englisheval_session', value: testHelpers.createSessionToken({ openId: `inviter-${width}`, name: 'Inviter' }), url: base }]);
      await owner.page.goto(base + '/invitation-codes');
      const scanned = await createCode(owner.page);
      const spare = await createCode(owner.page, scanned);
      const manualCode = await createCode(owner.page, spare);
      assert.equal((await owner.page.locator('#list').innerText()).includes('Alice'), false);
      await owner.page.locator('#copy-qr').click();
      await owner.page.getByText('QR code copied to clipboard.', { exact: true }).waitFor();
      // Keep the real QR image (currently showing manualCode) for the upload test below.
      const qrPngBase64 = await owner.page.evaluate(async () => {
        const response = await fetch(document.querySelector('#qr-preview').src, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to fetch the QR image');
        const buffer = await response.arrayBuffer();
        let binary = '';
        new Uint8Array(buffer).forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
      });
      const qrPath = path.join(data, 'invitation-qr-upload.png');
      fs.writeFileSync(qrPath, Buffer.from(qrPngBase64, 'base64'));
      // A tiny valid PNG without any QR pattern must be rejected with a readable message.
      const plainPath = path.join(data, 'plain.png');
      fs.writeFileSync(plainPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
      assert.equal(await owner.page.evaluate(async () => (await navigator.clipboard.read())[0].types.includes('image/png')), true);
      await owner.page.locator('#copy-code').click();
      await owner.page.getByText('Code copied to clipboard.', { exact: true }).waitFor();
      assert.equal(await owner.page.evaluate(() => navigator.clipboard.readText()), manualCode);
      // The shareable link is what the inviter sends: it must be readable in the panel
      // and copy exactly the same URL the QR encodes.
      const inviteLink = `${base}/invite#code=${manualCode}`;
      assert.equal(await owner.page.locator('#invite-link').inputValue(), inviteLink);
      await owner.page.locator('#copy-link').click();
      await owner.page.getByText('Invitation link copied. Send it to your invitee.', { exact: true }).waitFor();
      assert.equal(await owner.page.evaluate(() => navigator.clipboard.readText()), inviteLink);
      // The row action copies the link of that specific code without opening the panel.
      const manualRow = owner.page.locator('#list tr', { has: owner.page.locator('.code-value', { hasText: '••••' + manualCode.slice(-4) }) });
      await manualRow.locator('.copy-link').click();
      await owner.page.getByText('Invitation link copied. Send it to your invitee.', { exact: true }).waitFor();
      assert.equal(await owner.page.evaluate(() => navigator.clipboard.readText()), inviteLink);
      await owner.page.evaluate(() => { navigator.clipboard.write = async () => { throw new Error('Permission denied'); }; });
      await owner.page.locator('.copy-qr').first().click();
      await owner.page.getByText('Unable to copy the QR image in this browser. Use Download QR code below.', { exact: true }).waitFor();
      const [download] = await Promise.all([owner.page.waitForEvent('download'), owner.page.locator('#download-qr').click()]);
      assert.equal(download.suggestedFilename(), 'invitation-qr.png');
      assert.equal(await download.failure(), null);
      assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await owner.page.screenshot({ path: `/tmp/invitation-qr-${width}.png`, fullPage: true });

      // QR scan: the code is prefilled, the name is still required, and only success navigates.
      const first = await open(browser, viewport);
      await first.page.goto(base + '/invite#code=' + scanned);
      await accessDialog(first.page).waitFor();
      assert.equal(new URL(first.page.url()).hash, '');
      assert.equal(await first.page.locator('#access-code').inputValue(), scanned);
      assert.equal(await first.page.locator('#access-name').inputValue(), '');
      await assertInvitationOnly(first.page);
      // The code arrived with the link, so the name field is ready to type.
      assert.equal(await first.page.evaluate(() => document.activeElement?.id), 'access-name');
      await first.page.locator('.access-form .access-submit').click();
      assert.equal(await first.page.locator('.access-error').innerText(), '');
      await signIn(first.page, scanned, '  Ada Lovelace  ');
      await first.page.waitForURL(base + '/examine');
      assert.equal((await identity(first.page)).name, 'Ada Lovelace');
      const ownerId = (await identity(first.page)).openId;

      // Header: an invited guest is signed in, so "Sign in" goes away and Logout appears.
      const name = first.page.locator('#authUserName');
      await name.waitFor({ state: 'visible' });
      assert.equal(await first.page.locator('#loginButton').isVisible(), false);
      assert.equal(await first.page.locator('#logoutButton').isVisible(), true);
      assert.equal(await first.page.locator('#authChip').isVisible(), true);
      // Names longer than 7 characters are previewed; the full name stays available.
      assert.equal(await name.innerText(), 'Ada Lov…');
      assert.equal(await name.getAttribute('aria-label'), 'Ada Lovelace');
      assert.equal(await name.evaluate(element => element.dataset.fullName), 'Ada Lovelace');
      if (width === 1440) {
        await name.hover();
        await first.page.waitForFunction(() => getComputedStyle(document.querySelector('#authUserName'), '::after').visibility === 'visible');
        assert.equal(await name.evaluate(element => getComputedStyle(element, '::after').content.includes('Ada Lovelace')), true);
      } else {
        // Touch has no hover: tapping the preview opens the full name and leaves the chip alone,
        // so the navigation links beside it keep their width instead of being squeezed out.
        const nav = first.page.locator('.main-nav');
        const navWidth = await nav.evaluate(element => Math.round(element.getBoundingClientRect().width));
        assert.ok(navWidth > 0, `expected a visible nav before expanding, got ${navWidth}`);
        await name.tap();
        await first.page.waitForFunction(() => getComputedStyle(document.querySelector('#authUserName'), '::after').visibility === 'visible');
        assert.equal(await name.innerText(), 'Ada Lov…');
        assert.ok(await nav.evaluate(element => Math.round(element.getBoundingClientRect().width)) >= navWidth, 'navigation shrank while the name was open');
        assert.equal(await name.getAttribute('data-expanded'), 'true');
        assert.equal(await first.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await name.tap();
        await first.page.waitForFunction(() => getComputedStyle(document.querySelector('#authUserName'), '::after').visibility === 'hidden');
        assert.equal(await name.innerText(), 'Ada Lov…');
        assert.equal(await name.getAttribute('data-expanded'), 'false');
      }
      assert.equal(await first.page.evaluate(async () => (await VisitorSession.fetch('/api/game/question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status), 403);
      await seedHistory(first.page);

      // Same browser: returning with the code never prompts again.
      await first.page.goto(base + '/invite#code=' + scanned);
      await first.page.waitForURL(base + '/examine');
      assert.equal(await first.page.locator('.access-dialog').count(), 0);
      assert.equal((await identity(first.page)).openId, ownerId);

      // Another browser: the exact name (any case, any surrounding space) restores the identity and its history.
      const recovered = await open(browser, viewport);
      await recovered.page.goto(base + '/invite#code=' + scanned);
      await accessDialog(recovered.page).waitFor();
      await assertInvitationOnly(recovered.page);
      await signIn(recovered.page, scanned, 'ada lovelace');
      await recovered.page.waitForURL(base + '/examine');
      assert.equal((await identity(recovered.page)).openId, ownerId);
      assert.equal((await identity(recovered.page)).name, 'Ada Lovelace');
      assert.equal(await recovered.page.evaluate(async () => (await (await VisitorSession.fetch('/api/recordings')).json()).recordings.length), 1);

      // A wrong name gets the persistent occupied warning, then a different code still works.
      const stranger = await open(browser, viewport);
      await stranger.page.goto(base + '/invite#code=' + scanned);
      await accessDialog(stranger.page).waitFor();
      await assertInvitationOnly(stranger.page);
      await signIn(stranger.page, scanned, 'Mallory');
      const warning = stranger.page.locator('.occupied-dialog');
      await warning.waitFor();
      assert.equal(new URL(stranger.page.url()).hash, '');
      assert.equal(await warning.locator('p').innerText(), occupiedMessage);
      await stranger.page.keyboard.press('Escape');
      await stranger.page.mouse.click(2, 2);
      await stranger.page.waitForTimeout(1100);
      assert.equal(await warning.isVisible(), true);
      await stranger.page.screenshot({ path: `/tmp/invitation-occupied-${width}.png` });
      await warning.getByRole('button', { name: 'Close', exact: true }).click();
      await stranger.page.locator('.occupied-dialog').waitFor({ state: 'detached' });
      await signIn(stranger.page, spare, 'Mallory');
      await stranger.page.waitForURL(base + '/examine');
      assert.equal((await identity(stranger.page)).name, 'Mallory');

      // Manual entry from the header: an invalid code is reported, a fresh code plus name grants access.
      const manual = await open(browser, viewport);
      await manual.page.goto(base + '/examine');
      await manual.page.locator('#loginButton').click();
      await accessDialog(manual.page).waitFor();
      // Signing in from anywhere else keeps offering DingTalk: only an invitation link hides it.
      assert.equal(await accessDialog(manual.page).locator('.access-login').isVisible(), true);
      assert.equal(await accessDialog(manual.page).locator('.access-divider').isVisible(), true);
      await signIn(manual.page, 'INVALID', 'Manual Guest');
      await manual.page.getByText('Invalid invitation code.', { exact: true }).waitFor();
      // QR-image upload on the invitation-code field: a non-QR image is rejected,
      // a real invitation QR fills the code in without typing it.
      await manual.page.setInputFiles('#access-qr-file', plainPath);
      await manual.page.getByText('Could not find an invitation code in this image. Try another image or type the code.', { exact: true }).waitFor();
      await manual.page.setInputFiles('#access-qr-file', qrPath);
      await manual.page.getByText(`Invitation code ${manualCode} added from the QR image.`, { exact: true }).waitFor();
      assert.equal(await manual.page.locator('#access-code').inputValue(), manualCode);
      await manual.page.locator('.access-form .access-submit').click();
      await manual.page.waitForFunction(() => VisitorSession.hasAccess && document.querySelectorAll('.access-dialog').length === 0);
      assert.equal(await manual.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await manual.page.screenshot({ path: `/tmp/invitation-access-${width}.png` });

      // An invited guest can sign out; the name they chose stays available for the next sign-in.
      assert.equal(await manual.page.locator('#authChip').isVisible(), true);
      assert.equal(await manual.page.locator('#authUserName').innerText(), 'Manual…');
      await manual.page.locator('#logoutButton').click();
      await manual.page.waitForFunction(() => VisitorSession.hasAccess === false);
      assert.equal(await manual.page.locator('#authChip').isVisible(), false);
      assert.equal(await manual.page.locator('#loginButton').isVisible(), true);

      // The standalone pages ship their own header stylesheet, so the same preview/overlay
      // behaviour must survive there too (and must not clip or squeeze the nav).
      if (width !== 1440) {
        // /methodology serves docs.html, which ships its own header stylesheet.
        for (const route of ['/methodology', '/intro', '/prepare']) {
          await recovered.page.goto(base + route);
          const chip = recovered.page.locator('.auth-chip [data-auth-user-name]');
          await chip.waitFor({ state: 'visible' });
          assert.equal(await chip.innerText(), 'Ada Lov…', route);
          assert.equal(await recovered.page.locator('[data-header-login]').isVisible(), false, `${route} still offers sign-in`);
          const nav = recovered.page.locator('.header-menu nav');
          const navWidth = await nav.evaluate(element => Math.round(element.getBoundingClientRect().width));
          assert.ok(navWidth > 0, `${route} nav collapsed before expanding`);
          await chip.tap();
          await recovered.page.waitForFunction(() => getComputedStyle(document.querySelector('.auth-chip [data-auth-user-name]'), '::after').visibility === 'visible');
          assert.ok(await nav.evaluate(element => Math.round(element.getBoundingClientRect().width)) >= navWidth, `${route} nav shrank while the name was open`);
          const bounds = await chip.evaluate(element => {
            const chipBox = element.getBoundingClientRect();
            const pseudo = getComputedStyle(element, '::after');
            const width = Math.min(parseFloat(pseudo.width), parseFloat(pseudo.maxWidth));
            return { left: chipBox.right - width, right: chipBox.right };
          });
          assert.ok(bounds.left >= 0 && bounds.right <= width, `${route} overlay escapes the viewport: ${JSON.stringify(bounds)}`);
          assert.equal(await recovered.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflows`);
          await chip.tap();
          await recovered.page.waitForFunction(() => getComputedStyle(document.querySelector('.auth-chip [data-auth-user-name]'), '::after').visibility === 'hidden');
          assert.equal(await chip.innerText(), 'Ada Lov…', route);
        }
      }

      // The owner sees the name each guest bound to their used codes.
      await owner.page.reload();
      await owner.page.waitForFunction(() => document.querySelector('#list').textContent.includes('Ada Lovelace'));
      // Used codes keep their link: the same guest recovers their identity on a new browser.
      assert.equal(await owner.page.locator('#list .copy-link').count(), 3);
      const table = await owner.page.locator('#list').innerText();
      assert.ok(table.includes('Ada Lovelace'), table);
      assert.ok(table.includes('Manual Guest'), table);
      assert.ok(table.includes('Mallory'), table);
      for (const side of [owner, first, recovered, stranger, manual]) assert.deepEqual(side.errors, []);
      await owner.context.close();
      await first.context.close();
      await recovered.context.close();
      await stranger.context.close();
      await manual.context.close();
    }
    console.log('Invitation browser checks passed at desktop and mobile sizes.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(data, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
