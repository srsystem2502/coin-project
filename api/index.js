import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, keypairIdentity, none, publicKey, some } from '@metaplex-foundation/umi';
import { fetchDigitalAsset, mplTokenMetadata, updateV1 } from '@metaplex-foundation/mpl-token-metadata';
import { createTokenIfMissing, findAssociatedTokenPda, mintTokensTo, transferTokens } from '@metaplex-foundation/mpl-toolbox';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { cleanConfig, parseUiAmount, requirePublicKey, validateMetadataInput } from '../dashboard/lib.mjs';

const rpc = process.env.RPC_URL || 'https://api.devnet.solana.com';
const mint = new PublicKey(process.env.MINT_ADDRESS || '8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw');
const owner = new PublicKey(process.env.OWNER_WALLET || '8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW');
const metadataUrl = process.env.METADATA_URL || 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';
const githubRepo = process.env.GITHUB_REPO || 'srsystem2502/coin-project';
const githubApi = 'https://api.github.com';
const connection = new Connection(rpc, 'confirmed');
const configFallbackPath = '/tmp/coin-dashboard-config.json';

const respond = (res, status, data) => res.status(status).json(data);
const mustAdmin = (req) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error('ADMIN_PASSWORD env missing');
  if (req.headers['x-admin-password'] !== expected) throw new Error('Unauthorized');
};
const loadPayer = async () => {
  const raw = process.env.PAYER_KEYPAIR_JSON;
  if (!raw) throw new Error('PAYER_KEYPAIR_JSON env missing');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
};
const umiWithPayer = async () => {
  const umi = createUmi(rpc).use(mplTokenMetadata());
  const payer = createSignerFromKeypair(umi, fromWeb3JsKeypair(await loadPayer()));
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
    readConfig(),
  ]);
  return {
    network: 'Solana Devnet', rpc, mint: mint.toBase58(), owner: owner.toBase58(), ownerAta: ownerAta.toBase58(),
    payer: payer.publicKey.toBase58(), payerAta: payerAta.toBase58(), payerSol: payerSol / LAMPORTS_PER_SOL,
    decimals: mintInfo.decimals, supplyRaw: mintInfo.supply.toString(), supply: ui(mintInfo.supply, mintInfo.decimals),
    mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null, freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
    ownerBalance: ownerToken ? ui(ownerToken.amount, mintInfo.decimals) : '0', ownerBalanceRaw: ownerToken?.amount.toString() ?? '0',
    payerTokenBalance: payerToken ? ui(payerToken.amount, mintInfo.decimals) : '0', payerTokenBalanceRaw: payerToken?.amount.toString() ?? '0',
    onchainMetadata: { name: asset.metadata.name, symbol: asset.metadata.symbol, uri: asset.metadata.uri, updateAuthority: asset.metadata.updateAuthority, isMutable: asset.metadata.isMutable },
    remoteMetadata, metadataUrl, githubRepo, config,
  };
};
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'coin-dashboard' });
const getContent = async (token, path) => {
  const r = await fetch(`${githubApi}/repos/${githubRepo}/contents/${encodeURIComponent(path)}?ref=main`, { headers: ghHeaders(token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub get ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const putContent = async (token, path, content, message, sha) => {
  const r = await fetch(`${githubApi}/repos/${githubRepo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT', headers: ghHeaders(token),
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error(`GitHub put ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
};
const updateMetadata = async (input) => {
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
  const { umi, payer } = await umiWithPayer();
  await updateV1(umi, { mint: publicKey(mint.toBase58()), authority: payer, payer, data: some({ name: meta.name, symbol: meta.symbol, uri: metadataUrl, sellerFeeBasisPoints: 0, creators: none() }), isMutable: some(true) }).sendAndConfirm(umi);
  return { githubUpdated: Boolean(token), metadata: nextMeta, status: await fetchStatus() };
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
  const next = cleanConfig(input, await readConfig());
  await writeConfig(next);
  return next;
};

export default async function handler(req, res) {
  try {
    mustAdmin(req);
    const route = req.query.path?.[0] || 'status';
    if (req.method === 'GET' && route === 'status') return respond(res, 200, await fetchStatus());
    if (req.method === 'POST' && route === 'metadata') return respond(res, 200, await updateMetadata(req.body || {}));
    if (req.method === 'POST' && route === 'mint') return respond(res, 200, await mintMore(req.body || {}));
    if (req.method === 'POST' && route === 'transfer') return respond(res, 200, await transfer(req.body || {}));
    if (req.method === 'POST' && route === 'config') return respond(res, 200, await saveConfig(req.body || {}));
    return respond(res, 404, { error: 'Not found' });
  } catch (error) {
    return respond(res, error.message === 'Unauthorized' ? 401 : 400, { error: error.message });
  }
}
