// Builds the unified library: local scans + TorBox + game platforms, then enriches with scrapers.
const path = require('path');
const P = require('./parse');
const S = require('./scanner');
const G = require('./games');
const E = require('./emulation');
const { Tmdb, Omdb, SteamGrid, Imvdb, openLibrary, musicBrainz } = require('./scrapers');
const { TorBox, classify } = require('./torbox');

const DAY = 864e5;

class Library {
  constructor(store, emit = () => {}) {
    this.store = store;
    this.emit = emit;
    this.data = { updated: 0, movies: [], tv: [], music: [], musicvideos: [], books: [], audiobooks: [], games: [], ...store.read('library', {}) };
    this.meta = store.read('metacache', {});
    this.busy = false;
  }

  clients(cfg) {
    return {
      tmdb: new Tmdb(cfg.keys.tmdb, cfg.region, cfg.language),
      omdb: new Omdb(cfg.keys.omdb),
      sgdb: new SteamGrid(cfg.keys.steamgriddb),
      imvdb: new Imvdb(cfg.keys.imvdb),
      torbox: new TorBox(cfg.keys.torbox),
    };
  }

  progress(cat, msg, done, total) { this.emit({ cat, msg, done, total }); }

  async cached(key, ttl, fn) {
    const hit = this.meta[key];
    if (hit && Date.now() - hit.t < (hit.miss ? 3 * DAY : ttl)) return hit.v || null;
    try {
      const v = await fn();
      this.meta[key] = v ? { t: Date.now(), v } : { t: Date.now(), miss: true };
      return v;
    } catch (e) {
      return hit ? hit.v || null : null; // network error: keep stale data, don't cache the miss
    }
  }

  async rescan(only) {
    if (this.busy) return this.data;
    this.busy = true;
    try {
      const cfg = this.store.getConfig();
      const c = this.clients(cfg);
      const cats = cfg.categories;
      const want = cat => cats[cat] && cats[cat].enabled && (!only || only.includes(cat));

      // TorBox (fetched once, then routed to categories that opted in)
      let tb = [];
      const tbCats = Object.keys(cats).filter(k => cats[k].torbox && want(k));
      if (c.torbox.ok && tbCats.length) {
        this.progress('torbox', 'Reading TorBox library…');
        try { tb = await c.torbox.listAll(); } catch (e) { this.progress('torbox', 'TorBox error: ' + e.message); }
      }
      const tbFor = cat => {
        if (!cats[cat].torbox) return [];
        const out = [];
        for (const item of tb) {
          const ov = cfg.torboxOverrides[`${item.kind}:${item.id}`];
          const r = classify(item, ov);
          if (r.category === cat) out.push({ item, files: r.files });
        }
        return out;
      };
      const tbFile = (item, f) => ({ source: 'torbox', name: f.name, size: f.size, path: f.path, tb: { kind: item.kind, itemId: item.id, fileId: f.id, key: `${item.kind}:${item.id}` } });

      if (want('movies')) this.data.movies = await this.buildMovies(cats.movies, tbFor('movies'), tbFile, c);
      if (want('tv')) this.data.tv = await this.buildTv(cats.tv, tbFor('tv'), tbFile, c);
      if (want('music')) this.data.music = await this.buildMusic(cats.music, tbFor('music'), tbFile);
      if (want('musicvideos')) this.data.musicvideos = await this.buildMusicVideos(cats.musicvideos, tbFor('musicvideos'), tbFile, c);
      if (want('books')) this.data.books = await this.buildBooks(cats.books, tbFor('books'), tbFile);
      if (want('audiobooks')) this.data.audiobooks = await this.buildAudiobooks(cats.audiobooks, tbFor('audiobooks'), tbFile);
      if (want('games')) this.data.games = await this.buildGames(cats.games, tbFor('games'), c, cfg);
      for (const k of Object.keys(cats)) if (!cats[k].enabled) this.data[k] = [];

      this.data.updated = Date.now();
      this.data.torboxCount = tb.length;
      this.store.write('library', this.data);
      this.store.write('metacache', this.meta);
      this.progress('done', 'Library updated');
      return this.data;
    } finally { this.busy = false; }
  }

