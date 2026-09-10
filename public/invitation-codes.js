(() => {
  const list = document.querySelector('#list');
  const message = document.querySelector('#new');
  const panel = document.querySelector('#qr-panel');
  const records = new Map();
  let selected;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eyeIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOffIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.4 10.4 0 0 1 12 19.5C5.6 19.5 2 13 2 13a19.9 19.9 0 0 1 4.06-4.94"/><path d="M9.9 5.24A9.6 9.6 0 0 1 12 5c6.4 0 10 6.5 10 6.5a19.8 19.8 0 0 1-2.16 3.19"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';
  const toastHost = document.createElement('div');
  toastHost.className = 'toast-host';
  document.body.appendChild(toastHost);
  function toast(text, type = 'success') {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'error' ? '✕' : '✓';
    const text2 = document.createElement('span');
    text2.textContent = text;
    item.append(icon, text2);
    toastHost.appendChild(item);
    setTimeout(() => {
      item.classList.add('leave');
      setTimeout(() => item.remove(), 350);
    }, 2600);
  }
  const qrUrl = id => `/api/invitation-codes/${encodeURIComponent(id)}/qr`;
  // The server builds the link from APP_BASE_URL so it matches the QR payload exactly;
  // the origin fallback keeps the page usable if an older server omits shareUrl.
  const linkFor = record => record.shareUrl || new URL(`/invite#code=${encodeURIComponent(record.code)}`, location.origin).toString();
  function preview(record) {
    selected = record;
    panel.hidden = false;
    document.querySelector('#qr-preview').src = qrUrl(record.id);
    document.querySelector('#qr-code').textContent = record.code;
    document.querySelector('#invite-link').value = linkFor(record);
    document.querySelector('#download-qr').href = qrUrl(record.id);
  }
  async function copyLink(record) {
    preview(record);
    const url = linkFor(record);
    try {
      await navigator.clipboard.writeText(url);
      toast('Invitation link copied. Send it to your invitee.');
    } catch {
      // The link stays visible in the field, so a manual copy is always possible.
      const field = document.querySelector('#invite-link');
      field.focus();
      field.select();
      message.textContent = 'Unable to copy automatically. Select and copy the invitation link shown below.';
      toast('Unable to copy automatically. Select and copy the invitation link shown below.', 'error');
    }
  }
  async function copyCode(record) {
    try {
      await navigator.clipboard.writeText(record.code);
      toast('Code copied to clipboard.');
    } catch {
      preview(record);
      message.textContent = 'Unable to copy automatically. Select and copy the invitation code shown below.';
      toast('Unable to copy automatically. Select and copy the invitation code shown below.', 'error');
    }
  }
  async function copyQr(record) {
    preview(record);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') throw new Error('unsupported');
      // Start clipboard access inside the click gesture, including on Safari.
      const png = VisitorSession.fetch(qrUrl(record.id)).then(response => {
        if (!response.ok) throw new Error('Unable to load QR code');
        return response.blob();
      });
      void png.catch(() => {});
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('QR code copied to clipboard.');
    } catch {
      toast('Unable to copy the QR image in this browser. Use Download QR code below.', 'error');
    }
  }
  async function load() {
    const response = await VisitorSession.fetch('/api/invitation-codes');
    if (!response.ok) throw new Error('Unable to load invitation codes.');
    const data = await response.json();
    records.clear();
    data.codes.forEach(record => records.set(record.id, record));
    list.innerHTML = data.codes.length ? data.codes.map(record => `<tr><td class="code-value" data-code="${esc(record.id)}">••••${esc(record.codePreview)}</td><td><span class="status ${record.usedAt ? 'used' : ''}">${record.usedAt ? 'Used' : 'Available'}</span></td><td>${esc(record.guestName || '')}</td><td>${new Date(record.createdAt).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</td><td class="code-actions"><button class="icon-button toggle" data-id="${esc(record.id)}" title="Show or hide code" aria-label="Show or hide code">${eyeIcon}</button><button class="icon-button copy-qr" data-id="${esc(record.id)}" title="Copy QR code" aria-label="Copy QR code">QR</button><button class="icon-button copy-link" data-id="${esc(record.id)}" title="Copy invitation link" aria-label="Copy invitation link">Link</button><button class="icon-button copy" data-id="${esc(record.id)}" title="Copy invitation code" aria-label="Copy invitation code">⧉</button>${!record.usedAt ? `<button class="delete" data-id="${esc(record.id)}">Delete</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No invitation codes yet.</td></tr>';
  }
  list.addEventListener('click', async event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const record = records.get(button.dataset.id);
    if (!record) return;
    try {
      if (button.classList.contains('toggle')) {
        const cell = button.closest('tr').querySelector('.code-value');
        const showing = cell.textContent.startsWith('••••');
        cell.textContent = showing ? record.code : '••••' + record.codePreview;
        button.innerHTML = showing ? eyeOffIcon : eyeIcon;
        button.title = button.ariaLabel = showing ? 'Hide code' : 'Show code';
        toast(showing ? 'Code shown.' : 'Code hidden.');
      } else if (button.classList.contains('copy-qr')) await copyQr(record);
      else if (button.classList.contains('copy-link')) await copyLink(record);
      else if (button.classList.contains('copy')) await copyCode(record);
      else if (button.classList.contains('delete')) {
        if (!window.confirm('Delete this invitation code? This cannot be undone.')) return;
        button.disabled = true;
        const response = await VisitorSession.fetch('/api/invitation-codes/' + encodeURIComponent(record.id), { method: 'DELETE' });
        if (!response.ok) throw new Error((await response.json()).error || 'Unable to delete code.');
        if (selected?.id === record.id) { panel.hidden = true; selected = null; }
        toast('Invitation code deleted.');
        await load();
      }
    } catch (error) { message.textContent = error.message; toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  document.querySelector('#copy-qr').onclick = () => selected && copyQr(selected);
  document.querySelector('#copy-link').onclick = () => selected && copyLink(selected);
  document.querySelector('#copy-code').onclick = () => selected && copyCode(selected);
  document.querySelector('#qr-preview').onerror = () => { message.textContent = 'Unable to load the QR code. Try selecting Copy QR code again.'; toast('Unable to load the QR code. Try selecting Copy QR code again.', 'error'); };
  document.querySelector('#create').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await VisitorSession.fetch('/api/invitation-codes', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to generate code.');
      preview(data.record);
      message.textContent = 'Invitation created. Copy the invitation link to share it.';
      toast('Invitation created. Copy the invitation link to share it.');
      await load();
    } catch (error) { message.textContent = error.message; toast(error.message, 'error'); }
    finally { button.disabled = false; }
  };
  load().catch(error => { message.textContent = error.message; list.innerHTML = '<tr><td colspan="5" class="empty">Unable to load invitation codes.</td></tr>'; });
})();
