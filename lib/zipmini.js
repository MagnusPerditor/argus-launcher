// Minimal ZIP reader (no deps) — enough to pull covers/metadata out of EPUB and CBZ files.
const fs = require('fs');
const zlib = require('zlib');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return n === len ? buf : buf.subarray(0, n);
}

function openZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tailPos = size - tailLen;
    const tail = readAt(fd, tailPos, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);
    // ZIP64 (archives over 4 GB or 65535 files)
    if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z64pos = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const z = readAt(fd, z64pos, 56);
      if (z.readUInt32LE(0) === 0x06064b50) { count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48)); }
    }
    const cd = readAt(fd, cdOff, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let unSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // ZIP64 extra field: values present only for fields that were 0xFFFFFFFF, in this order
      let x = p + 46 + nameLen; const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (unSize === 0xffffffff) { unSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, method, compSize, size: unSize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    const dataStart = entry => { const lh = readAt(fd, entry.offset, 30); return entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28); };
    return {
      entries,
      read(entry) {
        const data = readAt(fd, dataStart(entry), entry.compSize);
        if (entry.method === 0) return data;
        if (entry.method === 8) return zlib.inflateRawSync(data);
        throw new Error('Unsupported zip method ' + entry.method);
      },
      dataStart,
      close() { try { fs.closeSync(fd); } catch {} },
    };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}

// Stream one entry to a file (no full in-memory copy). Supports stored + deflate.
function extractEntry(file, entryName, dest) {
  return new Promise((resolve, reject) => {
    let z;
    try { z = openZip(file); } catch (e) { return reject(e); }
    const entry = z.entries.find(e => e.name === entryName);
    if (!entry) { z.close(); return reject(new Error('Not found in archive: ' + entryName)); }
    if (entry.method !== 0 && entry.method !== 8) { z.close(); return reject(new Error(`This zip uses compression method ${entry.method} (e.g. Deflate64/LZMA), which can't be read. Extract the archive into the ROM folder instead.`)); }
    const start = z.dataStart(entry);
    z.close();
    fs.mkdirSync(require('path').dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const src = entry.compSize ? fs.createReadStream(file, { start, end: start + entry.compSize - 1 }) : require('stream').Readable.from([]);
    const out = fs.createWriteStream(tmp);
    const chain = entry.method === 8 ? src.pipe(zlib.createInflateRaw()) : src;
    const fail = e => { try { out.destroy(); fs.unlinkSync(tmp); } catch {} reject(e); };
    src.on('error', fail); chain.on('error', fail); out.on('error', fail);
    out.on('finish', () => { try { fs.renameSync(tmp, dest); resolve(dest); } catch (e) { reject(e); } });
    chain.pipe(out);
  });
}

const IMG = /\.(jpe?g|png|webp|gif)$/i;

function xmlAttr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
  return m ? m[1] : null;
}
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Returns { title, author, description, cover: {data, ext} | null }
function readEpub(file) {
  const z = openZip(file);
  try {
    const byName = new Map(z.entries.map(e => [e.name, e]));
    const container = byName.get('META-INF/container.xml');
    let opfPath = null;
    if (container) {
      const x = z.read(container).toString('utf8');
      const m = x.match(/<rootfile\b[^>]*>/i);
      if (m) opfPath = xmlAttr(m[0], 'full-path');
    }
    if (!opfPath) opfPath = (z.entries.find(e => e.name.endsWith('.opf')) || {}).name;
    const out = { title: null, author: null, description: null, cover: null };
    if (!opfPath || !byName.get(opfPath)) return out;
    const opf = z.read(byName.get(opfPath)).toString('utf8');
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const get = tag => { const m = opf.match(new RegExp('<dc:' + tag + '\\b[^>]*>([\\s\\S]*?)</dc:' + tag + '>', 'i')); return m ? decodeXml(m[1].replace(/<[^>]+>/g, '').trim()) : null; };
    out.title = get('title');
    out.author = get('creator');
    out.description = get('description');

    const items = [...opf.matchAll(/<item\b[^>]*>/gi)].map(m => ({
      id: xmlAttr(m[0], 'id'), href: xmlAttr(m[0], 'href'), type: xmlAttr(m[0], 'media-type') || '', props: xmlAttr(m[0], 'properties') || '',
    }));
    let coverHref = null;
    const metaCover = opf.match(/<meta\b[^>]*name=["']cover["'][^>]*>/i);
    if (metaCover) {
      const id = xmlAttr(metaCover[0], 'content');
      const it = items.find(i => i.id === id);
      if (it) coverHref = it.href;
    }
    if (!coverHref) { const it = items.find(i => i.props.includes('cover-image')); if (it) coverHref = it.href; }
    if (!coverHref) { const it = items.find(i => i.type.startsWith('image/') && /cover/i.test(i.id + i.href)); if (it) coverHref = it.href; }
    if (coverHref) {
      const full = decodeURIComponent(base + coverHref).replace(/\/\.\//g, '/');
      const e = byName.get(full) || z.entries.find(x => x.name.endsWith(coverHref));
      if (e && IMG.test(e.name)) out.cover = { data: z.read(e), ext: e.name.split('.').pop().toLowerCase() };
    }
    return out;
  } finally { z.close(); }
}

function readCbzCover(file) {
  const z = openZip(file);
  try {
    const imgs = z.entries.filter(e => IMG.test(e.name) && !e.name.startsWith('__MACOSX'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!imgs.length) return null;
    return { data: z.read(imgs[0]), ext: imgs[0].name.split('.').pop().toLowerCase() };
  } finally { z.close(); }
}

module.exports = { openZip, extractEntry, readEpub, readCbzCover };
