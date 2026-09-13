export default async function handler(req, res) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || req.headers['x-admin-password'] !== expected) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }
  const modules = [
    '@solana/web3.js',
    '@solana/spl-token',
    '@metaplex-foundation/umi-bundle-defaults',
    '@metaplex-foundation/umi',
    '@metaplex-foundation/mpl-token-metadata',
    '@metaplex-foundation/mpl-toolbox',
    '@metaplex-foundation/umi-web3js-adapters',
  ];
  const results = [];
  for (const name of modules) {
    try {
      const mod = await import(name);
      results.push({ name, ok: true, exports: Object.keys(mod).slice(0, 8) });
    } catch (error) {
      results.push({ name, ok: false, error: error.message, stack: String(error.stack || '').slice(0, 800) });
    }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: results.every((r) => r.ok), env: {
    ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD),
    PAYER_KEYPAIR_JSON: Boolean(process.env.PAYER_KEYPAIR_JSON),
    RPC_URL: process.env.RPC_URL || null,
    MINT_ADDRESS: process.env.MINT_ADDRESS || null,
    OWNER_WALLET: process.env.OWNER_WALLET || null,
  }, results }, null, 2));
}
