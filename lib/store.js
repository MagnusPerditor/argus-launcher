// JSON persistence in the app's userData folder (atomic writes).
const fs = require('fs');
const path = require('path');

const CATEGORIES = ['movies', 'tv', 'music', 'musicvideos', 'books', 'audiobooks', 'games'];

function defaultConfig() {
  return {
    setupDone: false,
    region: 'US',
    language: 'en-US',
    keys: { tmdb: '', omdb: '', torbox: '', steamgriddb: '', imvdb: '' },
    player: { mode: 'default', vlcPath: '', mpvPath: '' },
    couch: { startInCouch: false, autoOnController: true, scale: 1.25 },
    updates: { auto: true },
    categories: {
      movies: { enabled: true, folders: [], services: [], scraper: 'tmdb', torbox: false },
      tv: { enabled: true, folders: [], services: [], scraper: 'tmdb', torbox: false },
      music: { enabled: true, folders: [], services: [], scraper: 'musicbrainz', torbox: false },
      musicvideos: { enabled: true, folders: [], services: [], scraper: 'imvdb', torbox: false },
      books: { enabled: true, folders: [], scraper: 'openlibrary', torbox: false },
      audiobooks: { enabled: true, folders: [], scraper: 'openlibrary', torbox: false },
      games: {
        enabled: true,
        folders: [],
        torbox: false,
        scanners: { steam: true, epic: true, gog: true, xbox: true, ubisoft: true },
        gamepass: { enabled: false, catalogs: { pc: true, cloud: true }, cloudMode: 'browser' },
        psplus: { enabled: false, appPath: '', titles: [] },
        manual: [],
        emulation: { enabled: false, retroarchPath: '', fullscreen: true, systems: [] },
        artwork: 'steamgriddb',
      },
    },
    torboxOverrides: {}, // torbox file key -> category
  };
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = (k in base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]))
      ? deepMerge(base[k], extra[k]) : extra[k];
  }
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cacheDir = path.join(dir, 'cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }
  file(name) { return path.join(this.dir, name + '.json'); }
  read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch { return fallback; }
  }
  write(name, data) {
    const f = this.file(name);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, f);
  }
  getConfig() { return deepMerge(defaultConfig(), this.read('config', {})); }
  setConfig(cfg) { this.write('config', deepMerge(defaultConfig(), cfg)); return this.getConfig(); }
}

module.exports = { Store, CATEGORIES, defaultConfig, deepMerge };
