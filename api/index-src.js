import { readFile, writeFile } from 'fs/promises';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createSignerFromKeypair, keypairIdentity, none, publicKey, some } from '@metaplex-foundation/umi';
import { fetchDigitalAsset, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata';
import { createTokenIfMissing, findAssociatedTokenPda, mintTokensTo, transferTokens } from '@metaplex-foundation/mpl-toolbox';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';

const githubApi = 'https://api.github.com';
const configFallbackPath = '/tmp/coin-dashboard-config.json';

function parseUiAmount(value, decimals) {
  const text = String(value ?? '').trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Invalid decimals');
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(text)) throw new Error(`Amount must be a positive decimal with max ${decimals} decimals`);
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n) throw new Error('Amount must be greater than 0');
  return amount;
}

function requirePublicKey(value, label = 'wallet') {
  try { return new PublicKey(String(value ?? '').trim()).toBase58(); }
  catch { throw new Error(`${label} must be a valid Solana address`); }
}

function validateMetadataInput(input) {
  const name = String(input.name ?? '').trim();
  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  const description = String(input.description ?? '').trim();
  const image = String(input.image ?? '').trim();
  if (!name || name.length > 32) throw new Error('Name required, max 32 chars');
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('Symbol must be 2-10 chars: A-Z/0-9');
  if (!description || description.length > 500) throw new Error('Description required, max 500 chars');
  if (!/^https:\/\//.test(image)) throw new Error('Logo URL must start with https://');
  return { name, symbol, description, image };
}

function cleanConfig(input, fallback = {}) {
  const out = { ...fallback };
  for (const key of ['adminWallet', 'treasuryWallet', 'feeReceiverWallet', 'liquidityWallet']) {
    const value = String(input[key] ?? out[key] ?? '').trim();
    out[key] = value ? requirePublicKey(value, key) : '';
  }
  out.targetBuyPrice = String(input.targetBuyPrice ?? out.targetBuyPrice ?? '').trim();
  out.targetSellPrice = String(input.targetSellPrice ?? out.targetSellPrice ?? '').trim();
  out.liquidityPair = String(input.liquidityPair ?? out.liquidityPair ?? 'TOKEN/SOL').trim().slice(0, 32);
  out.liquidityNotes = String(input.liquidityNotes ?? out.liquidityNotes ?? '').trim().slice(0, 1000);
  out.updatedAt = new Date().toISOString();
  return out;
}

const networkId = () => process.env.SOLANA_NETWORK || (String(process.env.RPC_URL || '').includes('mainnet') ? 'mainnet-beta' : 'devnet');
const networkLabel = (id) => id === 'mainnet-beta' ? 'Solana Mainnet' : id === 'testnet' ? 'Solana Testnet' : 'Solana Devnet';
const solscanPath = (path, id = networkId()) => `https://solscan.io/${path}${id === 'mainnet-beta' ? '' : `?cluster=${id}`}`;
const metadataVersionUrl = (url) => `${url.split('?')[0]}?v=${Date.now()}`;
const signatureText = (signature) => typeof signature === 'string' ? signature : base58.deserialize(signature)[0];
const txInfo = (signature) => {
  const text = signatureText(signature);
  return { signature: text, explorerUrl: solscanPath(`tx/${text}`) };
};

const respond = (res, status, data) => {
  const body = JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
};

const parseBody = (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
};

const mustAdmin = (req) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error('ADMIN_PASSWORD env missing');
  if (req.headers['x-admin-password'] !== expected) throw new Error('Unauthorized');
};

