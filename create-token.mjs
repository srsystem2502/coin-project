import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createSignerFromKeypair,
  keypairIdentity,
  percentAmount,
  publicKey,
  some,
  none,
} from '@metaplex-foundation/umi';
import { mplTokenMetadata, createFungible, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata';
import { createTokenIfMissing, findAssociatedTokenPda, mintTokensTo } from '@metaplex-foundation/mpl-toolbox';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';

const RPC = 'https://api.devnet.solana.com';
const OWNER = publicKey('8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW');
const NAME = 'Her USD';
const SYMBOL = 'HERUSD';
const DECIMALS = 9;
const SUPPLY = 1_000_000n;
const METADATA_URI = 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';

const loadKeypair = (path) => {
  if (!existsSync(path)) throw new Error(`${path} missing`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
};
const json = (x) => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

const payerWeb3 = loadKeypair('payer-keypair.json');
const mintWeb3 = loadKeypair('mint-keypair.json');
const connection = new Connection(RPC, 'confirmed');
const balance = await connection.getBalance(payerWeb3.publicKey);
console.log('payer', payerWeb3.publicKey.toBase58());
console.log('mint', mintWeb3.publicKey.toBase58());
console.log('payerSol', balance / LAMPORTS_PER_SOL);
if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error('Payer has not enough devnet SOL. Send devnet SOL first.');

const umi = createUmi(RPC).use(mplTokenMetadata());
const payer = createSignerFromKeypair(umi, fromWeb3JsKeypair(payerWeb3));
const mint = createSignerFromKeypair(umi, fromWeb3JsKeypair(mintWeb3));
umi.use(keypairIdentity(payer));

await createFungible(umi, {
  mint,
  authority: payer,
  payer,
  updateAuthority: payer,
  name: NAME,
  symbol: SYMBOL,
  uri: METADATA_URI,
  sellerFeeBasisPoints: percentAmount(0),
  decimals: some(DECIMALS),
  creators: none(),
  collectionDetails: none(),
  printSupply: none(),
  isMutable: true,
}).sendAndConfirm(umi);

const token = findAssociatedTokenPda(umi, { mint: mint.publicKey, owner: OWNER });
await createTokenIfMissing(umi, {
  payer,
  mint: mint.publicKey,
  owner: OWNER,
  ata: token,
}).add(mintTokensTo(umi, {
  mint: mint.publicKey,
  token,
  mintAuthority: payer,
  amount: SUPPLY * 10n ** BigInt(DECIMALS),
})).sendAndConfirm(umi);

const asset = await fetchDigitalAsset(umi, mint.publicKey);
const ownerBalance = await connection.getTokenAccountBalance(new PublicKey(token[0]));
const result = {
  network: 'solana-devnet',
  rpc: RPC,
  name: NAME,
  symbol: SYMBOL,
  decimals: DECIMALS,
  supply: SUPPLY.toString(),
  owner: OWNER,
  payer: payer.publicKey,
  mint: mint.publicKey,
  associatedTokenAccount: token[0],
  ownerTokenBalance: ownerBalance.value.uiAmountString,
  metadataUri: METADATA_URI,
  updateAuthority: asset.metadata.updateAuthority,
  isMutable: asset.metadata.isMutable,
  note: 'Independent devnet test token. Not affiliated with Tether, USDT, or any issuer of USDT.',
};
writeFileSync('result.json', json(result));
console.log(json(result));
