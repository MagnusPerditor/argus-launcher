// Local folder scanners for movies, TV, music videos, books and audiobooks.
const fs = require('fs');
const path = require('path');
const P = require('./parse');
const { readEpub, readCbzCover } = require('./zipmini');
const { readTags } = require('./tags');

const SKIP_DIR = /^(\$recycle\.bin|system volume information|@eadir|\.trash.*|extras?|featurettes|behind the scenes|deleted scenes|trailers?|interviews|shorts|samples?)$/i;

function walk(root, onFile, depth = 12) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) { if (depth > 0 && !SKIP_DIR.test(e.name)) walk(p, onFile, depth - 1); }
    else if (e.isFile()) onFile(p, e.name);
  }
}
function stat(p) { try { return fs.statSync(p); } catch { return null; } }

function sidecarImage(file, names = []) {
  const dir = path.dirname(file);
  const base = P.stripExt(path.basename(file));
  const cands = [];
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    cands.push(base + ext, base + '-poster' + ext);
    for (const n of names) cands.push(n + ext);
  }
  for (const c of cands) { const p = path.join(dir, c); if (fs.existsSync(p)) return toFileUrl(p); }
  return null;
}
function toFileUrl(p) { return require('url').pathToFileURL(p).href; }

// ---------- Movies ----------
function scanMovies(folders) {
  const byKey = new Map();
  for (const root of folders) {
    walk(root, (p, name) => {
      if (!P.isType(name, 'video')) return;
      const st = stat(p); if (!st) return;
      if (/\bsample\b/i.test(name) && st.size < 400e6) return;
      if (st.size < 40e6) return; // tiny clips, trailers
      let { title, year } = P.parseMovie(name);
      const parent = path.basename(path.dirname(p));
      if (path.dirname(p) !== root) {
        const fp = P.parseMovie(parent);
        if (fp.year && (!year || /^(cd|disc|part)\s*\d/i.test(title))) ({ title, year } = fp);
      }
      title = title.replace(/\s*(cd|disc|part|pt)\s*\d+$/i, '').trim();
      const key = P.normTitle(title) + '|' + (year || '');
      const item = byKey.get(key) || {
        id: P.hashId('mov', key), cat: 'movies', title, year, parsed: { title, year }, files: [],
        added: st.mtimeMs, localArt: sidecarImage(p, ['poster', 'folder', 'cover']),
      };
      item.files.push({ source: 'local', path: p, size: st.size, name });
      item.added = Math.max(item.added, st.mtimeMs);
      byKey.set(key, item);
    });
  }
  for (const it of byKey.values()) it.files.sort((a, b) => P.naturalCompare(a.name, b.name));
  return [...byKey.values()];
}

// ---------- TV ----------
function addEpisode(shows, ep, file) {
  const key = P.normTitle(ep.show);
  if (!key) return;
  const show = shows.get(key) || { id: P.hashId('tv', key), cat: 'tv', title: ep.show, year: ep.showYear, parsed: { title: ep.show, year: ep.showYear }, episodes: [], added: 0 };
  if (!show.year && ep.showYear) show.year = show.parsed.year = ep.showYear;
  show.episodes.push({ season: ep.season, episode: ep.episode, episodeEnd: ep.episodeEnd, title: ep.epTitle, ...file });
  show.added = Math.max(show.added, file.mtime || 0);
  shows.set(key, show);
}

function scanTv(folders, shows = new Map()) {
  for (const root of folders) {
    walk(root, (p, name) => {
      if (!P.isType(name, 'video')) return;
      if (/\bsample\b/i.test(name)) return;
      const ep = P.parseEpisode(p);
      if (!ep) return;
      const st = stat(p);
      addEpisode(shows, ep, { source: 'local', path: p, size: st ? st.size : 0, name, mtime: st ? st.mtimeMs : 0 });
    });
  }
  return shows;
}

// ---------- Music videos ----------
function scanMusicVideos(folders) {
  const out = [];
  for (const root of folders) {
    walk(root, (p, name) => {
      if (!P.isType(name, 'video')) return;
      const st = stat(p);
      const mv = P.parseMusicVideo(p);
      out.push({
        id: P.hashId('mv', p), cat: 'musicvideos', title: mv.title, artist: mv.artist,
        files: [{ source: 'local', path: p, size: st ? st.size : 0, name }],
        added: st ? st.mtimeMs : 0, localArt: sidecarImage(p, []),
      });
    });
  }
  return out;
}

