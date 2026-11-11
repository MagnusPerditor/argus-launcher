// Filename parsing + file-type helpers shared by local scans and TorBox.
const path = require('path');
const crypto = require('crypto');

const EXT = {
  video: ['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.wmv', '.ts', '.m2ts', '.webm', '.mpg', '.mpeg', '.flv'],
  audio: ['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.ogg', '.opus', '.wma', '.wav'],
  book: ['.epub', '.pdf', '.mobi', '.azw', '.azw3', '.cbz', '.cbr', '.djvu', '.fb2'],
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  game: ['.exe', '.lnk', '.url', '.iso', '.bat'],
};
const isType = (file, type) => EXT[type].includes(path.extname(file).toLowerCase());

const JUNK = new RegExp(
  '\\b(' + [
    '2160p', '1080p', '1080i', '720p', '576p', '480p', 'uhd', 'hdr10\\+?', 'hdr', 'dovi', 'sdr',
    'x264', 'x265', 'h\\.?264', 'h\\.?265', 'hevc', 'xvid', 'divx', 'av1', '10bit', '8bit',
    'bluray', 'blu-ray', 'brrip', 'bdrip', 'bdremux', 'remux', 'web-?dl', 'web-?rip', 'hdtv', 'dvdrip', 'hdrip', 'ts-?rip',
    'proper', 'repack', 'unrated', 'imax', 'directors\\.?cut',
    'aac\\d?(\\.\\d)?', 'ac3', 'eac3', 'ddp\\d?(\\.\\d)?', 'dd5\\.1', 'dts(-?hd)?', 'truehd', 'atmos', '5\\.1', '7\\.1',
    'subbed', 'dubbed', 'amzn', 'dsnp', 'hmax', 'atvp', 'pcok', 'yts', 'rarbg', 'eztv',
  ].map(p => p.replace(/\\\./g, '[ .]')).join('|') + ')\\b', 'i');

function stripExt(name) {
  const ext = path.extname(name);
  return ext && ext.length <= 6 ? name.slice(0, -ext.length) : name;
}

function tidy(s) {
  return s
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cutJunk(s) {
  const m = s.match(JUNK);
  if (m && m.index > 0) s = s.slice(0, m.index);
  return s.replace(/[\s\-(]+$/, '').trim();
}

const YEAR_RE = /(?:^|[\s.(\[_-])((?:19|20)\d{2})(?=$|[\s.)\]_-])/g;

function parseMovie(fileOrName) {
  const raw = tidy(stripExt(path.basename(fileOrName)).replace(/[._]/g, ' '));
  let year = null, cut = -1, m;
  YEAR_RE.lastIndex = 0;
  while ((m = YEAR_RE.exec(raw))) {
    const idx = m.index + m[0].indexOf(m[1]);
    if (idx > 0) { year = parseInt(m[1], 10); cut = idx; }
  }
  let title = cut > 0 ? raw.slice(0, cut) : raw;
  title = cutJunk(title).replace(/[(\s-]+$/, '').trim();
  return { title: title || raw, year };
}

const EP_RES = [
  /[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})(?:[ ._-]*[Ee-](\d{1,3}))?/,
  /\b(\d{1,2})x(\d{2,3})\b/,
];

function parseEpisode(filePath) {
  const base = stripExt(path.basename(filePath));
  for (const re of EP_RES) {
    const m = base.match(re);
    if (!m) continue;
    let show = tidy(base.slice(0, m.index).replace(/[._]/g, ' '));
    let showYear = null;
    const y = show.match(/\(?((?:19|20)\d{2})\)?\s*$/);
    if (y && y.index > 0) { showYear = parseInt(y[1], 10); show = show.slice(0, y.index); }
    show = cutJunk(show).replace(/[\s-]+$/, '');
    if (!show) show = showFromFolders(filePath);
    if (!showYear) {
      for (const dir of filePath.split(/[\\/]/).slice(0, -1)) {
        const fm = dir.match(/^(.*?)[\s._]*\(?((?:19|20)\d{2})\)?$/);
        if (fm && normTitle(fm[1]) === normTitle(show)) { showYear = parseInt(fm[2], 10); break; }
      }
    }
    const after = tidy(base.slice(m.index + m[0].length).replace(/[._]/g, ' ')).replace(/^-\s*/, '');
    return {
      show, showYear,
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      episodeEnd: m[3] ? parseInt(m[3], 10) : null,
      epTitle: cutJunk(after) || null,
    };
  }
  return null;
}

function showFromFolders(filePath) {
  const parts = filePath.split(/[\\/]/).slice(0, -1).reverse();
  for (const p of parts) {
    if (!p || /^(season|series|s)\s*\d+$/i.test(p.trim()) || /^specials?$/i.test(p)) continue;
    return cutJunk(tidy(p.replace(/[._]/g, ' ')).replace(/\(?(?:19|20)\d{2}\)?\s*$/, '').trim());
  }
  return '';
}

function parseMusicVideo(file) {
  let base = tidy(stripExt(path.basename(file)));
  base = base.replace(/\((official|music|lyric|hd|4k|remastered)[^)]*\)/gi, '').replace(/\s{2,}/g, ' ').trim();
  base = cutJunk(base) || base;
  const parts = base.split(/\s+[-–]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  const parent = path.basename(path.dirname(file));
  return { artist: parent && parent !== '.' ? tidy(parent) : 'Unknown Artist', title: base };
}

function parseBook(file) {
  const base = tidy(stripExt(path.basename(file)));
  const parts = base.split(/\s+[-–]\s+/);
  if (parts.length >= 2) return { author: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { author: null, title: base };
}

function normTitle(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function hashId(prefix, s) {
  return prefix + ':' + crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex').slice(0, 14);
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

module.exports = {
  EXT, isType, tidy, cutJunk, stripExt, parseMovie, parseEpisode, parseMusicVideo, parseBook,
  normTitle, hashId, naturalCompare, showFromFolders,
};
