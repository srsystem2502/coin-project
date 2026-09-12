import { createServer } from 'http';
import { readFile, writeFile, stat } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, keypairIdentity, none, publicKey, some } from '@metaplex-foundation/umi';
import { fetchDigitalAsset, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata';
import { createTokenIfMissing, findAssociatedTokenPda, mintTokensTo, transferTokens } from '@metaplex-foundation/mpl-toolbox';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { cleanConfig, parseUiAmount, requirePublicKey, validateMetadataInput } from './lib.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = normalize(join(__dirname, '..'));
const publicDir = join(__dirname, 'public');
const configPath = join(__dirname, 'config.json');
const payerPath = join(root, 'payer-keypair.json');
const mint = new PublicKey('8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw');
const owner = new PublicKey('8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW');
const rpc = 'https://api.devnet.solana.com';
const metadataUrl = 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';
const githubRepo = 'srsystem2502/coin-project';
const githubApi = 'https://api.github.com';
const connection = new Connection(rpc, 'confirmed');

const json = (res, status, data) => send(res, status, 'application/json', JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const send = (res, status, type, body) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};
const readJsonBody = async (req) => JSON.parse(await new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) reject(new Error('Body too large')); });
  req.on('end', () => resolve(body || '{}'));
  req.on('error', reject);
}));
const loadPayer = async () => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(payerPath, 'utf8'))));
const umiWithPayer = async () => {
  const umi = createUmi(rpc).use(mplTokenMetadata());
  const payer = createSignerFromKeypair(umi, fromWeb3JsKeypair(await loadPayer()));
  umi.use(keypairIdentity(payer));
  return { umi, payer };
};
const ui = (raw, decimals) => (Number(raw) / 10 ** decimals).toString();
const fetchStatus = async () => {
  const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
  const ownerAta = await getAssociatedTokenAddress(mint, owner);
  const asset = await fetchDigitalAsset(createUmi(rpc).use(mplTokenMetadata()), publicKey(mint.toBase58()));
  const payer = await loadPayer();
  const payerAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  const [payerSol, ownerToken, payerToken, remoteMetadata, config] = await Promise.all([
    connection.getBalance(payer.publicKey),
    getAccount(connection, ownerAta, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null),
    getAccount(connection, payerAta, 'confirmed', TOKEN_PROGRAM_ID).catch(() => null),
    fetch(metadataUrl, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    readFile(configPath, 'utf8').then(JSON.parse).catch(() => ({})),
  ]);
  return {
    network: 'Solana Devnet',
    rpc,
    mint: mint.toBase58(),
    owner: owner.toBase58(),
    ownerAta: ownerAta.toBase58(),
    payer: payer.publicKey.toBase58(),
    payerAta: payerAta.toBase58(),
    payerSol: payerSol / LAMPORTS_PER_SOL,
    decimals: mintInfo.decimals,
    supplyRaw: mintInfo.supply.toString(),
    supply: ui(mintInfo.supply, mintInfo.decimals),
    mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null,
    freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
    ownerBalance: ownerToken ? ui(ownerToken.amount, mintInfo.decimals) : '0',
    ownerBalanceRaw: ownerToken?.amount.toString() ?? '0',
    payerTokenBalance: payerToken ? ui(payerToken.amount, mintInfo.decimals) : '0',
    payerTokenBalanceRaw: payerToken?.amount.toString() ?? '0',
    onchainMetadata: {
      name: asset.metadata.name,
      symbol: asset.metadata.symbol,
      uri: asset.metadata.uri,
      updateAuthority: asset.metadata.updateAuthority,
      isMutable: asset.metadata.isMutable,
    },
    remoteMetadata,
    metadataUrl,
    githubRepo,
    config,
  };
};
const getContent = async (token, path) => {
  const r = await fetch(`${githubApi}/repos/${githubRepo}/contents/${encodeURIComponent(path)}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'hermes-agent' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub get ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const putContent = async (token, path, content, message, sha) => {
  const r = await fetch(`${githubApi}/repos/${githubRepo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'hermes-agent' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error(`GitHub put ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const updateMetadata = async (input) => {
  const meta = validateMetadataInput(input);
  if (meta.name.toUpperCase().includes('TETHER') || meta.symbol === 'USDT') throw new Error('Use independent branding. No Tether/USDT impersonation.');
  const token = String(input.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const content = token ? await getContent(token, 'metadata.json') : null;
  const oldMeta = await fetch(metadataUrl, { cache: 'no-store' }).then(r => r.json()).catch(() => ({}));
  const nextMeta = {
    ...oldMeta,
    ...meta,
    external_url: `https://github.com/${githubRepo}`,
    properties: {
      ...(oldMeta.properties || {}),
      category: 'image',
      files: [{ uri: meta.image, type: meta.image.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png' }],
    },
  };
  const githubUpdated = Boolean(token);
  if (githubUpdated) await putContent(token, 'metadata.json', `${JSON.stringify(nextMeta, null, 2)}\n`, `Update token metadata to ${meta.name}`, content?.sha);
  else await writeFile(join(__dirname, 'metadata-preview.json'), `${JSON.stringify(nextMeta, null, 2)}\n`);

  const { umi, payer } = await umiWithPayer();
  await updateV1(umi, {
    mint: publicKey(mint.toBase58()),
    authority: payer,
    payer,
    data: some({ name: meta.name, symbol: meta.symbol, uri: metadataUrl, sellerFeeBasisPoints: 0, creators: none() }),
    isMutable: some(true),
  }).sendAndConfirm(umi);
  return { githubUpdated, metadata: nextMeta, status: await fetchStatus() };
};
const mintMore = async ({ amount }) => {
  const { umi, payer } = await umiWithPayer();
  const decimals = (await getMint(connection, mint)).decimals;
  const token = findAssociatedTokenPda(umi, { mint: publicKey(mint.toBase58()), owner: publicKey(owner.toBase58()) });
  await createTokenIfMissing(umi, { payer, mint: publicKey(mint.toBase58()), owner: publicKey(owner.toBase58()), ata: token })
    .add(mintTokensTo(umi, { mint: publicKey(mint.toBase58()), token, mintAuthority: payer, amount: parseUiAmount(amount, decimals) }))
    .sendAndConfirm(umi);
  return fetchStatus();
};
const transfer = async ({ to, amount }) => {
  const { umi, payer } = await umiWithPayer();
  const mintPk = publicKey(mint.toBase58());
  const decimals = (await getMint(connection, mint)).decimals;
  const toWallet = publicKey(requirePublicKey(to, 'destination wallet'));
  const source = findAssociatedTokenPda(umi, { mint: mintPk, owner: payer.publicKey });
  const destination = findAssociatedTokenPda(umi, { mint: mintPk, owner: toWallet });
  await createTokenIfMissing(umi, { payer, mint: mintPk, owner: payer.publicKey, ata: source })
    .add(mintTokensTo(umi, { mint: mintPk, token: source, mintAuthority: payer, amount: parseUiAmount(amount, decimals) }))
    .add(createTokenIfMissing(umi, { payer, mint: mintPk, owner: toWallet, ata: destination }))
    .add(transferTokens(umi, { source, destination, authority: payer, amount: parseUiAmount(amount, decimals) }))
    .sendAndConfirm(umi);
  return fetchStatus();
};
const saveConfig = async (input) => {
  const old = await readFile(configPath, 'utf8').then(JSON.parse).catch(() => ({}));
  const next = cleanConfig(input, old);
  await writeFile(configPath, JSON.stringify(next, null, 2));
  return next;
};
const serveFile = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const safe = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\.\.(\/|$)/, '');
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir)) return send(res, 403, 'text/plain', 'Forbidden');
  if (!existsSync(file)) return send(res, 404, 'text/plain', 'Not found');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
};

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/status')) return json(res, 200, await fetchStatus());
    if (req.method === 'POST' && req.url === '/api/metadata') return json(res, 200, await updateMetadata(await readJsonBody(req)));
    if (req.method === 'POST' && req.url === '/api/mint') return json(res, 200, await mintMore(await readJsonBody(req)));
    if (req.method === 'POST' && req.url === '/api/transfer') return json(res, 200, await transfer(await readJsonBody(req)));
    if (req.method === 'POST' && req.url === '/api/config') return json(res, 200, await saveConfig(await readJsonBody(req)));
    if (req.method === 'GET') return serveFile(req, res);
    return send(res, 405, 'text/plain', 'Method not allowed');
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`dashboard http://0.0.0.0:${process.env.PORT || 3000}`);
});
