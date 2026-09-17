const $ = (selector) => document.querySelector(selector);
const short = (value) => {
  const text = String(value || '');
  return text.length > 22 ? `${text.slice(0, 7)}…${text.slice(-7)}` : text;
};
const escapeAttr = (value) => String(value ?? '').replaceAll('"', '&quot;');
const copyButton = (value) => value ? `<button class="copyBtn" type="button" data-copy="${escapeAttr(value)}">Copy</button>` : '';
const log = (value) => { $('#log').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
const adminHeaders = () => {
  const password = localStorage.getItem('coin_dashboard_admin_password') || '';
  return password ? { 'x-admin-password': password } : {};
};
const post = async (url, data) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(data) });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error || 'Request failed');
  return json;
};
const readForm = (form) => Object.fromEntries(new FormData(form).entries());
const fill = (form, values) => {
  for (const [key, value] of Object.entries(values || {})) {
    if (form.elements[key]) form.elements[key].value = value ?? '';
  }
};
const compactValue = (value) => {
  const text = String(value ?? '-');
  if (text.length <= 34) return text;
  return `${text.slice(0, 12)}…${text.slice(-10)}`;
};
const fact = (label, value, copy = false) => `<dt>${label}</dt><dd><span class="factValue" title="${escapeAttr(value ?? '-')}">${copy ? compactValue(value) : (value ?? '-')}</span>${copyButton(copy ? value : '')}</dd>`;
let state = null;
function ensurePassword() {
  if (localStorage.getItem('coin_dashboard_admin_password')) return;
  const password = prompt('Admin password dashboard?');
  if (password) localStorage.setItem('coin_dashboard_admin_password', password);
}
function paintSummary(meta) {
  $('#metricSupply').textContent = state.supply || '-';
  $('#metricOwnerBalance').textContent = state.ownerBalance || '0';
  $('#metricRpc').textContent = short(state.rpc || '-');
  $('#networkBadge').textContent = /mainnet/i.test(state.network || '') ? 'MAINNET' : 'DEVNET';
  $('#lastUpdated').textContent = new Date().toLocaleString('id-ID');
  $('#tokenName').textContent = state.onchainMetadata?.name || meta.name || 'COin';
  $('#tokenSymbol').textContent = `${state.onchainMetadata?.symbol || meta.symbol || '-'} · ${state.network || 'Solana'}`;
}
function paintLogo(meta) {
  const logo = $('#tokenLogo');
  const fallback = $('#logoFallback');
  fallback.textContent = state.onchainMetadata?.symbol || meta.symbol || 'CO';
  logo.hidden = true;
  logo.removeAttribute('src');
  logo.onerror = () => { logo.hidden = true; };
  logo.onload = () => { logo.hidden = false; };
  if (meta.image) logo.src = meta.image;
}
async function refresh() {
  ensurePassword();
  $('#refreshBtn').disabled = true;
  try {
    const response = await fetch('/api/status', { cache: 'no-store', headers: adminHeaders() });
    state = await response.json();
    if (state.error) throw new Error(state.error);
    const meta = state.remoteMetadata || state.onchainMetadata || {};
    paintSummary(meta);
    paintLogo(meta);
    $('#facts').innerHTML = [
      fact('Mint', state.mint, true),
      fact('Owner wallet', state.owner, true),
      fact('Owner token account', state.ownerAta, true),
      fact('Owner balance', state.ownerBalance),
      fact('Payer wallet', state.payer, true),
      fact('Payer balance', state.payerTokenBalance),
      fact('Supply', state.supply),
      fact('Decimals', state.decimals),
      fact('Payer SOL', state.payerSol),
      fact('Metadata URI', state.metadataUrl, true),
      fact('Update authority', state.onchainMetadata?.updateAuthority, true),
      fact('Mutable', state.onchainMetadata?.isMutable),
      fact('Mint authority', state.mintAuthority, true),
      fact('Freeze authority', state.freezeAuthority, true),
    ].join('');
    fill($('#metadataForm'), {
      name: state.onchainMetadata?.name || meta.name,
      symbol: state.onchainMetadata?.symbol || meta.symbol,
      image: meta.image,
      description: meta.description,
    });
    fill($('#configForm'), state.config || {});
    log({ status: 'loaded', mint: state.mint, ownerBalance: state.ownerBalance, rpc: state.rpc });
  } finally {
    $('#refreshBtn').disabled = false;
  }
}
async function bind(formId, url, after = refresh) {
  const form = $(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"], button:not([type])');
    button.disabled = true;
    try {
      const result = await post(url, readForm(form));
      const message = url === '/api/metadata'
        ? { saved: true, githubUpdated: result.githubUpdated, note: result.githubUpdated ? 'metadata.json GitHub updated' : 'No GITHUB_TOKEN env. On-chain updated only.' }
        : result;
      log(message);
      if (after) await after();
      if (formId !== '#metadataForm' && formId !== '#configForm') form.reset();
    } catch (error) {
      log(`ERROR: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.copy);
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy'; }, 1200);
});
$('#refreshBtn').addEventListener('click', refresh);
bind('#metadataForm', '/api/metadata');
bind('#mintForm', '/api/mint');
bind('#transferForm', '/api/transfer');
bind('#configForm', '/api/config', async () => { log('Config saved.'); await refresh(); });
refresh().catch((error) => log(`ERROR: ${error.message}`));
