// Minimal audio tag reader (no deps): ID3v2.3/2.4 (MP3, also AIFF/WAV-less) and FLAC Vorbis comments.
// Reads frame-by-frame so big embedded artwork is skipped unless asked for.
const fs = require('fs');

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}
const syncsafe = b => (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3];

function decodeText(buf) {
  if (!buf.length) return '';
  const enc = buf[0], d = buf.subarray(1);
  let s;
  if (enc === 1 || enc === 2) {
    let body = d, le = enc === 1;
    if (enc === 1 && d.length >= 2) {
      if (d[0] === 0xff && d[1] === 0xfe) { body = d.subarray(2); le = true; }
      else if (d[0] === 0xfe && d[1] === 0xff) { body = d.subarray(2); le = false; }
    }
    if (!le) { body = Buffer.from(body); body.swap16 && body.length % 2 === 0 && body.swap16(); }
    s = body.toString('utf16le');
  } else s = d.toString(enc === 3 ? 'utf8' : 'latin1');
  return s.split('\u0000').filter(Boolean)[0] || '';
}

const ID3_WANT = { TIT2: 'title', TPE1: 'artist', TPE2: 'albumArtist', TALB: 'album', TRCK: 'track', TPOS: 'disc', TDRC: 'year', TYER: 'year', TCON: 'genre' };

function readId3(fd, size, wantArt) {
  const head = readAt(fd, 0, 10);
  const ver = head[3];
  if (ver < 3) return null; // ID3v2.2: rare, fall back to path
  const tagSize = syncsafe(head.subarray(6, 10));
  let pos = 10;
  if (head[5] & 0x40) { const ext = readAt(fd, 10, 4); pos += ver === 4 ? syncsafe(ext) : ext.readUInt32BE(0) + 4; }
  const end = Math.min(10 + tagSize, size);
  const out = {};
  while (pos + 10 <= end) {
    const fh = readAt(fd, pos, 10);
    const id = fh.toString('latin1', 0, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsz = ver === 4 ? syncsafe(fh.subarray(4, 8)) : fh.readUInt32BE(4);
    if (fsz <= 0 || pos + 10 + fsz > end) break;
    if (ID3_WANT[id] && !out[ID3_WANT[id]]) out[ID3_WANT[id]] = decodeText(readAt(fd, pos + 10, Math.min(fsz, 4096))).trim();
    else if (id === 'APIC' && wantArt && !out.art) {
      const b = readAt(fd, pos + 10, fsz);
      const enc = b[0];
      let i = 1; const mEnd = b.indexOf(0, i); const mime = b.toString('latin1', i, mEnd); i = mEnd + 2; // skip picture type
      if (enc === 1 || enc === 2) { while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2; i += 2; }
      else { while (i < b.length && b[i] !== 0) i++; i += 1; }
      out.art = { data: b.subarray(i), ext: /png/i.test(mime) ? 'png' : 'jpg' };
    }
    pos += 10 + fsz;
  }
  return out;
}

function readFlac(fd, size, wantArt) {
  let pos = 4; const out = {};
  for (let guard = 0; guard < 64 && pos + 4 <= size; guard++) {
    const h = readAt(fd, pos, 4);
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4) {
      const b = readAt(fd, pos + 4, len);
      let i = 4 + b.readUInt32LE(0);
      const n = b.readUInt32LE(i); i += 4;
      for (let k = 0; k < n && i + 4 <= b.length; k++) {
        const l = b.readUInt32LE(i); i += 4;
        const kv = b.toString('utf8', i, i + l); i += l;
        const eq = kv.indexOf('='); if (eq < 0) continue;
        const key = kv.slice(0, eq).toUpperCase(), val = kv.slice(eq + 1).trim();
        const map = { TITLE: 'title', ARTIST: 'artist', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', ALBUM: 'album', TRACKNUMBER: 'track', DISCNUMBER: 'disc', DATE: 'year', YEAR: 'year', GENRE: 'genre' };
        if (map[key] && !out[map[key]]) out[map[key]] = val;
      }
    } else if (type === 6 && wantArt && !out.art) {
      const b = readAt(fd, pos + 4, len);
      let i = 4; const ml = b.readUInt32BE(i); i += 4; const mime = b.toString('latin1', i, i + ml); i += ml;
      const dl = b.readUInt32BE(i); i += 4 + dl + 16; const pl = b.readUInt32BE(i); i += 4;
      out.art = { data: b.subarray(i, i + pl), ext: /png/i.test(mime) ? 'png' : 'jpg' };
    }
    pos += 4 + len;
    if (last) break;
  }
  return out;
}

function readTags(file, wantArt = false) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const magic = readAt(fd, 0, 4).toString('latin1');
    let t = null;
    if (magic.startsWith('ID3')) t = readId3(fd, size, wantArt);
    else if (magic === 'fLaC') t = readFlac(fd, size, wantArt);
    if (!t) return null;
    if (t.track) t.track = parseInt(t.track, 10) || null;
    if (t.disc) t.disc = parseInt(t.disc, 10) || null;
    if (t.year) t.year = parseInt(String(t.year).slice(0, 4), 10) || null;
    if (t.genre) t.genre = t.genre.replace(/^\((\d+)\)/, '').trim() || null;
    return t;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

module.exports = { readTags };
