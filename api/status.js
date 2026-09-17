import { readFile } from 'node:fs/promises';

const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const configFallbackPath = '/tmp/coin-dashboard-config.json';
const fallbackMint = '8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw';
const fallbackOwner = '8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW';
const fallbackMetadataUrl = 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const json = (res, status, data) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
};

const uniq = (values) => [...new Set(values.filter(Boolean))];
const networkId = () => process.env.SOLANA_NETWORK || (String(process.env.RPC_URL || '').includes('mainnet') ? 'mainnet-beta' : 'devnet');
const networkLabel = (id) => id === 'mainnet-beta' ? 'Solana Mainnet' : id === 'testnet' ? 'Solana Testnet' : 'Solana Devnet';
const solscanPath = (path, id = networkId()) => `https://solscan.io/${path}${id === 'mainnet-beta' ? '' : `?cluster=${id}`}`;
const endpoints = () => uniq([
  process.env.RPC_URL,
  networkId() === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com',
  networkId() === 'mainnet-beta' ? null : 'https://devnet.helius-rpc.com/?api-key=public',
]);

function b58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => alphabet[d]).join('');
}

const ui = (amount, decimals) => {
  const text = String(amount ?? '0');
  if (!decimals) return text;
  const whole = text.length > decimals ? text.slice(0, -decimals) : '0';
  const fraction = text.slice(-decimals).padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

async function rpc(endpoint, method, params = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}: ${text.slice(0, 160)}`);
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function withRpc(work) {
  const errors = [];
  for (const endpoint of endpoints()) {
    try {
      return { rpc: endpoint, data: await work(endpoint) };
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  throw new Error(`RPC failed: ${errors.join(' | ')}`);
}

function keyOption(bytes, offset) {
  return bytes.readUInt32LE(offset) ? b58(bytes.subarray(offset + 4, offset + 36)) : null;
}

function parseMintAccount(result) {
  const account = result?.value ?? result;
  if (!account?.data?.[0]) throw new Error('Mint account not found');
  const bytes = Buffer.from(account.data[0], 'base64');
  return {
    mintAuthority: keyOption(bytes, 0),
    supplyRaw: bytes.readBigUInt64LE(36).toString(),
    decimals: bytes[44],
    freezeAuthority: keyOption(bytes, 46),
  };
}

function readString(bytes, offset) {
  const length = bytes.readUInt32LE(offset);
  const start = offset + 4;
  return [bytes.subarray(start, start + length).toString('utf8').replace(/\0+$/, '').trim(), start + length];
}

function parseMetadataAccount(value) {
  if (!value?.account?.data?.[0]) return null;
  const bytes = Buffer.from(value.account.data[0], 'base64');
  let offset = 65;
  let name;
  let symbol;
  let uri;
  [name, offset] = readString(bytes, offset);
  [symbol, offset] = readString(bytes, offset);
  [uri, offset] = readString(bytes, offset);
  offset += 2;
  if (bytes[offset++]) offset += 4 + bytes.readUInt32LE(offset) * 34;
  offset += 1;
  return {
    name,
    symbol,
    uri,
    updateAuthority: b58(bytes.subarray(1, 33)),
    isMutable: Boolean(bytes[offset]),
  };
}

async function tokenAccount(endpoint, owner, mint, decimals) {
  const result = await rpc(endpoint, 'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
  const first = result.value?.[0];
  const amount = first?.account?.data?.parsed?.info?.tokenAmount?.amount ?? '0';
  const uiAmount = first?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString ?? ui(amount, decimals);
  return { address: first?.pubkey ?? null, amount, uiAmount };
}

async function tokenMetadata(endpoint, mint) {
  const result = await rpc(endpoint, 'getProgramAccounts', [TOKEN_METADATA_PROGRAM_ID, {
    encoding: 'base64',
    filters: [{ memcmp: { offset: 33, bytes: mint } }],
  }]);
  const accounts = Array.isArray(result) ? result : result.value;
  return parseMetadataAccount(accounts?.[0]);
}

async function remoteJson(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function readConfig() {
  if (process.env.DASHBOARD_CONFIG_JSON) return JSON.parse(process.env.DASHBOARD_CONFIG_JSON);
  return readFile(configFallbackPath, 'utf8').then(JSON.parse).catch(() => ({}));
}

function payerPublicKey() {
  if (process.env.PAYER_PUBLIC_KEY) return process.env.PAYER_PUBLIC_KEY;
  const secret = JSON.parse(process.env.PAYER_KEYPAIR_JSON || '[]');
  return Array.isArray(secret) && secret.length === 64 ? b58(secret.slice(32, 64)) : null;
}

async function status(endpoint) {
  const mint = process.env.MINT_ADDRESS || fallbackMint;
  const owner = process.env.OWNER_WALLET || fallbackOwner;
  const metadataUrl = process.env.METADATA_URL || fallbackMetadataUrl;
  const githubRepo = process.env.GITHUB_REPO || 'srsystem2502/coin-project';
  const payer = payerPublicKey();
  const supply = await rpc(endpoint, 'getTokenSupply', [mint]);
  const decimals = supply.value.decimals;
  const [mintAccount, ownerToken, metadata, remoteMetadata, config, payerSol, payerToken] = await Promise.all([
    rpc(endpoint, 'getAccountInfo', [mint, { encoding: 'base64' }]).then(parseMintAccount),
    tokenAccount(endpoint, owner, mint, decimals),
    tokenMetadata(endpoint, mint).catch(() => null),
    remoteJson(metadataUrl),
    readConfig(),
    payer ? rpc(endpoint, 'getBalance', [payer]).then((r) => r.value / 1_000_000_000) : null,
    payer ? tokenAccount(endpoint, payer, mint, decimals).catch(() => ({ address: null, amount: '0', uiAmount: '0' })) : { address: null, amount: '0', uiAmount: '0' },
  ]);
  const id = networkId();
  const payerMatches = (authority) => Boolean(payer && authority === payer);
  return {
    networkId: id,
    network: networkLabel(id),
    tokenExplorerUrl: solscanPath(`token/${mint}`, id),
    mint,
    owner,
    ownerAta: ownerToken.address,
    payer,
    payerAta: payerToken.address,
    payerSol,
    decimals,
    supplyRaw: supply.value.amount || mintAccount.supplyRaw,
    supply: supply.value.uiAmountString || ui(supply.value.amount || mintAccount.supplyRaw, decimals),
    mintAuthority: mintAccount.mintAuthority,
    freezeAuthority: mintAccount.freezeAuthority,
    ownerBalance: ownerToken.uiAmount,
    ownerBalanceRaw: ownerToken.amount,
    payerTokenBalance: payerToken.uiAmount,
    payerTokenBalanceRaw: payerToken.amount,
    onchainMetadata: metadata,
    remoteMetadata,
    metadataUrl,
    githubRepo,
    controls: {
      canUpdateMetadata: Boolean(metadata?.isMutable && payerMatches(metadata.updateAuthority)),
      canMint: payerMatches(mintAccount.mintAuthority),
      canFreeze: payerMatches(mintAccount.freezeAuthority),
      canTransferFromPayer: Boolean(payerToken.address),
    },
    config,
  };
}

export default async function handler(req, res) {
  try {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected || req.headers['x-admin-password'] !== expected) return json(res, 401, { error: 'Unauthorized' });
    const result = await withRpc(status);
    return json(res, 200, { ...result.data, rpc: result.rpc });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}
