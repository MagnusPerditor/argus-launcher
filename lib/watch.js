// Watch-progress tracking for external players.
//  - mpv: JSON IPC over a named pipe (Windows) / unix socket, observing time-pos + duration
//  - VLC: its local HTTP interface (/requests/status.json), polled every few seconds
// Both start at a resume position. Progress is reported through onProgress(key, {pos, dur}).
const net = require('net');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const WATCHED_PCT = 0.9;      // past 90% counts as watched
const WATCHED_TAIL = 150;     // ...or within 2.5 minutes of the end (end credits) for anything 20+ minutes long

function summarize(pos, dur, prev = {}) {
  pos = Math.max(0, +pos || 0); dur = Math.max(0, +dur || prev.dur || 0);
  const pct = dur ? Math.min(1, pos / dur) : 0;
  const watched = !!(dur && (pct >= WATCHED_PCT || (dur >= 1200 && dur - pos <= WATCHED_TAIL))) || (!!prev.watched && pos < 5);
  return { pos: Math.round(pos), dur: Math.round(dur), pct: Math.round(pct * 1000) / 1000, watched };
}

let pipeSeq = 0;
function ipcPath() {
  const id = `argus-mpv-${process.pid}-${++pipeSeq}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), id + '.sock');
}

function trackMpv({ exe, target, start, onProgress, onExit, extraArgs = [] }) {
  const sock = ipcPath();
  const args = ['--fs', '--force-window', `--input-ipc-server=${sock}`, ...(start > 5 ? [`--start=${Math.floor(start)}`] : []), ...extraArgs, target];
  const child = spawn(exe, args, { detached: false, stdio: 'ignore', windowsHide: false });
  let pos = 0, dur = 0, conn = null, buf = '', tries = 0, lastEmit = 0, done = false;
  const emit = force => { const now = Date.now(); if (!dur && !force) return; if (force || now - lastEmit > 4000) { lastEmit = now; if (dur || pos) onProgress({ pos, dur }); } };
  const connect = () => {
    if (done) return;
    conn = net.connect(sock);
    conn.on('connect', () => {
      conn.write(JSON.stringify({ command: ['observe_property', 1, 'time-pos'] }) + '\n');
      conn.write(JSON.stringify({ command: ['observe_property', 2, 'duration'] }) + '\n');
    });
    conn.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.event === 'property-change') {
            if (m.name === 'time-pos' && typeof m.data === 'number') { pos = m.data; emit(false); }
            if (m.name === 'duration' && typeof m.data === 'number') dur = m.data;
          }
        } catch {}
      }
    });
    conn.on('error', () => { if (!done && ++tries < 40) setTimeout(connect, 250); });
  };
  setTimeout(connect, 300);
  child.on('error', e => { done = true; onExit && onExit(e); });
  child.on('exit', () => { done = true; try { conn && conn.destroy(); } catch {} emit(true); onExit && onExit(); });
  return child;
}

function vlcStatus(port, pw) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/requests/status.json', headers: { Authorization: 'Basic ' + Buffer.from(':' + pw).toString('base64') }, timeout: 2000 }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function trackVlc({ exe, target, start, onProgress, onExit, statusFn = vlcStatus }) {
  const port = 49200 + Math.floor(Math.random() * 600);
  const pw = crypto.randomBytes(9).toString('hex');
  const args = ['--fullscreen', '--qt-continue=0', '--extraintf=http', '--http-host=127.0.0.1', `--http-port=${port}`, `--http-password=${pw}`,
    ...(start > 5 ? [`--start-time=${Math.floor(start)}`] : []), '--play-and-exit', target];
  const child = spawn(exe, args, { detached: false, stdio: 'ignore', windowsHide: false });
  let pos = 0, dur = 0, done = false;
  const timer = setInterval(async () => {
    if (done) return;
    const s = await statusFn(port, pw);
    if (s && typeof s.time === 'number') {
      // VLC reports whole seconds in time/length; position (0..1) is finer when available
      dur = s.length > 0 ? s.length : dur;
      pos = dur && typeof s.position === 'number' && s.position > 0 ? s.position * dur : s.time;
      if (dur) onProgress({ pos, dur });
    }
  }, 4000);
  const finish = () => { if (done) return; done = true; clearInterval(timer); if (dur || pos) onProgress({ pos, dur }); onExit && onExit(); };
  child.on('error', e => { clearInterval(timer); done = true; onExit && onExit(e); });
  child.on('exit', finish);
  return { child, port, pw, args };
}

module.exports = { summarize, trackMpv, trackVlc, vlcStatus, WATCHED_PCT, WATCHED_TAIL };
