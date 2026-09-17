# Deploy Coin Project Dashboard to Vercel

## 1. Import repo

Repo:

```text
https://github.com/srsystem2502/coin-project
```

Vercel settings:

```text
Framework Preset: Other
Build Command: empty
Output Directory: public
Install Command: npm install
Root Directory: ./
```

`vercel.json` routes `/api/*` to `api/index.js` and static files to `public/`.

## 2. Add Environment Variables

Set these in Vercel Project → Settings → Environment Variables:

```text
ADMIN_PASSWORD=your-secret-dashboard-password
PAYER_KEYPAIR_JSON=<full JSON array from payer-keypair.json>
GITHUB_TOKEN=<new GitHub token with repo access>
SOLANA_NETWORK=devnet
RPC_URL=https://api.devnet.solana.com
MINT_ADDRESS=8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw
OWNER_WALLET=8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW
METADATA_URL=https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json
GITHUB_REPO=srsystem2502/coin-project
DASHBOARD_CONFIG_JSON={"liquidityPair":"USDY/SOL"}
```

Do **not** commit `payer-keypair.json` or real `.env`.

## 3. Deploy

After env vars are set:

```text
Redeploy latest production deployment
```

Open Vercel URL. Dashboard prompts for `ADMIN_PASSWORD` once and stores it in browser localStorage.

## 4. Verify

Expected:

```text
/api/status returns token data
Update metadata works for independent branding
Mint works while payer has SOL
Transfer works while mint authority remains payer
```

## Safety notes

- This is devnet/test dashboard.
- For mainnet, set `SOLANA_NETWORK=mainnet-beta`, `RPC_URL=https://api.mainnet-beta.solana.com`, and mainnet `MINT_ADDRESS`/`OWNER_WALLET`.
- For mainnet, prefer Phantom wallet approval over server-stored private key.
- Do not use `USDT`, `Tether`, or confusing stablecoin impersonation branding.
- Revoke old GitHub token already shared in chat; use a fresh token in Vercel env.
