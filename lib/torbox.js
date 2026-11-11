// TorBox library integration: list torrents / usenet / web downloads and classify into media categories.
const path = require('path');
const { isType, parseEpisode } = require('./parse');
const { getJson } = require('./scrapers');

const API = 'https://api.torbox.app/v1/api';
const KINDS = {
  torrent: { list: '/torrents/mylist', dl: '/torrents/requestdl', idParam: 'torrent_id' },
  usenet: { list: '/usenet/mylist', dl: '/usenet/requestdl', idParam: 'usenet_id' },
  webdl: { list: '/webdl/mylist', dl: '/webdl/requestdl', idParam: 'web_id' },
};

const AUDIOBOOK_HINT = /audiobook|unabridged|abridged|narrated|read by|\bm4b\b/i;
const GAME_HINT = /\b(fitgirl|dodi|elamigos|gog|repack|codex|plaza|skidrow|rune|tenoke|empress|flt|razor1911|kaos)\b/i;

class TorBox {
  constructor(key) { this.key = (key || '').trim(); }
  get ok() { return !!this.key; }
  headers() { return { Authorization: 'Bearer ' + this.key }; }

  async test() {
    const d = await getJson(API + '/user/me', { headers: this.headers() });
    return d && d.data ? { email: d.data.email, plan: d.data.plan } : true;
  }

  async listAll() {
    const out = [];
    for (const [kind, k] of Object.entries(KINDS)) {
      try {
        const d = await getJson(API + k.list + '?bypass_cache=true', { headers: this.headers(), timeout: 30000 });
        for (const it of d.data || []) {
          const ready = it.download_finished || it.download_present || it.download_state === 'completed' || it.download_state === 'cached';
          if (!ready) continue;
          out.push({
            kind, id: it.id, name: it.name || '', created: it.created_at,
            files: (it.files || []).map(f => ({ id: f.id, path: f.name || f.short_name, name: f.short_name || path.basename(f.name || ''), size: f.size || 0 })),
          });
        }
      } catch (e) { /* one list failing (e.g. no usenet plan) shouldn't kill the rest */ }
    }
    return out;
  }

  async link(kind, itemId, fileId) {
    const k = KINDS[kind];
    const u = new URL(API + k.dl);
    u.searchParams.set('token', this.key);
    u.searchParams.set(k.idParam, itemId);
    if (fileId !== undefined && fileId !== null) u.searchParams.set('file_id', fileId);
    else u.searchParams.set('zip_link', 'true');
    const d = await getJson(u.toString(), { headers: this.headers() });
    if (!d.data) throw new Error(d.detail || 'TorBox did not return a link');
    return d.data;
  }
}

// Decide what a TorBox item is. Returns { category, files } where files are the relevant ones.
function classify(item, override) {
  const files = item.files;
  const videos = files.filter(f => isType(f.name, 'video'));
  const biggest = videos.length ? Math.max(...videos.map(f => f.size)) : 0;
  const realVideos = videos.filter(f => !(/\bsample\b/i.test(f.name) && f.size < biggest * 0.5));
  const audio = files.filter(f => isType(f.name, 'audio'));
  const books = files.filter(f => isType(f.name, 'book'));
  const gameFiles = files.filter(f => /\.(iso|exe|bin)$/i.test(f.name));
  const episodes = realVideos.filter(f => parseEpisode(f.path || f.name));

  if (override) {
    const pick = { tv: realVideos, movies: realVideos, musicvideos: realVideos, music: audio, audiobooks: audio, books, games: files }[override];
    return { category: override, files: pick && pick.length ? pick : files };
  }
  if (episodes.length) return { category: 'tv', files: episodes };
  if (gameFiles.length && (GAME_HINT.test(item.name) || files.some(f => /setup.*\.exe$|\.iso$/i.test(f.name)))) return { category: 'games', files };
  if (realVideos.length) return { category: 'movies', files: realVideos };
  if (audio.length) {
    const isBook = audio.some(f => /\.m4b$/i.test(f.name)) || AUDIOBOOK_HINT.test(item.name) || audio.filter(f => /chapter|\bch\s?\d|\bpart\s?\d/i.test(f.name)).length >= audio.length / 2;
    return { category: isBook ? 'audiobooks' : 'music', files: audio };
  }
  if (books.length) return { category: 'books', files: books };
  if (gameFiles.length) return { category: 'games', files };
  return { category: null, files: [] };
}

module.exports = { TorBox, classify };
