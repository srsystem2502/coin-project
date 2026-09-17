# USDY TRON TRC20 Deploy

This is a TRON/TRC20 path. It is separate from Solana SPL.

## What changes

- Solana gas uses `SOL`; TRON gas uses `TRX`.
- Solana token id is a mint address; TRON token id is a contract address.
- TRC20 name/symbol are normally fixed after deploy. Pick final branding before mainnet.
- Do not use `USDT` or `Tether` branding. This project uses original `USDY` branding.

## Local commands

Compile contract:

```text
npm run tron:compile
```

Show deployer address from private key:

```text
TRON_PRIVATE_KEY=<private-key> npm run tron:address
```

Deploy to TRON mainnet:

```text
TRON_PRIVATE_KEY=<private-key> \
TRON_TOKEN_NAME="USDY TRON" \
TRON_TOKEN_SYMBOL="USDY" \
TRON_TOKEN_DECIMALS=6 \
TRON_TOKEN_SUPPLY=1000000 \
npm run tron:deploy
```

Optional owner override:

```text
TRON_OWNER_ADDRESS=<your T... wallet>
```

## Funding

Fund the deployer wallet with TRX before deploy.

Recommended:

```text
300 TRX minimum
1000 TRX safer
```

## Outputs

Ignored files:

```text
tron-artifact.json
tron-result.json
```

`tron-result.json` contains contract address and Tronscan URL after deploy.

## Safety

Never commit private key. Never paste seed phrase. Use a fresh deployer wallet if possible.
