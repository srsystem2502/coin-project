import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, keypairIdentity, none, percentAmount, publicKey, some } from '@metaplex-foundation/umi';
import { createFungible, fetchDigitalAsset, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { createTokenIfMissing, findAssociatedTokenPda, mintTokensTo } from '@metaplex-foundation/mpl-toolbox';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';

const command = process.argv[2] || 'status';
const payerPath = 'mainnet-payer-keypair.json';
const mintPath = 'mainnet-mint-keypair.json';
const resultPath = 'mainnet-result.json';
const rpc = process.env.MAINNET_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const metadataUrl = process.env.MAINNET_METADATA_URL || process.env.METADATA_URL || 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';
const decimals = Number(process.env.MAINNET_DECIMALS || process.env.DECIMALS || 9);
const supply = BigInt(process.env.MAINNET_SUPPLY || process.env.SUPPLY || '1000000');
const minSol = Number(process.env.MAINNET_MIN_SOL || 0.05);
const connection = new Connection(rpc, 'confirmed');

const json = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const saveKeypair = (path, keypair) => writeFileSync(path, `${json([...keypair.secretKey])}\n`, { mode: 0o600 });
const loadKeypair = (path) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));

function ensureKeypair(path) {
  if (!existsSync(path)) saveKeypair(path, Keypair.generate());
  return loadKeypair(path);
}

function loadRequiredKeypair(path) {
  if (!existsSync(path)) throw new Error(`${path} missing. Run: npm run mainnet:prepare`);
  return loadKeypair(path);
}

function assertSafeMetadata(metadata) {
  const name = String(metadata.name || '').trim();
  const symbol = String(metadata.symbol || '').trim().toUpperCase();
  const description = String(metadata.description || '').trim();
  const image = String(metadata.image || '').trim();
  if (!name || name.length > 32) throw new Error('Mainnet name required, max 32 chars');
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('Mainnet symbol must be 2-10 chars: A-Z/0-9');
  if (!description || description.length > 500) throw new Error('Mainnet description required, max 500 chars');
  if (!/^https:\/\//.test(image)) throw new Error('Mainnet logo image must be https://');
  if (/USDT|TETHER/i.test(`${name} ${symbol} ${description}`)) throw new Error('Mainnet branding must be original. Do not use USDT/Tether or confusing stablecoin wording.');
  return { name, symbol, description, image };
}

async function fetchMetadata() {
  const response = await fetch(metadataUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`metadata fetch failed ${response.status}: ${metadataUrl}`);
  return assertSafeMetadata(await response.json());
}

function ownerPublicKey(payer) {
  const value = process.env.MAINNET_OWNER_WALLET || process.env.OWNER_WALLET || payer.publicKey.toBase58();
  return { web3: new PublicKey(value), umi: publicKey(value) };
}

async function prepare() {
  const payer = ensureKeypair(payerPath);
  const mint = ensureKeypair(mintPath);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(json({
    network: 'mainnet-beta',
    rpc,
    payer: payer.publicKey.toBase58(),
    plannedMint: mint.publicKey.toBase58(),
    payerSol: balance / LAMPORTS_PER_SOL,
    recommendedFunding: '0.1 SOL minimum; 0.5 SOL safer for repeated tests/liquidity prep',
    next: `Send SOL to payer, then run: npm run mainnet:status`,
  }));
}

async function status() {
  const payer = loadRequiredKeypair(payerPath);
  const mint = loadRequiredKeypair(mintPath);
  const balance = await connection.getBalance(payer.publicKey);
  const mintAccount = await connection.getAccountInfo(mint.publicKey);
  console.log(json({
    network: 'mainnet-beta',
    rpc,
    payer: payer.publicKey.toBase58(),
    plannedMint: mint.publicKey.toBase58(),
    payerSol: balance / LAMPORTS_PER_SOL,
    fundedEnoughForDeploy: balance >= minSol * LAMPORTS_PER_SOL,
    mintAlreadyExists: Boolean(mintAccount),
    metadataUrl,
  }));
}

async function deploy() {
  const payerWeb3 = loadRequiredKeypair(payerPath);
  const mintWeb3 = loadRequiredKeypair(mintPath);
  const mintAccount = await connection.getAccountInfo(mintWeb3.publicKey);
  if (mintAccount) throw new Error(`Mint already exists on mainnet: ${mintWeb3.publicKey.toBase58()}`);
  const balance = await connection.getBalance(payerWeb3.publicKey);
  if (balance < minSol * LAMPORTS_PER_SOL) throw new Error(`Payer needs at least ${minSol} SOL. Current: ${balance / LAMPORTS_PER_SOL}`);
  const metadata = await fetchMetadata();
  const owner = ownerPublicKey(payerWeb3);

  const umi = createUmi(rpc).use(mplTokenMetadata());
  const payer = createSignerFromKeypair(umi, fromWeb3JsKeypair(payerWeb3));
  const mint = createSignerFromKeypair(umi, fromWeb3JsKeypair(mintWeb3));
  umi.use(keypairIdentity(payer));

  const createTx = await createFungible(umi, {
    mint,
    authority: payer,
    payer,
    updateAuthority: payer,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadataUrl,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: some(decimals),
    creators: none(),
    collectionDetails: none(),
    printSupply: none(),
    isMutable: true,
  }).sendAndConfirm(umi);

  const token = findAssociatedTokenPda(umi, { mint: mint.publicKey, owner: owner.umi });
  const mintTx = await createTokenIfMissing(umi, {
    payer,
    mint: mint.publicKey,
    owner: owner.umi,
    ata: token,
  }).add(mintTokensTo(umi, {
    mint: mint.publicKey,
    token,
    mintAuthority: payer,
    amount: supply * 10n ** BigInt(decimals),
  })).sendAndConfirm(umi);

  const asset = await fetchDigitalAsset(umi, mint.publicKey);
  const ownerBalance = await connection.getTokenAccountBalance(new PublicKey(token[0]));
  const result = {
    network: 'mainnet-beta',
    rpc,
    name: metadata.name,
    symbol: metadata.symbol,
    decimals,
    supply: supply.toString(),
    owner: owner.web3.toBase58(),
    payer: payer.publicKey,
    mint: mint.publicKey,
    associatedTokenAccount: token[0],
    ownerTokenBalance: ownerBalance.value.uiAmountString,
    metadataUri: metadataUrl,
    updateAuthority: asset.metadata.updateAuthority,
    isMutable: asset.metadata.isMutable,
    createSignature: createTx.signature,
    mintSignature: mintTx.signature,
    dashboardEnv: {
      SOLANA_NETWORK: 'mainnet-beta',
      RPC_URL: rpc,
      MINT_ADDRESS: String(mint.publicKey),
      OWNER_WALLET: owner.web3.toBase58(),
      METADATA_URL: metadataUrl,
      GITHUB_REPO: process.env.GITHUB_REPO || 'srsystem2502/coin-project',
    },
  };
  writeFileSync(resultPath, `${json(result)}\n`);
  console.log(json(result));
}

if (command === 'prepare') await prepare();
else if (command === 'status') await status();
else if (command === 'deploy') await deploy();
else throw new Error(`Unknown command: ${command}. Use prepare, status, or deploy.`);