  // ---------- Movies ----------
  async buildMovies(cfg, tbItems, tbFile, c) {
    this.progress('movies', 'Scanning movie folders…');
    const list = S.scanMovies(cfg.folders);
    const byKey = new Map(list.map(m => [P.normTitle(m.title) + '|' + (m.year || ''), m]));
    for (const { item, files } of tbItems) {
      const fromName = P.parseMovie(item.name);
      const big = files.slice().sort((a, b) => b.size - a.size)[0];
      const fromFile = P.parseMovie(big.name);
      const parsed = fromName.year ? fromName : fromFile.year ? fromFile : fromName;
      const key = P.normTitle(parsed.title) + '|' + (parsed.year || '');
      let m = byKey.get(key);
      if (!m) { m = { id: P.hashId('mov', key), cat: 'movies', title: parsed.title, year: parsed.year, parsed, files: [], added: Date.parse(item.created) || 0 }; byKey.set(key, m); }
      m.files.push(tbFile(item, big));
    }
    const all = [...byKey.values()];
    await this.scrapeVideo('movies', all, cfg.scraper, c);
    return all;
  }

  // ---------- TV ----------
  async buildTv(cfg, tbItems, tbFile, c) {
    this.progress('tv', 'Scanning TV folders…');
    const shows = S.scanTv(cfg.folders);
    for (const { item, files } of tbItems) {
      for (const f of files) {
        const ep = P.parseEpisode(f.path || f.name);
        if (!ep) continue;
        if (!ep.show) ep.show = P.parseMovie(item.name).title.replace(/\s*(s\d+|season\s*\d+).*$/i, '');
        S.addEpisode(shows, ep, { ...tbFile(item, f), mtime: Date.parse(item.created) || 0 });
      }
    }
    const all = [...shows.values()];
    for (const s of all) s.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode || (a.source === 'local' ? -1 : 1));
    await this.scrapeVideo('tv', all, cfg.scraper, c);
    return all;
  }

  async scrapeVideo(cat, items, scraper, c) {
    const useTmdb = scraper === 'tmdb' && c.tmdb.ok;
    const useOmdb = (scraper === 'omdb' && c.omdb.ok) || (scraper === 'tmdb' && !c.tmdb.ok && c.omdb.ok);
    if (!useTmdb && !useOmdb) { for (const it of items) this.applyMeta(it, null); return; }
    let done = 0;
    await Promise.all(items.map(async it => {
      const { title, year } = it.parsed;
      const src = useTmdb ? 'tmdb' : 'omdb';
      const key = `${cat}|${src}|${P.normTitle(title)}|${year || ''}`;
      const meta = await this.cached(key, 14 * DAY, () => useTmdb
        ? (cat === 'movies' ? c.tmdb.findMovie(title, year) : c.tmdb.findTv(title, year))
        : c.omdb.find(title, year, cat));
      this.applyMeta(it, meta);
      this.progress(cat, `Fetching metadata (${src.toUpperCase()})`, ++done, items.length);
    }));
  }

  applyMeta(it, meta) {
    it.meta = meta || null;
    if (meta) {
      it.title = meta.title || it.title;
      it.year = meta.year || it.year;
      it.poster = meta.poster || it.localArt || null;
      it.backdrop = meta.backdrop || null;
      it.overview = meta.overview || it.overview || '';
      it.rating = meta.rating || null;
      it.genres = meta.genres || [];
    } else {
      it.poster = it.localArt || null;
    }
    const files = it.files || it.episodes || [];
    it.sources = [...new Set(files.map(f => f.source))];
  }

  // ---------- Music videos ----------
  async buildMusicVideos(cfg, tbItems, tbFile, c) {
    this.progress('musicvideos', 'Scanning music videos…');
    const list = S.scanMusicVideos(cfg.folders);
    for (const { item, files } of tbItems) {
      for (const f of files) {
        const mv = P.parseMusicVideo(f.name);
        if (mv.artist === 'Unknown Artist') mv.artist = P.parseMusicVideo(item.name + '.mkv').artist;
        list.push({ id: P.hashId('mv', `${item.kind}:${item.id}:${f.id}`), cat: 'musicvideos', title: mv.title, artist: mv.artist, files: [tbFile(item, f)], added: Date.parse(item.created) || 0 });
      }
    }
    for (const it of list) { it.poster = it.localArt || null; it.sources = [...new Set(it.files.map(f => f.source))]; }
    if (cfg.scraper === 'imvdb' && c && c.imvdb.ok) {
      let done = 0;
      await Promise.all(list.map(async it => {
        const meta = await this.cached(`mv|imvdb|${P.normTitle(it.artist)}|${P.normTitle(it.title)}`, 30 * DAY, () => c.imvdb.find(it.artist, it.title));
        this.progress('musicvideos', 'Fetching info (IMVDb)', ++done, list.length);
        if (!meta) return;
        it.meta = meta;
        it.title = meta.title || it.title; it.artist = meta.artist || it.artist; it.year = meta.year || it.year;
        it.poster = it.localArt || meta.poster; it.backdrop = meta.backdrop;
        it.overview = [meta.directors.length ? 'Directed by ' + meta.directors.join(', ') + '.' : '', meta.featured.length ? 'Featuring ' + meta.featured.join(', ') + '.' : '', meta.version ? meta.version + '.' : ''].filter(Boolean).join(' ');
      }));
    }
    return list;
  }

  // ---------- Music ----------
  async buildMusic(cfg, tbItems, tbFile) {
    this.progress('music', 'Scanning music…');
    const list = S.scanMusic(cfg.folders, this.store.cacheDir);
    for (const { item, files } of tbItems) {
      const folder = S.parseAlbumFolder(P.cutJunk(P.tidy(item.name)) || item.name);
      const tracks = files.slice().sort((a, b) => P.naturalCompare(a.path || a.name, b.path || b.name)).map(f => ({ ...tbFile(item, f), ...S.trackFromName(f.name) }));
      list.push({ id: P.hashId('mu', `${item.kind}:${item.id}`), cat: 'music', title: folder.album, artist: folder.artist || 'Unknown Artist', year: folder.year, genres: [], files: tracks, added: Date.parse(item.created) || 0 });
    }
    const need = list.filter(a => !a.localArt && cfg.scraper === 'musicbrainz' && a.title !== 'Loose tracks');
    let done = 0;
    for (const a of list) { a.poster = a.localArt || null; a.sources = [...new Set(a.files.map(f => f.source))]; }
    // MusicBrainz is rate-limited to ~1/s, so look up art in the background order: newest albums first
    need.sort((a, b) => b.added - a.added);
    await Promise.all(need.map(async a => {
      const meta = await this.cached(`music|mb|${P.normTitle(a.title)}|${P.normTitle(a.artist)}`, 60 * DAY, () => musicBrainz(a.title, a.artist));
      this.progress('music', 'Fetching album art (MusicBrainz)', ++done, need.length);
      if (!meta) return;
      a.meta = meta; a.poster = meta.poster;
      if (!a.year) a.year = meta.year;
      if (!a.genres.length) a.genres = meta.genres;
    }));
    return list;
  }

  // ---------- Books ----------
  async buildBooks(cfg, tbItems, tbFile) {
    this.progress('books', 'Scanning books…');
    const list = S.scanBooks(cfg.folders, this.store.cacheDir);
    for (const { item, files } of tbItems) {
      for (const f of files) {
        const b = P.parseBook(f.name);
        list.push({ id: P.hashId('bk', `${item.kind}:${item.id}:${f.id}`), cat: 'books', title: b.title, author: b.author, format: path.extname(f.name).slice(1).toUpperCase(), files: [tbFile(item, f)], added: Date.parse(item.created) || 0 });
      }
    }
    await this.scrapeBooks('books', list, cfg.scraper === 'openlibrary');
    return list;
  }

  async buildAudiobooks(cfg, tbItems, tbFile) {
    this.progress('audiobooks', 'Scanning audiobooks…');
    const list = S.scanAudiobooks(cfg.folders);
    for (const { item, files } of tbItems) {
      const b = P.parseBook(P.cutJunk(P.tidy(item.name)));
      const tracks = files.slice().sort((a, x) => P.naturalCompare(a.path || a.name, x.path || x.name));
      list.push({ id: P.hashId('ab', `${item.kind}:${item.id}`), cat: 'audiobooks', title: b.title, author: b.author, files: tracks.map(f => tbFile(item, f)), added: Date.parse(item.created) || 0 });
    }
    await this.scrapeBooks('audiobooks', list, cfg.scraper === 'openlibrary');
    return list;
  }

  async scrapeBooks(cat, list, enabled) {
    let done = 0;
    await Promise.all(list.map(async b => {
      let meta = null;
      if (enabled && (!b.localArt || !b.author)) {
        meta = await this.cached(`${cat}|ol|${P.normTitle(b.title)}|${P.normTitle(b.author)}`, 60 * DAY, () => openLibrary(b.title, b.author));
        this.progress(cat, 'Fetching covers (Open Library)', ++done, list.length);
      }
      b.meta = meta;
      b.poster = b.localArt || (meta && meta.poster) || null;
      if (!b.author && meta) b.author = meta.author;
      if (meta && meta.year) b.year = meta.year;
      b.genres = meta ? meta.genres : [];
      b.sources = [...new Set(b.files.map(f => f.source))];
    }));
  }

  // ---------- Games ----------
  async buildGames(cfg, tbItems, c, full) {
    const out = [];
    const sc = cfg.scanners;
    this.progress('games', 'Scanning installed games…');
    const jobs = [
      sc.steam && G.scanSteam(), sc.epic && G.scanEpic(), sc.gog && G.scanGog(),
      sc.ubisoft && G.scanUbisoft(), sc.xbox && G.scanXbox(),
    ].filter(Boolean);
    for (const r of await Promise.allSettled(jobs)) if (r.status === 'fulfilled') out.push(...r.value);
    out.push(...G.scanGameFolders(cfg.folders));
    if (cfg.emulation && cfg.emulation.enabled) {
      this.progress('games', 'Scanning ROM folders…');
      for (const g of E.scanEmulation(cfg.emulation)) { g.hasArt = true; out.push(g); }
    }
    for (const g of cfg.manual || []) {
      out.push({ id: P.hashId('man', g.title + g.target), title: g.title, source: 'manual', sourceLabel: 'PC', launch: { type: g.target.includes('://') ? 'uri' : 'open', target: g.target }, poster: g.poster || null });
    }
    for (const g of out) g.installed = true;

    // Game Pass catalog (cached 12h)
    if (cfg.gamepass.enabled) {
      this.progress('games', 'Loading Xbox Game Pass catalog…');
      const which = cfg.gamepass.catalogs;
      const key = `gamepass|${full.region}|${which.pc ? 'pc' : ''}${which.cloud ? 'cloud' : ''}`;
      const cat = await this.cached(key, DAY / 2, () => G.gamePassCatalog(which, full.region, (full.language || 'en-US').toLowerCase()));
      const installedByStore = new Map(out.filter(g => g.storeId).map(g => [g.storeId.toUpperCase(), g]));
      const installedByName = new Map(out.map(g => [P.normTitle(g.title), g]));
      for (const gp of cat || []) {
        const inst = installedByStore.get(gp.storeId.toUpperCase()) || (installedByName.get(P.normTitle(gp.title)) || {}).source === 'xbox' && installedByName.get(P.normTitle(gp.title));
        if (inst) {
          Object.assign(inst, { title: gp.title, poster: gp.poster || inst.poster, backdrop: gp.backdrop, overview: gp.overview, publisher: gp.publisher, gamepass: gp.gamepass, cloudUrl: gp.cloudUrl, posterIsLogo: !gp.poster && inst.posterIsLogo, hasArt: !!gp.poster });
        } else {
          out.push({ ...gp, installed: false, hasArt: !!gp.poster });
        }
      }
    }

    // PlayStation Plus titles (launch the PS Plus PC app — Sony offers no per-game deep links)
    if (cfg.psplus.enabled) {
      for (const t of cfg.psplus.titles || []) {
        out.push({ id: P.hashId('ps', t.title), title: t.title, source: 'psplus', sourceLabel: 'PS Plus', installed: false, poster: t.poster || null,
          launch: cfg.psplus.appPath ? { type: 'exe', target: cfg.psplus.appPath, cwd: path.dirname(cfg.psplus.appPath) } : { type: 'uri', target: 'https://www.playstation.com/ps-plus/getting-started/#pc' } });
      }
    }

    // TorBox game downloads
    for (const { item } of tbItems) {
      out.push({ id: P.hashId('tbg', `${item.kind}:${item.id}`), title: P.cutJunk(P.tidy(item.name)).replace(/[-\s]+(fitgirl|dodi|elamigos|repack|gog).*$/i, ''), source: 'torbox', sourceLabel: 'TorBox', installed: false,
        launch: { type: 'torbox-zip', tb: { kind: item.kind, itemId: item.id } }, size: item.files.reduce((s, f) => s + f.size, 0) });
    }

    // De-dupe identical ids, then fetch artwork for anything without good art
    const uniq = [...new Map(out.map(g => [g.id, g])).values()];
    if (cfg.artwork === 'steamgriddb' && c.sgdb.ok) {
      const need = uniq.filter(g => !g.hasArt && !(g.poster && !g.posterIsLogo));
      let done = 0;
      await Promise.all(need.map(async g => {
        const art = await this.cached(`games|sgdb|${P.normTitle(g.title)}`, 30 * DAY, () => c.sgdb.art(g.title));
        if (art && art.poster) { g.poster = art.poster; g.posterIsLogo = false; }
        if (art && art.backdrop && !g.backdrop) g.backdrop = art.backdrop;
        this.progress('games', 'Fetching artwork (SteamGridDB)', ++done, need.length);
      }));
    }
    for (const g of uniq) { g.cat = 'games'; g.sources = [g.source]; }
    return uniq;
  }

  async season(tvId, n) {
    const cfg = this.store.getConfig();
    const { tmdb } = this.clients(cfg);
    if (!tmdb.ok) return [];
    const v = await this.cached(`season|${tvId}|${n}`, 7 * DAY, () => tmdb.season(tvId, n));
    this.store.write('metacache', this.meta);
    return v || [];
  }
}

module.exports = { Library };