// ---------- Books ----------
function scanBooks(folders, cacheDir) {
  const out = [];
  for (const root of folders) {
    walk(root, (p, name) => {
      if (!P.isType(name, 'book')) return;
      const st = stat(p);
      const ext = path.extname(name).toLowerCase();
      let { title, author } = P.parseBook(name);
      // Calibre layout: Author/Title (123)/file.epub
      const parent = path.basename(path.dirname(p));
      if (/\(\d+\)$/.test(parent)) {
        title = parent.replace(/\s*\(\d+\)$/, '');
        author = author || path.basename(path.dirname(path.dirname(p)));
      }
      const id = P.hashId('bk', p);
      let cover = sidecarImage(p, ['cover', 'folder']);
      let description = null;
      try {
        if (ext === '.epub') {
          const m = readEpub(p);
          if (m.title) title = m.title;
          if (m.author) author = m.author;
          description = m.description ? m.description.replace(/<[^>]+>/g, '').trim() : null;
          if (!cover && m.cover) cover = writeCover(cacheDir, id, m.cover);
        } else if (ext === '.cbz' && !cover) {
          const c = readCbzCover(p);
          if (c) cover = writeCover(cacheDir, id, c);
        }
      } catch { /* unreadable archive: keep filename metadata */ }
      out.push({
        id, cat: 'books', title, author, format: ext.slice(1).toUpperCase(), overview: description,
        files: [{ source: 'local', path: p, size: st ? st.size : 0, name }],
        added: st ? st.mtimeMs : 0, localArt: cover,
      });
    });
  }
  return out;
}
function writeCover(cacheDir, id, c) {
  const f = path.join(cacheDir, id.replace(':', '_') + '.' + (c.ext === 'jpeg' ? 'jpg' : c.ext));
  try { if (!fs.existsSync(f)) fs.writeFileSync(f, c.data); return toFileUrl(f); } catch { return null; }
}

// ---------- Audiobooks ----------
function scanAudiobooks(folders) {
  const dirs = new Map(); // dir -> [files]
  for (const root of folders) {
    walk(root, (p, name) => {
      if (!P.isType(name, 'audio')) return;
      const d = path.dirname(p);
      if (!dirs.has(d)) dirs.set(d, { root, files: [] });
      dirs.get(d).files.push(p);
    });
  }
  const out = [];
  const coverOf = dir => {
    for (const n of ['cover', 'folder', 'front', 'Cover', 'Folder']) for (const ext of ['.jpg', '.jpeg', '.png']) {
      const f = path.join(dir, n + ext); if (fs.existsSync(f)) return toFileUrl(f);
    }
    try { const img = fs.readdirSync(dir).find(f => P.isType(f, 'image')); return img ? toFileUrl(path.join(dir, img)) : null; } catch { return null; }
  };
  const authorOf = (dir, root) => {
    const parent = path.dirname(dir);
    if (parent === root || parent === dir) return null;
    const n = path.basename(parent);
    return /^(cd|disc|disk|part)\s*\d+$/i.test(path.basename(dir)) ? path.basename(path.dirname(parent)) : n;
  };
  for (const [dir, { root, files }] of dirs) {
    files.sort(P.naturalCompare);
    const m4bs = files.filter(f => /\.m4b$/i.test(f));
    const mk = (title, tracks, author) => {
      const st = stat(tracks[0]);
      const parsed = P.parseBook(title);
      return {
        id: P.hashId('ab', tracks[0] + '|' + tracks.length), cat: 'audiobooks',
        title: parsed.title, author: parsed.author || author,
        files: tracks.map(t => ({ source: 'local', path: t, name: path.basename(t), size: (stat(t) || {}).size || 0 })),
        added: st ? st.mtimeMs : 0, localArt: coverOf(dir),
      };
    };
    if (m4bs.length > 1) for (const f of m4bs) out.push(mk(P.stripExt(path.basename(f)), [f], path.basename(dir)));
    else if (dir === root) for (const f of files) out.push(mk(P.stripExt(path.basename(f)), [f], null));
    else {
      let dirName = path.basename(dir);
      let bookDir = dir;
      if (/^(cd|disc|disk|part)\s*\d+$/i.test(dirName)) { bookDir = path.dirname(dir); dirName = path.basename(bookDir); }
      out.push(mk(dirName, files, authorOf(dir, root)));
    }
  }
  // merge multi-disc folders (CD1/CD2) that produced the same title
  const merged = new Map();
  for (const b of out) {
    const k = P.normTitle(b.title) + '|' + P.normTitle(b.author);
    if (merged.has(k)) merged.get(k).files.push(...b.files); else merged.set(k, b);
  }
  return [...merged.values()];
}


