import assert from 'node:assert/strict';
import { cleanConfig, networkLabel, parseUiAmount, requirePublicKey, solscanTokenUrl, solscanTransactionUrl, validateMetadataInput } from './lib.mjs';

assert.equal(networkLabel('mainnet-beta'), 'Solana Mainnet');
assert.equal(networkLabel('devnet'), 'Solana Devnet');
assert.equal(solscanTransactionUrl('abc123', 'mainnet-beta'), 'https://solscan.io/tx/abc123');
assert.equal(solscanTransactionUrl('abc123', 'devnet'), 'https://solscan.io/tx/abc123?cluster=devnet');
assert.equal(solscanTokenUrl('mint123', 'mainnet-beta'), 'https://solscan.io/token/mint123');
assert.equal(solscanTokenUrl('mint123', 'devnet'), 'https://solscan.io/token/mint123?cluster=devnet');
assert.equal(parseUiAmount('1.5', 9).toString(), '1500000000');
assert.equal(parseUiAmount('0.000000001', 9).toString(), '1');
assert.throws(() => parseUiAmount('0.0000000001', 9), /max 9/);
assert.equal(requirePublicKey('8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW'), '8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW');
assert.throws(() => requirePublicKey('bad'), /valid Solana/);
assert.deepEqual(validateMetadataInput({ name: 'Coin', symbol: 'usd1', description: 'ok', image: 'https://example.com/a.png' }), {
  name: 'Coin', symbol: 'USD1', description: 'ok', image: 'https://example.com/a.png'
});
assert.throws(() => validateMetadataInput({ name: '', symbol: 'USDT', description: 'ok', image: 'http://x' }), /Name required/);
assert.equal(cleanConfig({ adminWallet: '', liquidityPair: 'USDY/SOL', liquidityNotes: 'x' }).liquidityPair, 'USDY/SOL');
console.log('self-check passed');
