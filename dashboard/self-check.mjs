import assert from 'node:assert/strict';
import { cleanConfig, parseUiAmount, requirePublicKey, validateMetadataInput } from './lib.mjs';

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