// ---------- Music (albums) ----------
const DISC_DIR = /^(cd|disc|disk)\s*\d+$/i;
function folderCover(dir) {
  for (const n of ['cover', 'folder', 'front', 'album', 'albumart', 'Cover', 'Folder', 'Front', 'AlbumArt']) for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const f = path.join(dir, n + ext); if (fs.existsSync(f)) return toFileUrl(f);
  }
  try { const img = fs.readdirSync(dir).filter(f => P.isType(f, 'image')).sort()[0]; return img ? toFileUrl(path.join(dir, img)) : null; } catch { return null; }
}
function trackFromName(name) {
  const base = P.stripExt(name);
  const m = base.match(/^\s*(?:(\d)[-.])?(\d{1,3})[\s.\-_)]+(.*)$/);
  let title = m ? m[3] : base, track = m ? parseInt(m[2], 10) : null, disc = m && m[1] ? parseInt(m[1], 10) : null;
  title = title.replace(/[_]+/g, ' ').trim();
  const parts = title.split(/\s+-\s+/);
  if (parts.length >= 2) title = parts.slice(1).join(' - ');
  return { title: title || base, track, disc };
}
function parseAlbumFolder(name) {
  let artist = null, album = name.replace(/\s*[\[(](flac|mp3|320|v0|web|cd|24bit|16bit|24-\d+|hi-?res|lossless)[^\])]*[\])]/gi, '').trim(), year = null;
  const y = album.match(/[\s(\[]*((?:19|20)\d{2})[)\]]?\s*$/) || album.match(/^\(?((?:19|20)\d{2})\)?\s*[-–]\s*/);
  if (y) { year = parseInt(y[1], 10); album = album.replace(y[0], ' ').trim(); }
  album = album.replace(/\s*[\[(](flac|mp3|320|v0|web|cd|24bit|16bit|hi-?res)[^\])]*[\])]/gi, '').trim();
  const parts = album.split(/\s+[-–]\s+/);
  if (parts.length >= 2) { artist = parts[0]; album = parts.slice(1).join(' - '); }
  return { artist, album: album || name, year };
}

function scanMusic(folders, cacheDir) {
  const groups = new Map();
  for (const root of folders) {
    walk(root, (p, name) => {
      if (!P.isType(name, 'audio') || /\.m4b$/i.test(name)) return;
      let dir = path.dirname(p);
      if (DISC_DIR.test(path.basename(dir))) dir = path.dirname(dir);
      const tags = readTags(p) || {};
      const key = dir + '|' + P.normTitle(tags.album || '');
      if (!groups.has(key)) groups.set(key, { dir, root, tracks: [] });
      const st = stat(p);
      const fromName = trackFromName(name);
      groups.get(key).tracks.push({
        source: 'local', path: p, name, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0,
        title: tags.title || fromName.title, track: tags.track || fromName.track, disc: tags.disc || fromName.disc || 1,
        artist: tags.artist || null, albumArtist: tags.albumArtist || null, album: tags.album || null, year: tags.year || null, genre: tags.genre || null,
      });
    });
  }
  const out = [];
  for (const { dir, root, tracks } of groups.values()) {
    tracks.sort((a, b) => (a.disc - b.disc) || ((a.track || 999) - (b.track || 999)) || P.naturalCompare(a.name, b.name));
    const folder = parseAlbumFolder(path.basename(dir));
    const parentDir = path.dirname(dir);
    const parentName = parentDir !== root && dir !== root ? path.basename(parentDir) : null;
    const t0 = tracks.find(t => t.album) || tracks[0];
    const artists = [...new Set(tracks.map(t => t.artist).filter(Boolean))];
    const artist = t0.albumArtist || (artists.length === 1 ? artists[0] : artists.length > 1 ? 'Various Artists' : null) || folder.artist || parentName || 'Unknown Artist';
    const album = dir === root ? (t0.album || 'Loose tracks') : (t0.album || folder.album);
    const year = t0.year || folder.year || null;
    const genres = [...new Set(tracks.map(t => t.genre).filter(Boolean))].slice(0, 3);
    const id = P.hashId('mu', dir + '|' + album);
    let cover = dir === root ? null : folderCover(dir);
    if (!cover) {
      const withArt = readTags(tracks[0].path, true);
      if (withArt && withArt.art && withArt.art.data.length > 100) {
        const f = path.join(cacheDir, id.replace(':', '_') + '.' + withArt.art.ext);
        try { if (!fs.existsSync(f)) fs.writeFileSync(f, withArt.art.data); cover = toFileUrl(f); } catch {}
      }
    }
    out.push({
      id, cat: 'music', title: album, artist, year, genres,
      files: tracks.map(({ mtime, album: _a, albumArtist: _b, genre: _g, year: _y, ...t }) => t),
      added: Math.max(...tracks.map(t => t.mtime)), localArt: cover,
    });
  }
  return out;
}

module.exports = { scanMusic, trackFromName, parseAlbumFolder, walk, scanMovies, scanTv, addEpisode, scanMusicVideos, scanBooks, scanAudiobooks, toFileUrl };
