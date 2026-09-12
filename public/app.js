const $ = (selector) => document.querySelector(selector);
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
const fact = (label, value) => `<dt>${label}</dt><dd>${value ?? '-'}</dd>`;
let state = null;
function ensurePassword() {
  if (localStorage.getItem('coin_dashboard_admin_password')) return;
  const password = prompt('Admin password dashboard?');
  if (password) localStorage.setItem('coin_dashboard_admin_password', password);
}
async function refresh() {
  ensurePassword();
  const response = await fetch('/api/status', { cache: 'no-store', headers: adminHeaders() });
  state = await response.json();
  if (state.error) throw new Error(state.error);
  const meta = state.remoteMetadata || state.onchainMetadata || {};
  $('#tokenName').textContent = state.onchainMetadata?.name || meta.name || '-';
  $('#tokenSymbol').textContent = `${state.onchainMetadata?.symbol || meta.symbol || '-'} · Balance ${state.ownerBalance || '0'}`;
  const logo = $('#tokenLogo');
  const fallback = $('#logoFallback');
  fallback.textContent = state.onchainMetadata?.symbol || meta.symbol || 'TOKEN';
  logo.hidden = true;
  logo.removeAttribute('src');
  logo.onerror = () => { logo.hidden = true; };
  logo.onload = () => { logo.hidden = false; };
  if (meta.image) logo.src = meta.image;
  $('#facts').innerHTML = [
    fact('Mint', state.mint),
    fact('Owner wallet', state.owner),
    fact('Owner balance', state.ownerBalance),
    fact('Payer balance', state.payerTokenBalance),
    fact('Supply', state.supply),
    fact('Decimals', state.decimals),
    fact('Payer SOL', state.payerSol),
    fact('Metadata URI', state.metadataUrl),
    fact('Update authority', state.onchainMetadata?.updateAuthority),
    fact('Mutable', state.onchainMetadata?.isMutable),
    fact('Mint authority', state.mintAuthority),
    fact('Freeze authority', state.freezeAuthority),
  ].join('');
  fill($('#metadataForm'), {
    name: state.onchainMetadata?.name || meta.name,
    symbol: state.onchainMetadata?.symbol || meta.symbol,
    image: meta.image,
    description: meta.description,
  });
  fill($('#configForm'), state.config || {});
  log({ status: 'loaded', mint: state.mint, ownerBalance: state.ownerBalance });
}
async function bind(formId, url, after = refresh) {
  const form = $(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
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
$('#refreshBtn').addEventListener('click', refresh);
bind('#metadataForm', '/api/metadata');
bind('#mintForm', '/api/mint');
bind('#transferForm', '/api/transfer');
bind('#configForm', '/api/config', async () => { log('Config saved.'); await refresh(); });
refresh().catch((error) => log(`ERROR: ${error.message}`));
