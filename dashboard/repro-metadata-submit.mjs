const base = 'http://127.0.0.1:3001';
const next = {
  name: 'USDTHER',
  symbol: 'USDY',
  image: 'https://i.imgur.com/yqC5NpV.png',
  description: 'Independent Solana devnet test token. Not affiliated with Tether, USDT, or any issuer of USDT.'
};
const response = await fetch(`${base}/api/metadata`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(next),
});
const body = await response.json();
console.log(JSON.stringify({ status: response.status, error: body.error ?? null, name: body.status?.onchainMetadata?.name, symbol: body.status?.onchainMetadata?.symbol, githubUpdated: body.githubUpdated ?? null }, null, 2));
if (!response.ok || body.error) process.exit(1);
