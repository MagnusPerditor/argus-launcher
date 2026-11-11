// Launching / playback: local files, TorBox streams, games, protocol URIs, cloud gaming windows.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

function detectPlayers() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const first = arr => arr.find(p => { try { return p && fs.existsSync(p); } catch { return false; } }) || '';
  return {
    vlc: first([path.join(pf, 'VideoLAN', 'VLC', 'vlc.exe'), path.join(pf86, 'VideoLAN', 'VLC', 'vlc.exe')]),
    mpv: first([path.join(pf, 'mpv', 'mpv.exe'), path.join(local, 'Programs', 'mpv', 'mpv.exe'), 'C:\\mpv\\mpv.exe']),
  };
}

function detach(cmd, args = [], cwd) {
  const child = spawn(cmd, args, { cwd: cwd || undefined, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

class Launcher {
  constructor({ shell, BrowserWindow, app, getConfig, torbox, rendererDir }) {
    Object.assign(this, { shell, BrowserWindow, app, getConfig, torbox, rendererDir });
  }

  externalPlayer() {
    const p = this.getConfig().player;
    if (p.mode === 'vlc' && p.vlcPath) return { cmd: p.vlcPath, args: t => ['--fullscreen', t] };
    if (p.mode === 'mpv' && p.mpvPath) return { cmd: p.mpvPath, args: t => ['--fs', '--force-window', t] };
    return null;
  }

  // Video: local path or remote URL
  async playVideo({ target, title, remote }) {
    const ext = this.externalPlayer();
    const mode = this.getConfig().player.mode;
    if (ext) { detach(ext.cmd, ext.args(target)); return { ok: true, via: mode }; }
    if (!remote && mode === 'default') { const err = await this.shell.openPath(target); return err ? { ok: false, error: err } : { ok: true, via: 'default' }; }
    this.openPlayerWindow(remote ? target : require('url').pathToFileURL(target).href, title);
    return { ok: true, via: 'builtin', note: remote ? 'Streaming in the built-in player. Set VLC or mpv in Library Setup for MKV/HEVC/4K.' : null };
  }

  openPlayerWindow(src, title) {
    const win = new this.BrowserWindow({ width: 1280, height: 760, backgroundColor: '#000', title: title || 'Player', autoHideMenuBar: true, webPreferences: { contextIsolation: true } });
    win.loadFile(path.join(this.rendererDir, 'player.html'), { query: { src, title: title || '' } });
  }

  async torboxLink(tb) {
    if (!this.torbox().ok) throw new Error('Add your TorBox API key in Library Setup → General');
    return this.torbox().link(tb.kind, tb.itemId, tb.fileId);
  }

  async downloadAndOpen(url, name) {
    const dir = path.join(this.app.getPath('downloads'), 'Argus Launcher');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name.replace(/[<>:"/\\|?*]+/g, '_'));
    if (!fs.existsSync(dest)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
    }
    const err = await this.shell.openPath(dest);
    return err ? { ok: false, error: err } : { ok: true, path: dest };
  }

  openCloud(url, mode) {
    if (mode !== 'window') return this.shell.openExternal(url);
    const win = new this.BrowserWindow({
      width: 1600, height: 900, backgroundColor: '#000', autoHideMenuBar: true, title: 'Cloud Gaming',
      webPreferences: { partition: 'persist:cloudgaming', contextIsolation: true },
    });
    const ua = win.webContents.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?argus-launcher\/\S+/i, '');
    win.webContents.setUserAgent(ua);
    win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
    win.loadURL(url);
  }

  async launchGame(launch) {
    switch (launch.type) {
      case 'uri': await this.shell.openExternal(launch.target); return { ok: true };
      case 'cloud': this.openCloud(launch.target, launch.mode); return { ok: true };
      case 'exe':
        if (!fs.existsSync(launch.target)) return { ok: false, error: 'Executable not found: ' + launch.target };
        detach(launch.target, launch.args || [], launch.cwd || path.dirname(launch.target)); return { ok: true };
      case 'open': { const err = await this.shell.openPath(launch.target); return err ? { ok: false, error: err } : { ok: true }; }
      case 'aumid':
        if (!IS_WIN) return { ok: false, error: 'Windows only' };
        detach('explorer.exe', ['shell:AppsFolder\\' + launch.target]); return { ok: true };
      case 'torbox-zip': {
        const url = await this.torbox().link(launch.tb.kind, launch.tb.itemId, null);
        await this.shell.openExternal(url); return { ok: true, note: 'Download started in your browser.' };
      }
      case 'romzip': {
        if (!fs.existsSync(launch.target)) return { ok: false, error: 'Emulator not found: ' + launch.target };
        const rom = await this.extractRom(launch.zip, launch.entry, launch.size);
        detach(launch.target, (launch.args || []).map(a => a.split('{{ROM}}').join(rom)), launch.cwd || path.dirname(launch.target));
        return { ok: true };
      }
      case 'missing': return { ok: false, error: launch.error || 'No launcher configured' };
      default: return { ok: false, error: 'Unknown launch type' };
    }
  }

  // Pull one ROM out of a collection zip into a local cache (keeps the 30 most recent)
  async extractRom(zip, entry, size) {
    const { extractEntry } = require('./zipmini');
    const cache = path.join(this.app.getPath('userData'), 'romcache');
    const key = require('crypto').createHash('sha1').update(zip + '#' + entry).digest('hex').slice(0, 16);
    const dest = path.join(cache, key, path.basename(entry));
    let ok = false; try { ok = fs.statSync(dest).size === size; } catch {}
    if (!ok) await extractEntry(zip, entry, dest);
    try { const now = new Date(); fs.utimesSync(path.dirname(dest), now, now); } catch {}
    try {
      const dirs = fs.readdirSync(cache).map(d => ({ d, t: fs.statSync(path.join(cache, d)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const { d } of dirs.slice(30)) fs.rmSync(path.join(cache, d), { recursive: true, force: true });
    } catch {}
    return dest;
  }

  // Generic entry point from the UI
  async play(req) {
    const { action } = req;
    if (action === 'video') {
      if (req.file.source === 'torbox') return this.playVideo({ target: await this.torboxLink(req.file.tb), title: req.title, remote: true });
      return this.playVideo({ target: req.file.path, title: req.title, remote: false });
    }
    if (action === 'book') {
      if (req.file.source === 'torbox') return this.downloadAndOpen(await this.torboxLink(req.file.tb), req.file.name);
      const err = await this.shell.openPath(req.file.path);
      return err ? { ok: false, error: err } : { ok: true };
    }
    if (action === 'folder') { this.shell.showItemInFolder(req.path); return { ok: true }; }
    if (action === 'game') return this.launchGame(req.launch);
    if (action === 'url') { if (req.mode === 'window') this.openCloud(req.url, 'window'); else await this.shell.openExternal(req.url); return { ok: true }; }
    return { ok: false, error: 'Unknown action' };
  }
}

module.exports = { Launcher, detectPlayers };
