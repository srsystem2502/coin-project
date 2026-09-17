import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import statusHandler from '../api/status.js';

const root = new URL('../public/', import.meta.url).pathname;
const qaDir = new URL('./qa/', import.meta.url).pathname;
const chromePath = '/opt/data/home/.local/bin/google-chrome';
const port = 4177;
const cdpPort = 9333;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
process.env.ADMIN_PASSWORD = 'test';
process.env.MINT_ADDRESS = '8CT28vWpZNebJrcuBjQTErMoUXsxQr2nj1gaUsrqURrw';
process.env.OWNER_WALLET = '8uvJhjUsUPguLgJLX5bkqWUhkdVS7SwiqGkCLv1nbqqW';
process.env.METADATA_URL = 'https://raw.githubusercontent.com/srsystem2502/coin-project/main/metadata.json';

if (!existsSync(chromePath)) throw new Error(`Chrome missing: ${chromePath}`);

function handler(req, res) {
  if (req.url?.startsWith('/api/status')) {
    req.headers['x-admin-password'] = req.headers['x-admin-password'] || 'test';
    return statusHandler(req, res);
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const file = join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  readFile(file).then((data) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(data);
  }).catch(() => {
    res.statusCode = 404;
    res.end('not found');
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function fetchJson(url, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return await res.json();
    } catch (error) {
      clearTimeout(timeout);
      last = error;
      await delay(250);
    }
  }
  throw last;
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timeout } = pending.get(msg.id);
      clearTimeout(timeout);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  return new Promise((resolve, reject) => {
    const openTimeout = setTimeout(() => reject(new Error('CDP websocket open timeout')), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(openTimeout);
      resolve({
        events,
        send(method, params = {}) {
          const callId = ++id;
          ws.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              pending.delete(callId);
              reject(new Error(`CDP timeout: ${method}`));
            }, 10_000);
            pending.set(callId, { resolve, reject, timeout });
          });
        },
        close() { ws.close(); },
      });
    });
    ws.addEventListener('error', () => reject(new Error('CDP websocket error')));
  });
}
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
  return result.result.value;
}
async function runViewport(cdp, width, height, mobile, name) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await delay(500);
  for (let i = 0; i < 80; i++) {
    const ready = await evaluate(cdp, `(() => document.querySelector('#log')?.textContent.includes('loaded'))()`);
    const hasError = await evaluate(cdp, `document.querySelector('#log')?.textContent.startsWith('ERROR:')`);
    if (ready || hasError) break;
    await delay(250);
  }
  const state = await evaluate(cdp, `(() => {
    const root = document.documentElement;
    const body = document.body.innerText;
    const side = document.querySelector('.sidebar')?.getBoundingClientRect();
    const hero = document.querySelector('.heroPanel')?.getBoundingClientRect();
    const forms = [...document.querySelectorAll('form')].map((f) => ({ id: f.id, width: Math.round(f.getBoundingClientRect().width) }));
    return {
      title: document.title,
      body,
      tokenName: document.querySelector('#tokenName')?.textContent,
      supply: document.querySelector('#metricSupply')?.textContent,
      ownerBalance: document.querySelector('#metricOwnerBalance')?.textContent,
      log: document.querySelector('#log')?.textContent,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      sidebarWidth: Math.round(side?.width || 0),
      heroWidth: Math.round(hero?.width || 0),
      formCount: forms.length,
      forms,
    };
  })()`);
  if (state.title !== 'COin Dashboard') throw new Error(`${name}: wrong title ${state.title}`);
  for (const text of ['Satu panel. Semua kontrol COin.', 'Status token', 'Atur tampilan COin', 'Konfigurasi project', 'Kirim COin']) {
    if (!state.body.includes(text)) throw new Error(`${name}: missing text ${text}`);
  }
  if (state.log.startsWith('ERROR:')) throw new Error(`${name}: ${state.log}`);
  if (state.supply !== '1000000') throw new Error(`${name}: supply ${state.supply}`);
  if (state.ownerBalance !== '1000000') throw new Error(`${name}: owner balance ${state.ownerBalance}`);
  if (state.scrollWidth > state.clientWidth + 2) throw new Error(`${name}: horizontal overflow ${state.scrollWidth}/${state.clientWidth}`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const path = `${qaDir}coin-${name}.png`;
  await writeFile(path, Buffer.from(shot.data, 'base64'));
  return { ...state, screenshot: path };
}

const server = createServer(handler);
let chrome;
try {
  await mkdir(qaDir, { recursive: true });
  await listen(server);
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions',
    '--remote-allow-origins=*', `--remote-debugging-port=${cdpPort}`, '--user-data-dir=/tmp/coin-ui-chrome',
    'about:blank',
  ], { stdio: 'ignore' });
  const tabs = await fetchJson(`http://127.0.0.1:${cdpPort}/json`);
  const tab = tabs.find((t) => t.type === 'page');
  if (!tab) throw new Error('CDP page tab missing');
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('coin_dashboard_admin_password','test'); window.prompt = () => 'test';` });
  const desktop = await runViewport(cdp, 1365, 900, false, 'desktop');
  const mobile = await runViewport(cdp, 390, 844, true, 'mobile');
  const badEvents = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
  cdp.close();
  if (badEvents.length) throw new Error(`runtime exceptions: ${badEvents.length}`);
  console.log(JSON.stringify({ ok: true, desktop, mobile }, null, 2));
} finally {
  server.close();
  if (chrome) chrome.kill('SIGTERM');
}
