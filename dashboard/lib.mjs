import { PublicKey } from '@solana/web3.js';

export function parseUiAmount(value, decimals) {
  const text = String(value ?? '').trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Invalid decimals');
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(text)) throw new Error(`Amount must be a positive decimal with max ${decimals} decimals`);
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n) throw new Error('Amount must be greater than 0');
  return amount;
}

export function requirePublicKey(value, label = 'wallet') {
  try { return new PublicKey(String(value ?? '').trim()).toBase58(); }
  catch { throw new Error(`${label} must be a valid Solana address`); }
}

export function validateMetadataInput(input) {
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

export function cleanConfig(input, fallback = {}) {
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

export function networkLabel(networkId) {
  if (networkId === 'mainnet-beta') return 'Solana Mainnet';
  if (networkId === 'testnet') return 'Solana Testnet';
  return 'Solana Devnet';
}

function solscanPath(path, networkId) {
  const cluster = networkId === 'mainnet-beta' ? '' : `?cluster=${networkId || 'devnet'}`;
  return `https://solscan.io/${path}${cluster}`;
}

export function solscanTransactionUrl(signature, networkId) {
  return solscanPath(`tx/${signature}`, networkId);
}

export function solscanTokenUrl(mint, networkId) {
  return solscanPath(`token/${mint}`, networkId);
}
