const networkId = () => process.env.SOLANA_NETWORK || (String(process.env.RPC_URL || '').includes('mainnet') ? 'mainnet-beta' : 'devnet');
const endpoints = () => [
  process.env.RPC_URL,
  networkId() === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com',
  networkId() === 'mainnet-beta' ? null : 'https://solana-devnet.g.alchemy.com/v2/demo',
  networkId() === 'mainnet-beta' ? null : 'https://rpc.ankr.com/solana_devnet',
  networkId() === 'mainnet-beta' ? null : 'https://devnet.helius-rpc.com/?api-key=public',
];

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    const text = await response.text();
    return { url, ok: response.ok, status: response.status, ms: Date.now() - started, body: text.slice(0, 500) };
  } catch (error) {
    return { url, ok: false, ms: Date.now() - started, error: error.message, cause: error.cause?.message || null, code: error.cause?.code || null };
  }
}

export default async function handler(req, res) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || req.headers['x-admin-password'] !== expected) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }
  const results = [];
  for (const endpoint of [...new Set(endpoints().filter(Boolean))]) results.push(await probe(endpoint));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ results }, null, 2));
}
