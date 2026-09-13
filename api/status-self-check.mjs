import assert from 'node:assert/strict';
import status from './status.js';

process.env.ADMIN_PASSWORD = 'test';
process.env.MINT_ADDRESS = '8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw';
process.env.OWNER_WALLET = '8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW';
process.env.METADATA_URL = 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';

const req = { headers: { 'x-admin-password': 'test' } };
let statusCode = 0;
let body = '';
const res = {
  setHeader() {},
  end(value) { body = value; },
  set statusCode(value) { statusCode = value; },
  get statusCode() { return statusCode; },
};

await status(req, res);
const data = JSON.parse(body);
assert.equal(statusCode, 200);
assert.equal(data.mint, process.env.MINT_ADDRESS);
assert.equal(data.supply, '1000000');
assert.equal(data.ownerBalance, '1000000');
assert.equal(data.onchainMetadata.symbol, 'USDY');
console.log('status self-check passed');
