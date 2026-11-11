// Builds test/mock-api.js from the scanned fixture so renderer/index.html can be previewed in a plain browser.
const fs = require('fs');
const path = require('path');
const services = require('../lib/services');
const E = require('../lib/emulation');
const lib = require('./fixture-library.json');
const cfg = require('./fixture-config.json');

const hues = [18, 205, 330, 150, 265, 85, 0, 45, 190];
const art = (title, i, w = 300, h = 450) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hues[i % 9]},55%,38%)"/><stop offset="1" stop-color="hsl(${(hues[i % 9] + 40) % 360},45%,12%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.3}" r="${w * 0.35}" fill="rgba(255,255,255,.07)"/><text x="20" y="${h - 30}" fill="#fff" font-family="Segoe UI,Arial" font-size="${w / 11}" font-weight="700">${title.replace(/&/g, '&amp;').slice(0, 20)}</text></svg>`);

let i = 0;
const nf = { id: 8, name: 'Netflix', logo: null }, hbo = { id: 1899, name: 'HBO Max', logo: null }, atv = { id: 350, name: 'Apple TV Plus', logo: null };
const metaFor = {
  Heat: { genres: ['Crime', 'Thriller'], rating: 7.9, runtime: 170, overview: 'Obsessive master thief Neil McCauley leads a top-notch crew on various daring heists throughout Los Angeles while a mentally unstable detective obsessively tries to capture them.', watch: { stream: [hbo], rent: [] }, cast: ['Al Pacino', 'Robert De Niro', 'Val Kilmer'] },
  'The Matrix': { genres: ['Action', 'Science Fiction'], rating: 8.2, runtime: 136, overview: 'Set in the 22nd century, The Matrix tells the story of a computer hacker who joins a group of underground insurgents fighting the vast and powerful computers who now rule the earth.', watch: { stream: [nf], rent: [] } },
  'Blade Runner 2049': { genres: ['Science Fiction', 'Drama'], rating: 7.6, runtime: 164, overview: 'Thirty years after the events of the first film, a new blade runner, LAPD Officer K, unearths a long-buried secret.', watch: { stream: [], rent: [] } },
  Severance: { genres: ['Drama', 'Mystery'], rating: 8.4, overview: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.', watch: { stream: [atv], rent: [] }, seasons: [{ n: 1 }, { n: 2 }] },
  Firefly: { genres: ['Western', 'Sci-Fi'], rating: 8.3, overview: 'Five hundred years in the future, a renegade crew aboard a small spacecraft tries to survive as they travel the unknown parts of the galaxy.', watch: { stream: [], rent: [] }, seasons: [{ n: 1 }] },
};
for (const cat of ['movies', 'tv', 'music', 'musicvideos', 'books', 'audiobooks', 'games']) {
  for (const it of lib[cat]) {
    const m = metaFor[it.title];
    if (m) { Object.assign(it, { genres: m.genres, rating: m.rating, overview: m.overview }); it.meta = { ...m, watch: { link: 'https://www.themoviedb.org', ...m.watch } }; it.backdrop = art(it.title, i + 3, 1280, 720); }
    if (it.source === 'emulator') { it.poster = art(it.title, i); it.posterFallback = null; }
    if (!it.poster || it.poster.startsWith('file:')) it.poster = cat === 'musicvideos' ? art(it.title, i, 480, 270) : (cat === 'audiobooks' || cat === 'music') ? art(it.title, i, 400, 400) : art(it.title, i);
    i++;
  }
}
// TorBox extras
lib.movies.push({ id: 'mov:tb1', cat: 'movies', title: 'Dune: Part Two', year: 2024, sources: ['torbox'], genres: ['Science Fiction'], rating: 8.1, poster: art('Dune: Part Two', 4), backdrop: art('Dune', 5, 1280, 720), overview: 'Paul Atreides unites with the Fremen while on a path of revenge against the conspirators who destroyed his family.', added: Date.now(), meta: { watch: { stream: [hbo], rent: [] } }, files: [{ source: 'torbox', name: 'Dune.Part.Two.2024.2160p.WEB-DL.mkv', size: 2.1e10, tb: { kind: 'torrent', itemId: 1, fileId: 0, key: 'torrent:1' } }] });
lib.tv[0].episodes.push({ season: 1, episode: 2, title: 'The Train Job', source: 'torbox', name: 'Firefly.S01E02.mkv', size: 7e8, tb: { kind: 'torrent', itemId: 2, fileId: 1, key: 'torrent:2' } });
lib.tv[0].sources = ['local', 'torbox'];
// Games: Game Pass, PS Plus, Steam
const g = (o, k) => lib.games.push({ cat: 'games', installed: false, sources: [o.source], poster: art(o.title, k), ...o });
g({ id: 'steam:620', title: 'Portal 2', source: 'steam', sourceLabel: 'Steam', installed: true, launch: { type: 'uri', target: 'steam://rungameid/620' } }, 1);
g({ id: 'gp:1', title: 'Starfield', source: 'gamepass', sourceLabel: 'Game Pass', gamepass: { pc: true, cloud: true }, cloudUrl: 'https://www.xbox.com/play', storeId: '9NCJSXWZTP88', overview: 'Starfield is the first new universe in 25 years from Bethesda Game Studios.' }, 2);
g({ id: 'gp:2', title: 'Forza Horizon 5', source: 'xbox', sourceLabel: 'Xbox app', installed: true, gamepass: { pc: true, cloud: true }, cloudUrl: 'https://www.xbox.com/play' }, 3);
g({ id: 'gp:3', title: 'Hades II', source: 'gamepass', sourceLabel: 'Game Pass', gamepass: { pc: true, cloud: false } }, 6);
g({ id: 'ps:1', title: 'Ghost of Tsushima', source: 'psplus', sourceLabel: 'PS Plus', poster: null }, 7);
g({ id: 'tbg:1', title: 'Cyberpunk 2077', source: 'torbox', sourceLabel: 'TorBox', size: 6.5e10 }, 8);
for (const [sys, name] of [['nes','NES'],['n64','N64'],['genesis','Genesis'],['gba','GBA'],['nds','DS'],['ps2','PS2']]) g({ id: 'rom:' + sys, title: name + ' Game', source: 'emulator', sourceLabel: name, system: sys, systemName: name, installed: true, genres: [name], emulatorLabel: 'RetroArch' }, 3);
lib.updated = Date.now();

cfg.categories.games.gamepass.enabled = true;
cfg.categories.games.psplus.enabled = true;
cfg.categories.games.psplus.titles = [{ title: 'Ghost of Tsushima' }];
cfg.categories.movies.torbox = true;
cfg.keys.tmdb = 'x'; cfg.keys.torbox = 'x';

const src = `// AUTO-GENERATED preview backend (not used by the app)
(() => {
  const lib = ${JSON.stringify(lib)};
  let cfg = ${JSON.stringify(cfg)};
  const state = { played: { [lib.movies[0].id]: Date.now() - 5000, [lib.audiobooks[0].id]: Date.now() }, progress: { [lib.audiobooks[0].id]: { track: 1, pos: 412, pct: 0.6 } } };
  const catalog = ${JSON.stringify({ video: services.VIDEO_SERVICES, music: services.MUSIC_VIDEO_SERVICES, audio: services.MUSIC_SERVICES })};
  const ok = v => Promise.resolve(v);
  window.api = {
    getConfig: () => ok(JSON.parse(JSON.stringify(cfg))), setConfig: c => { cfg = c; return ok(c); }, catalog: () => ok(catalog),
    getLibrary: () => ok(lib), rescan: () => ok(lib), season: (id, n) => ok([1,2,3,4].map(e => ({ n: e, title: 'Episode title ' + e, overview: 'A description of what happens in this episode.' }))),
    getState: () => ok(state), markPlayed: id => { state.played[id] = Date.now(); return ok(state); }, saveProgress: () => ok(true),
    torboxLink: () => ok('about:blank'), torboxOverride: () => ok(lib), play: r => { console.log('play', JSON.stringify(r)); return ok({ ok: true }); },
    openExternal: u => { console.log('open', u); return ok(true); }, pickFolders: () => ok(['D:\\\\Media\\\\New']), pickFile: () => ok('C:\\\\x.exe'),
    setFullScreen: () => ok(true), setZoom: f => { document.body.style.zoom = f; }, updateInfo: () => ok({ state: 'ready', version: '1.2.0', current: '1.1.0', installed: true, percent: 100 }), updateCheck: () => ok({ ok: true }), updateInstall: () => ok({}), updateDownload: () => ok({}), onUpdate: () => {}, tilesList: () => ok({}), tilesBundled: () => ok({'nes': '../assets/tiles/nes.jpg', 'ps2': '../assets/tiles/ps2.jpg', 'pc': '../assets/tiles/pc.jpg', 'gamepass': '../assets/tiles/gamepass.jpg', 'nds': '../assets/tiles/nds.jpg', 'n64': '../assets/tiles/n64.jpg', 'psx': '../assets/tiles/psx.jpg', 'snes': '../assets/tiles/snes.jpg', 'cloud': '../assets/tiles/cloud.jpg', 'gc': '../assets/tiles/gc.jpg', 'torbox': '../assets/tiles/torbox.jpg', 'genesis': '../assets/tiles/genesis.jpg', 'gba': '../assets/tiles/gba.jpg', 'psplus': '../assets/tiles/psplus.jpg'}), tilesPick: () => ok({}), tilesSet: () => ok({}), emuSystems: () => ok(${JSON.stringify(E.SYSTEMS)}), emuDetect: () => ok({ retroarch: 'C:\\\\RetroArch-Win64\\\\retroarch.exe', cores: ['snes9x', 'swanstation'] }), emuCores: () => ok(['snes9x', 'swanstation', 'mupen64plus_next']), emuAutoAssign: () => ok([]), detectPlayers: () => ok({ vlc: 'C:\\\\Program Files\\\\VideoLAN\\\\VLC\\\\vlc.exe', mpv: '' }), detectPsPlus: () => ok({ app: null }), testKey: () => ok({ ok: true, msg: 'works' }), onProgress: () => {},
  };
})();
`;
fs.writeFileSync(path.join(__dirname, 'mock-api.js'), src);
console.log('mock written');