const settings = () => {
  const id = networkId();
  const rpc = process.env.RPC_URL || (id === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
  const mint = new PublicKey(process.env.MINT_ADDRESS || '8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw');
  const owner = new PublicKey(process.env.OWNER_WALLET || '8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW');
  const metadataUrl = process.env.METADATA_URL || 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';
  const githubRepo = process.env.GITHUB_REPO || 'srsystem2502/coin-project';
  const connection = new Connection(rpc, 'confirmed');
  return { id, rpc, mint, owner, metadataUrl, githubRepo, connection };
};

const loadPayer = () => {
  const raw = process.env.PAYER_KEYPAIR_JSON;
  if (!raw) throw new Error('PAYER_KEYPAIR_JSON env missing');
  const secret = JSON.parse(raw);
  if (!Array.isArray(secret) || secret.length !== 64) throw new Error('PAYER_KEYPAIR_JSON must be a 64-number JSON array');
  return Keypair.fromSecretKey(Uint8Array.from(secret));
};

const umiWithPayer = () => {
  const { rpc } = settings();
  const umi = createUmi(rpc).use(mplTokenMetadata());
  const payer = createSignerFromKeypair(umi, fromWeb3JsKeypair(loadPayer()));
  umi.use(keypairIdentity(payer));
  return { umi, payer };
};

const ui = (raw, decimals) => (Number(raw) / 10 ** decimals).toString();

const readConfig = async () => {
  if (process.env.DASHBOARD_CONFIG_JSON) return JSON.parse(process.env.DASHBOARD_CONFIG_JSON);
  return readFile(configFallbackPath, 'utf8').then(JSON.parse).catch(() => ({}));
};

const writeConfig = async (config) => writeFile(configFallbackPath, JSON.stringify(config, null, 2));

const fetchStatus = async () => {
  const { id, rpc, mint, owner, metadataUrl, githubRepo, connection } = settings();
  const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
  const ownerAta = await getAssociatedTokenAddress(mint, owner);
  const asset = await fetchDigitalAsset(createUmi(rpc).use(mplTokenMetadata()), publicKey(mint.toBase58()));
  const payer = loadPayer();
  const payerAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  const [payerSol, ownerToken, payerToken, remoteMetadata, config] = await Promise.all([
    connection.getBalance(payer.publicKey),
    getAccount(connection, ownerAta, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null),
    getAccount(connection, payerAta, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null),
    fetch(metadataUrl, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    readConfig(),
  ]);
  const payerAddress = payer.publicKey.toBase58();
  const authorityAddress = (authority) => authority?.toBase58?.() ?? String(authority || '');
  const isPayer = (authority) => Boolean(authority && authorityAddress(authority) === payerAddress);
  return {
    networkId: id,
    network: networkLabel(id),
    tokenExplorerUrl: solscanPath(`token/${mint.toBase58()}`, id),
    rpc, mint: mint.toBase58(), owner: owner.toBase58(), ownerAta: ownerAta.toBase58(),
    payer: payerAddress, payerAta: payerAta.toBase58(), payerSol: payerSol / LAMPORTS_PER_SOL,
    decimals: mintInfo.decimals, supplyRaw: mintInfo.supply.toString(), supply: ui(mintInfo.supply, mintInfo.decimals),
    mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null, freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
    ownerBalance: ownerToken ? ui(ownerToken.amount, mintInfo.decimals) : '0', ownerBalanceRaw: ownerToken?.amount.toString() ?? '0',
    payerTokenBalance: payerToken ? ui(payerToken.amount, mintInfo.decimals) : '0', payerTokenBalanceRaw: payerToken?.amount.toString() ?? '0',
    onchainMetadata: { name: asset.metadata.name, symbol: asset.metadata.symbol, uri: asset.metadata.uri, updateAuthority: authorityAddress(asset.metadata.updateAuthority), isMutable: asset.metadata.isMutable },
    remoteMetadata, metadataUrl, githubRepo,
    controls: {
      canUpdateMetadata: Boolean(asset.metadata.isMutable && isPayer(asset.metadata.updateAuthority)),
      canMint: isPayer(mintInfo.mintAuthority),
      canFreeze: isPayer(mintInfo.freezeAuthority),
      canTransferFromPayer: Boolean(payerToken),
    },
    config,
  };
};

const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'coin-dashboard' });
const getContent = async (token, path) => {
  const { githubRepo } = settings();
  const r = await fetch(`${githubApi}/repos/${githubRepo}/contents/${encodeURIComponent(path)}?ref=main`, { headers: ghHeaders(token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub get ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const putContent = async (token, path, content, message, sha) => {
  const { githubRepo } = settings();
  const r = await fetch(`${githubApi}/repos/${githubRepo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT', headers: ghHeaders(token),
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error(`GitHub put ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};

const updateMetadata = async (input) => {
  const { mint, metadataUrl, githubRepo } = settings();
  const meta = validateMetadataInput(input);
  if (meta.name.toUpperCase().includes('TETHER') || meta.symbol === 'USDT') throw new Error('Use independent branding. No Tether/USDT impersonation.');
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const content = token ? await getContent(token, 'metadata.json') : null;
  const oldMeta = await fetch(metadataUrl, { cache: 'no-store' }).then(r => r.json()).catch(() => ({}));
  const nextMeta = {
    ...oldMeta, ...meta, external_url: `https://github.com/${githubRepo}`,
    properties: { ...(oldMeta.properties || {}), category: 'image', files: [{ uri: meta.image, type: meta.image.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png' }] },
  };
  if (token) await putContent(token, 'metadata.json', `${JSON.stringify(nextMeta, null, 2)}\n`, `Update token metadata to ${meta.name}`, content?.sha);
  const { umi, payer } = umiWithPayer();
  const nextUri = metadataVersionUrl(metadataUrl);
  const tx = await updateV1(umi, { mint: publicKey(mint.toBase58()), authority: payer, payer, data: some({ name: meta.name, symbol: meta.symbol, uri: nextUri, sellerFeeBasisPoints: 0, creators: none() }), isMutable: some(true) }).sendAndConfirm(umi);
  return { githubUpdated: Boolean(token), metadata: nextMeta, metadataUri: nextUri, transaction: txInfo(tx.signature), status: await fetchStatus() };
};

const mintMore = async ({ amount }) => {
  const { mint, owner, connection } = settings();
  const { umi, payer } = umiWithPayer();
  const decimals = (await getMint(connection, mint)).decimals;
  const token = findAssociatedTokenPda(umi, { mint: publicKey(mint.toBase58()), owner: publicKey(owner.toBase58()) });
  const tx = await createTokenIfMissing(umi, { payer, mint: publicKey(mint.toBase58()), owner: publicKey(owner.toBase58()), ata: token })
    .add(mintTokensTo(umi, { mint: publicKey(mint.toBase58()), token, mintAuthority: payer, amount: parseUiAmount(amount, decimals) }))
    .sendAndConfirm(umi);
  return { transaction: txInfo(tx.signature), status: await fetchStatus() };
};

const transfer = async ({ to, amount }) => {
  const { mint, connection } = settings();
  const { umi, payer } = umiWithPayer();
  const mintPk = publicKey(mint.toBase58());
  const decimals = (await getMint(connection, mint)).decimals;
  const toWallet = publicKey(requirePublicKey(to, 'destination wallet'));
  const source = findAssociatedTokenPda(umi, { mint: mintPk, owner: payer.publicKey });
  const destination = findAssociatedTokenPda(umi, { mint: mintPk, owner: toWallet });
  const tx = await createTokenIfMissing(umi, { payer, mint: mintPk, owner: payer.publicKey, ata: source })
    .add(mintTokensTo(umi, { mint: mintPk, token: source, mintAuthority: payer, amount: parseUiAmount(amount, decimals) }))
    .add(createTokenIfMissing(umi, { payer, mint: mintPk, owner: toWallet, ata: destination }))
    .add(transferTokens(umi, { source, destination, authority: payer, amount: parseUiAmount(amount, decimals) }))
    .sendAndConfirm(umi);
  return { transaction: txInfo(tx.signature), status: await fetchStatus() };
};

const saveConfig = async (input) => {
  const next = cleanConfig(input, await readConfig());
  await writeConfig(next);
  return next;
};

const routeFrom = (req) => {
  const q = req.query?.path;
  if (Array.isArray(q)) return q[0] || 'status';
  if (typeof q === 'string' && q) return q.split('/')[0] || 'status';
  const url = req.url || '';
  return url.split('/api/')[1]?.split('?')[0]?.split('/')[0] || 'status';
};

export default async function handler(req, res) {
  try {
    mustAdmin(req);
    const route = routeFrom(req);
    const body = parseBody(req);
    if (req.method === 'GET' && route === 'status') return respond(res, 200, await fetchStatus());
    if (req.method === 'POST' && route === 'metadata') return respond(res, 200, await updateMetadata(body));
    if (req.method === 'POST' && route === 'mint') return respond(res, 200, await mintMore(body));
    if (req.method === 'POST' && route === 'transfer') return respond(res, 200, await transfer(body));
    if (req.method === 'POST' && route === 'config') return respond(res, 200, await saveConfig(body));
    return respond(res, 404, { error: 'Not found' });
  } catch (error) {
    return respond(res, error.message === 'Unauthorized' ? 401 : 400, { error: error.message });
  }
}
