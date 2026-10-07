/**
 * TEMP de-risk probe (not a PEN case). Reuses the token captured by
 * pen-discover.spec.ts to confirm a standalone Node SignalR client can reach the
 * scratch hub, and to check whether JoinScratch fails consistently (backend
 * outage) or intermittently. Run: node scripts/pen/hub-probe.mjs
 */
import { readFileSync } from 'node:fs';

const RS = '\u001e';
const capture = JSON.parse(readFileSync('test-results/tmp/pen-discover.json', 'utf8'));
const hubUrl = capture.hubUrl;
const token = new URL(hubUrl).searchParams.get('access_token');
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const now = Math.floor(Date.now() / 1000);
console.log(`token pId=${claims.pId} gId=${claims.gId} exp in ${claims.exp - now}s`);

// The JoinScratch arguments the game itself sent, lifted from the capture.
const joinArgs = JSON.parse(
  capture.frames.find((f) => f.dir === 'out' && f.payload.includes('JoinScratch')).payload.split(RS)[0],
).arguments;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(hubUrl);
    let invocationId = 0;
    const pending = new Map();
    ws.addEventListener('open', () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS));
    ws.addEventListener('error', (e) => reject(e.error ?? new Error('ws error')));
    ws.addEventListener('message', (ev) => {
      for (const chunk of String(ev.data).split(RS)) {
        if (!chunk.trim()) continue;
        const msg = JSON.parse(chunk);
        if (msg.type === 3 && pending.has(msg.invocationId)) {
          pending.get(msg.invocationId)(msg);
          pending.delete(msg.invocationId);
        }
      }
    });
    const ready = new Promise((res) => {
      const onFirst = (ev) => {
        if (String(ev.data).startsWith('{}')) {
          ws.removeEventListener('message', onFirst);
          res();
        }
      };
      ws.addEventListener('message', onFirst);
    });
    const invoke = (target, args) =>
      new Promise((res) => {
        const id = String(invocationId++);
        pending.set(id, res);
        ws.send(JSON.stringify({ target, arguments: args, invocationId: id, type: 1 }) + RS);
      });
    resolve({ ws, ready, invoke });
  });
}

const { ws, ready, invoke } = await connect();
await ready;
console.log('handshake ok');
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const res = await invoke('JoinScratch', joinArgs);
  console.log(`JoinScratch #${attempt}:`, res.error ? `ERROR ${res.error}` : 'OK ' + JSON.stringify(res.result).slice(0, 120));
  await new Promise((r) => setTimeout(r, 1500));
}

// Protocol-layer probes that don't need a joined session (PEN-034 / PEN-011 / PEN-006/007).
const show = (label, res) =>
  console.log(`${label}:`, res.error ? `ERROR ${res.error}` : 'RESULT ' + JSON.stringify(res.result).slice(0, 160));
show('SetBalance (unknown/admin target, PEN-034)', await invoke('SetBalance', [999999]));
show('AdminStart (unknown target, PEN-034)', await invoke('AdminStart', []));
show('StartRound before join, bet=-100 (PEN-002/011)', await invoke('StartRound', [-100, 0]));
show('StartRound bet="1e9" string (PEN-006)', await invoke('StartRound', ['1e9', 0]));
show('Cashout with no round (PEN-011)', await invoke('Cashout', []));

// PEN-032: malformed frame (missing record separator + non-JSON). Server must not drop auth/500-storm.
try {
  ws.send('{"type":1,"target":"StartRound"');
  ws.send('not json at all' + RS);
  await new Promise((r) => setTimeout(r, 1000));
  console.log('malformed frames sent; socket state =', ws.readyState === 1 ? 'still open' : 'closed');
} catch (e) {
  console.log('malformed send threw:', e.message);
}
ws.close();
