import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, keypairIdentity, publicKey, some, none } from '@metaplex-foundation/umi';
import { mplTokenMetadata, updateV1, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';

const RPC = 'https://api.devnet.solana.com';
const MINT = publicKey('8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw');
const METADATA_URI = 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';
const loadKeypair = (path) => {
  if (!existsSync(path)) throw new Error(`${path} missing`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
};
const json = (x) => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

const remote = await fetch(METADATA_URI).then((r) => {
  if (!r.ok) throw new Error(`metadata fetch failed ${r.status}`);
  return r.json();
});
if (!remote.name || !remote.symbol || !remote.image) throw new Error('metadata missing name/symbol/image');

const payerWeb3 = loadKeypair('payer-keypair.json');
const connection = new Connection(RPC, 'confirmed');
const balance = await connection.getBalance(payerWeb3.publicKey);
console.log('payer', payerWeb3.publicKey.toBase58());
console.log('payerSol', balance / LAMPORTS_PER_SOL);
if (balance < 0.01 * LAMPORTS_PER_SOL) throw new Error('Payer has not enough devnet SOL.');

const umi = createUmi(RPC).use(mplTokenMetadata());
const payer = createSignerFromKeypair(umi, fromWeb3JsKeypair(payerWeb3));
umi.use(keypairIdentity(payer));
const before = await fetchDigitalAsset(umi, MINT);

await updateV1(umi, {
  mint: MINT,
  authority: payer,
  payer,
  data: some({
    name: remote.name,
    symbol: remote.symbol,
    uri: METADATA_URI,
    sellerFeeBasisPoints: 0,
    creators: none(),
  }),
  isMutable: some(true),
}).sendAndConfirm(umi);

const after = await fetchDigitalAsset(umi, MINT);
const result = {
  mint: MINT,
  metadataUri: METADATA_URI,
  before: {
    name: before.metadata.name,
    symbol: before.metadata.symbol,
    uri: before.metadata.uri,
    updateAuthority: before.metadata.updateAuthority,
    isMutable: before.metadata.isMutable,
  },
  after: {
    name: after.metadata.name,
    symbol: after.metadata.symbol,
    uri: after.metadata.uri,
    updateAuthority: after.metadata.updateAuthority,
    isMutable: after.metadata.isMutable,
  },
  offchain: {
    name: remote.name,
    symbol: remote.symbol,
    image: remote.image,
  },
};
writeFileSync('metadata-update-result.json', json(result));
console.log(json(result));
