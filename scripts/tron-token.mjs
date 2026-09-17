import { readFileSync, writeFileSync } from 'node:fs';
import solc from 'solc';
import { TronWeb } from 'tronweb';

const command = process.argv[2] || 'compile';
const contractPath = 'contracts/USDYTron.sol';
const artifactPath = 'tron-artifact.json';
const resultPath = 'tron-result.json';
const fullHost = process.env.TRON_FULL_HOST || 'https://api.trongrid.io';
const privateKey = process.env.TRON_PRIVATE_KEY || '';
const tokenName = process.env.TRON_TOKEN_NAME || 'USDY TRON';
const tokenSymbol = process.env.TRON_TOKEN_SYMBOL || 'USDY';
const tokenDecimals = Number(process.env.TRON_TOKEN_DECIMALS || 6);
const tokenSupply = BigInt(process.env.TRON_TOKEN_SUPPLY || '1000000');
const ownerAddress = process.env.TRON_OWNER_ADDRESS || '';

const json = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

function compile() {
  const source = readFileSync(contractPath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'USDYTron.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((item) => item.severity === 'error');
  if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join('\n'));
  const contract = output.contracts['USDYTron.sol'].USDYTron;
  const artifact = { abi: contract.abi, bytecode: contract.evm.bytecode.object };
  if (!artifact.bytecode) throw new Error('TRC20 bytecode empty');
  writeFileSync(artifactPath, `${json(artifact)}\n`);
  return artifact;
}

function tronWeb() {
  if (!privateKey) throw new Error('TRON_PRIVATE_KEY env missing');
  return new TronWeb({ fullHost, privateKey });
}

function toSun(tron, trx) {
  return tron.toSun(Number(trx));
}

async function address() {
  const tron = tronWeb();
  const base58 = tron.address.fromPrivateKey(privateKey);
  const balanceSun = await tron.trx.getBalance(base58);
  const balanceTrx = Number(balanceSun) / 1_000_000;
  console.log(json({ network: fullHost, address: base58, balanceTrx }));
}

async function deploy() {
  const tron = tronWeb();
  const artifact = compile();
  const deployer = tron.address.fromPrivateKey(privateKey);
  const owner = ownerAddress || deployer;
  if (!tron.isAddress(owner)) throw new Error(`Invalid TRON owner address: ${owner}`);
  const balanceSun = await tron.trx.getBalance(deployer);
  if (balanceSun < toSun(tron, 300)) throw new Error(`Fund deployer with at least 300 TRX. Current: ${Number(balanceSun) / 1_000_000} TRX`);
  if (/USDT|TETHER/i.test(`${tokenName} ${tokenSymbol}`)) throw new Error('Use original branding. Do not use USDT/Tether.');
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) throw new Error('TRON_TOKEN_DECIMALS must be 0-18');
  if (!/^[A-Z0-9]{2,10}$/.test(tokenSymbol)) throw new Error('TRON_TOKEN_SYMBOL must be 2-10 chars A-Z/0-9');

  const contract = await tron.contract().new({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    feeLimit: toSun(tron, 500),
    callValue: 0,
    parameters: [tokenName, tokenSymbol, tokenDecimals, tokenSupply.toString(), owner],
  });
  const address = contract.address;
  const result = {
    network: fullHost,
    name: tokenName,
    symbol: tokenSymbol,
    decimals: tokenDecimals,
    supply: tokenSupply.toString(),
    owner,
    deployer,
    contract: address,
    explorerUrl: `https://tronscan.org/#/contract/${address}`,
  };
  writeFileSync(resultPath, `${json(result)}\n`);
  console.log(json(result));
}

if (command === 'compile') {
  const artifact = compile();
  console.log(json({ ok: true, artifact: artifactPath, abiItems: artifact.abi.length, bytecodeBytes: artifact.bytecode.length / 2 }));
} else if (command === 'address') {
  await address();
} else if (command === 'deploy') {
  await deploy();
} else {
  throw new Error(`Unknown command: ${command}. Use compile, address, or deploy.`);
}
