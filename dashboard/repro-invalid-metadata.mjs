const response = await fetch('http://127.0.0.1:3001/api/metadata', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'USDTHER', symbol: 'USDT', image: 'https://i.imgur.com/yqC5NpV.png', description: 'test' }),
});
const body = await response.json();
console.log(JSON.stringify({ status: response.status, error: body.error ?? null }, null, 2));
if (!body.error) process.exit(1);
