const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- one-time migration from the old "OmniLauncher" name ----------
// Copies settings, library, caches and tile images from %APPDATA%\OmniLauncher (the old folder is left in place).
(function migrateFromOmniLauncher() {
  try {
    const newDir = app.getPath('userData');
    const oldDir = path.join(app.getPath('appData'), 'OmniLauncher');
    if (fs.existsSync(path.join(newDir, 'config.json')) || !fs.existsSync(path.join(oldDir, 'config.json'))) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const f of ['config.json', 'library.json', 'metacache.json', 'state.json']) {
      if (fs.existsSync(path.join(oldDir, f))) fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
    }
    for (const d of ['cache', 'tiles']) {
      if (fs.existsSync(path.join(oldDir, d))) fs.cpSync(path.join(oldDir, d), path.join(newDir, d), { recursive: true });
    }
    fs.writeFileSync(path.join(newDir, 'migrated-from-omnilauncher.txt'), `Copied from ${oldDir} on ${new Date().toISOString()}\n`);
  } catch (e) { /* never block startup on migration */ }
})();

// ---------- crash logging (written to %APPDATA%\Argus Launcher\crash.log) ----------
const LOG_DIR = app.getPath('userData');
const LOG = path.join(LOG_DIR, 'crash.log');
const GPU_FLAG = path.join(LOG_DIR, 'gpu-disabled.flag');
const NOSANDBOX_FLAG = path.join(LOG_DIR, 'no-sandbox.flag');
function log(...parts) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${parts.map(p => p && p.stack ? p.stack : typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}\n`); } catch {}
}
function fatal(where, err) {
  log('FATAL in ' + where, err);
  try { dialog.showErrorBox('Argus Launcher error', `${where}:\n\n${err && err.stack || err}\n\nDetails saved to:\n${LOG}`); } catch {}
}
process.on('uncaughtException', e => fatal('main process', e));
process.on('unhandledRejection', e => log('unhandledRejection', e));
log(`start v${app.getVersion()} electron ${process.versions.electron} ${process.platform} ${require('os').release()} exe=${process.execPath}`);
// If the GPU process crashed last time, start in software rendering (delete the flag file to undo).
if (fs.existsSync(GPU_FLAG) || process.argv.includes('--safe-mode')) { app.disableHardwareAcceleration(); log('hardware acceleration disabled'); }
// Chromium's sandbox can't start helper processes when the app sits in a folder the sandbox can't read
// (seen as launch-failed / Access Denied, e.g. some D:\ folders). Fall back to --no-sandbox once and remember it.
const sandboxOff = fs.existsSync(NOSANDBOX_FLAG) || process.argv.includes('--no-sandbox');
if (sandboxOff) { app.commandLine.appendSwitch('no-sandbox'); log('sandbox disabled'); }
let relaunching = false;
function onChildGone(kind, d) {
  log(kind, d);
  if (d.reason === 'launch-failed' && !sandboxOff && !relaunching) {
    relaunching = true;
    try { fs.writeFileSync(NOSANDBOX_FLAG, 'helper launch failed ' + new Date().toISOString()); } catch {}
    log('relaunching without sandbox');
    app.relaunch({ args: process.argv.slice(1).concat('--no-sandbox') });
    app.exit(0);
    return;
  }
  if (d.type === 'GPU' && (d.reason === 'crashed' || d.reason === 'abnormal-exit')) { try { fs.writeFileSync(GPU_FLAG, 'gpu crashed ' + new Date().toISOString()); } catch {} }
}
app.on('child-process-gone', (_e, d) => onChildGone('child-process-gone', d));
app.on('render-process-gone', (_e, _wc, d) => onChildGone('render-process-gone', d));

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const { Store } = require('./lib/store');
const { Library } = require('./lib/library');
const { Launcher, detectPlayers } = require('./lib/launcher');
const { TorBox } = require('./lib/torbox');
const { Tmdb, Omdb, SteamGrid } = require('./lib/scrapers');
const { detectPsPlus } = require('./lib/games');
const E = require('./lib/emulation');
const services = require('./lib/services');
const { summarize } = require('./lib/watch');

let win, store, library, launcher;

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function createWindow() {
  log('creating window');
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0b0d12', title: 'Argus Launcher', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('preload-error', (_e, p, err) => fatal('preload ' + p, err));
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) log('renderer:', e.message, `${e.sourceId || ''}:${e.lineNumber || ''}`); });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('did-fail-load', code, desc, url));
  win.webContents.once('did-finish-load', () => log('page loaded'));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
}

app.whenReady().then(() => {
  log('ready');
  store = new Store(app.getPath('userData'));
  library = new Library(store, p => send('scan:progress', p));
  launcher = new Launcher({
    shell, BrowserWindow, app, rendererDir: path.join(__dirname, 'renderer'),
    getConfig: () => store.getConfig(),
    torbox: () => new TorBox(store.getConfig().keys.torbox),
    onProgress: (key, raw) => saveWatch(key, raw),
  });
  // ---- watch progress (movies, episodes, music videos) ----
  const readState = () => ({ played: {}, progress: {}, ...store.read('state', {}) });
  function saveWatch(key, raw) {
    const s = readState();
    const prev = s.progress[key] || {};
    s.progress[key] = { ...prev, ...summarize(raw.pos, raw.dur, prev), t: Date.now() };
    store.write('state', s);
    send('progress:update', { key, data: s.progress[key] });
  }
  ipcMain.on('player:progress', (_e, key, pos, dur) => { if (key) saveWatch(key, { pos, dur }); });

  const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return await fn(...args); } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });

  handle('config:get', () => store.getConfig());
  handle('config:set', cfg => store.setConfig(cfg));
  handle('services:catalog', () => ({ video: services.VIDEO_SERVICES, music: services.MUSIC_VIDEO_SERVICES, audio: services.MUSIC_SERVICES }));
  handle('library:get', () => library.data);
  handle('library:rescan', only => library.rescan(only));
  handle('library:season', (tvId, n) => library.season(tvId, n));
  handle('state:get', () => store.read('state', { played: {}, progress: {} }));
  handle('state:played', id => { const s = store.read('state', { played: {}, progress: {} }); s.played[id] = Date.now(); store.write('state', s); return s; });
  handle('state:mark', (keys, watched) => {
    const s = readState();
    for (const k of [].concat(keys || [])) {
      if (watched) { const prev = s.progress[k] || {}; s.progress[k] = { ...prev, pos: prev.dur || prev.pos || 0, pct: 1, watched: true, t: Date.now() }; }
      else delete s.progress[k];
    }
    store.write('state', s);
    return s;
  });
  handle('state:progress', (id, data) => { const s = store.read('state', { played: {}, progress: {} }); s.progress[id] = { ...data, t: Date.now() }; store.write('state', s); return true; });
  handle('torbox:link', tb => launcher.torboxLink(tb));
  handle('torbox:override', async (key, cat) => {
    const cfg = store.getConfig();
    if (cat) cfg.torboxOverrides[key] = cat; else delete cfg.torboxOverrides[key];
    store.setConfig(cfg);
    return library.rescan();
  });
  handle('play', req => launcher.play(req));
  handle('window:fullscreen', on => { if (win && !win.isDestroyed()) win.setFullScreen(!!on); return win ? win.isFullScreen() : false; });
  handle('log', (...a) => { log('ui:', ...a); return true; });
  handle('open:external', url => { if (/^(https?:\/\/|steam:|com\.epicgames\.launcher:|msxbox:|ms-windows-store:|uplay:|goggalaxy:)/i.test(url)) shell.openExternal(url); return true; });
  handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  handle('dialog:file', async filters => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [{ name: 'Programs', extensions: ['exe', 'lnk', 'url', 'bat'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('detect:players', () => detectPlayers());
  handle('detect:psplus', () => detectPsPlus());
  // ---- custom tile images (userData/tiles/<key>.<ext>; "<key>.none" = use collage) ----
  const tileDir = () => { const d = path.join(app.getPath('userData'), 'tiles'); fs.mkdirSync(d, { recursive: true }); return d; };
  const tileKey = k => String(k).replace(/^sys:/, '').replace(/[^a-z0-9_-]/gi, '');
  const listTiles = () => {
    const out = {};
    for (const f of fs.readdirSync(tileDir())) {
      const m = f.match(/^(.+)\.(png|jpe?g|webp|gif|none)$/i); if (!m) continue;
      out[m[1]] = m[2].toLowerCase() === 'none' ? 'none' : require('url').pathToFileURL(path.join(tileDir(), f)).href + '?v=' + Math.round(fs.statSync(path.join(tileDir(), f)).mtimeMs);
    }
    return out;
  };
  const clearTile = k => { for (const f of fs.readdirSync(tileDir())) if (f.replace(/\.[^.]+$/, '') === k) fs.rmSync(path.join(tileDir(), f), { force: true }); };
  handle('tiles:list', () => listTiles());
  handle('tiles:bundled', () => { const out = {}; try { for (const f of fs.readdirSync(path.join(__dirname, 'assets', 'tiles'))) { const m = f.match(/^(.+)\.(png|jpe?g|webp)$/i); if (m) out[m[1].toLowerCase()] = '../assets/tiles/' + f; } } catch {} return out; });
  handle('tiles:pick', async key => {
    const k = tileKey(key);
    const r = await dialog.showOpenDialog(win, { title: 'Choose a tile image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return listTiles();
    clearTile(k);
    fs.copyFileSync(r.filePaths[0], path.join(tileDir(), k + path.extname(r.filePaths[0]).toLowerCase()));
    return listTiles();
  });
  handle('tiles:set', (key, mode) => { const k = tileKey(key); clearTile(k); if (mode === 'none') fs.writeFileSync(path.join(tileDir(), k + '.none'), ''); return listTiles(); });
  handle('emu:systems', () => E.SYSTEMS.map(({ id, name, full, cores, standalone, preferStandalone, color, exts }) => ({ id, name, full, cores, standalone, preferStandalone, color, exts })));
  handle('emu:detect', emu => emu ? E.findEmulators(emu) : (ra => ({ retroarch: ra, cores: E.listCores(ra), systems: {} }))(E.detectRetroArch()));
  handle('emu:cores', p => E.listCores(p));
  handle('emu:autoassign', root => E.autoAssign(root));
  handle('keys:test', async (kind, key) => {
    const cfg = store.getConfig();
    if (kind === 'tmdb') { await new Tmdb(key, cfg.region).test(); return { ok: true, msg: 'TMDB key works' }; }
    if (kind === 'omdb') { const r = await new Omdb(key).find('Inception', 2010, 'movies'); return r ? { ok: true, msg: 'OMDb key works' } : { ok: false, error: 'No result' }; }
    if (kind === 'torbox') { const r = await new TorBox(key).test(); return { ok: true, msg: r.email ? `Connected as ${r.email}` : 'TorBox key works' }; }
    if (kind === 'imvdb') { const { Imvdb } = require('./lib/scrapers'); const r = await new Imvdb(key).req('/search/videos?q=daft+punk+around+the+world&per_page=1'); return r && r.results ? { ok: true, msg: 'IMVDb key works' } : { ok: false, error: 'Unexpected response' }; }
    if (kind === 'steamgriddb') { await new SteamGrid(key).req('/search/autocomplete/portal'); return { ok: true, msg: 'SteamGridDB key works' }; }
    return { ok: false, error: 'Unknown key' };
  });

  log('ipc registered');
  // ---------- auto-update (installed copies only; portable copies just get told) ----------
  // NSIS names the uninstaller after the product file name ("Uninstall ArgusLauncher.exe" today), so accept any
  // "Uninstall *.exe" next to the exe rather than one exact name. Portable folders have no uninstaller.
  let installedCache = null;
  const isInstalled = () => {
    if (installedCache !== null) return installedCache;
    if (!app.isPackaged) return (installedCache = false);
    const dir = path.dirname(process.execPath);
    let names = [];
    try { names = fs.readdirSync(dir); } catch {}
    installedCache = names.some(n => /^uninstall .*\.exe$/i.test(n));
    return installedCache;
  };
  let upd = { state: 'idle', version: null, percent: 0, error: null };
  let updater = null;
  const pushUpd = patch => { upd = { ...upd, ...patch }; send('update:status', { ...upd, current: app.getVersion(), installed: isInstalled() }); };
  if (isInstalled()) {
    try {
      updater = require('electron-updater').autoUpdater;
      updater.logger = { info: m => log('update:', m), warn: m => log('update warn:', m), error: m => log('update error:', m), debug: () => {} };
      updater.autoDownload = store.getConfig().updates.auto !== false;
      updater.autoInstallOnAppQuit = true;
      updater.on('checking-for-update', () => pushUpd({ state: 'checking', error: null }));
      updater.on('update-available', i => pushUpd({ state: updater.autoDownload ? 'downloading' : 'available', version: i.version }));
      updater.on('update-not-available', () => pushUpd({ state: 'current' }));
      updater.on('download-progress', p => pushUpd({ state: 'downloading', percent: Math.round(p.percent) }));
      updater.on('update-downloaded', i => pushUpd({ state: 'ready', version: i.version, percent: 100 }));
      updater.on('error', e => pushUpd({ state: 'error', error: String(e && e.message || e).split('\n')[0] }));
      const check = () => updater.checkForUpdates().catch(e => pushUpd({ state: 'error', error: String(e.message || e).split('\n')[0] }));
      setTimeout(check, 8000);
      setInterval(check, 6 * 3600e3);
    } catch (e) { log('updater init failed', e); }
  }
  handle('update:info', () => ({ ...upd, current: app.getVersion(), installed: isInstalled() }));
  handle('update:check', async () => { if (!updater) return { ok: false, error: 'Updates work in the installed version only.' }; updater.autoDownload = store.getConfig().updates.auto !== false; await updater.checkForUpdates(); return { ok: true }; });
  handle('update:download', async () => { if (updater) await updater.downloadUpdate(); return { ok: true }; });
  handle('update:install', () => { if (updater && upd.state === 'ready') setImmediate(() => updater.quitAndInstall(false, true)); return { ok: true }; });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  log('window created');
}).catch(e => fatal('startup', e));

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
