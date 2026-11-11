// Metadata scrapers: TMDB + OMDb (movies/TV), Open Library (books/audiobooks), SteamGridDB (game art).
const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/(api_key|apikey|token)=[^&]+/g, '$1=***')}`);
  return res.json();
}

function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

// ---------- TMDB ----------
class Tmdb {
  constructor(key, region = 'US', language = 'en-US') {
    this.key = (key || '').trim(); this.region = region; this.language = language;
    this.limit = limiter(6);
  }
  get ok() { return !!this.key; }
  req(p, params = {}) {
    const u = new URL(TMDB + p);
    const bearer = this.key.length > 40;
    if (!bearer) u.searchParams.set('api_key', this.key);
    u.searchParams.set('language', this.language);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    const headers = bearer ? { Authorization: 'Bearer ' + this.key, accept: 'application/json' } : { accept: 'application/json' };
    return this.limit(() => getJson(u.toString(), { headers }));
  }
  async test() { await this.req('/configuration'); return true; }

  async findMovie(title, year) {
    let r = await this.req('/search/movie', { query: title, year, include_adult: 'false' });
    if (!r.results.length && year) r = await this.req('/search/movie', { query: title, include_adult: 'false' });
    return r.results[0] ? this.movie(r.results[0].id) : null;
  }
  async findTv(title, year) {
    let r = await this.req('/search/tv', { query: title, first_air_date_year: year, include_adult: 'false' });
    if (!r.results.length && year) r = await this.req('/search/tv', { query: title, include_adult: 'false' });
    return r.results[0] ? this.tv(r.results[0].id) : null;
  }
  providers(wp) {
    const r = wp && wp.results && wp.results[this.region];
    if (!r) return { link: null, stream: [], rent: [] };
    const map = p => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ? IMG + 'w92' + p.logo_path : null });
    const uniq = arr => [...new Map(arr.map(p => [p.id, p])).values()];
    return {
      link: r.link || null,
      stream: uniq([...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])].map(map)),
      rent: uniq([...(r.rent || []), ...(r.buy || [])].map(map)),
    };
  }
  async movie(id) {
    const d = await this.req(`/movie/${id}`, { append_to_response: 'watch/providers,credits' });
    return {
      tmdbId: d.id, imdbId: d.imdb_id, title: d.title, originalTitle: d.original_title,
      year: d.release_date ? +d.release_date.slice(0, 4) : null,
      overview: d.overview, tagline: d.tagline, runtime: d.runtime,
      genres: (d.genres || []).map(g => g.name),
      rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      poster: d.poster_path ? IMG + 'w500' + d.poster_path : null,
      backdrop: d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : null,
      cast: ((d.credits && d.credits.cast) || []).slice(0, 8).map(c => c.name),
      watch: this.providers(d['watch/providers']),
      scraper: 'tmdb',
    };
  }
  async tv(id) {
    const d = await this.req(`/tv/${id}`, { append_to_response: 'watch/providers,credits' });
    return {
      tmdbId: d.id, title: d.name, year: d.first_air_date ? +d.first_air_date.slice(0, 4) : null,
      overview: d.overview, tagline: d.tagline, status: d.status,
      genres: (d.genres || []).map(g => g.name),
      rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      poster: d.poster_path ? IMG + 'w500' + d.poster_path : null,
      backdrop: d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : null,
      cast: ((d.credits && d.credits.cast) || []).slice(0, 8).map(c => c.name),
      seasons: (d.seasons || []).map(s => ({ n: s.season_number, name: s.name, episodes: s.episode_count, poster: s.poster_path ? IMG + 'w342' + s.poster_path : null })),
      watch: this.providers(d['watch/providers']),
      scraper: 'tmdb',
    };
  }
  async season(tvId, n) {
    const d = await this.req(`/tv/${tvId}/season/${n}`);
    return (d.episodes || []).map(e => ({
      n: e.episode_number, title: e.name, overview: e.overview, airDate: e.air_date, runtime: e.runtime,
      still: e.still_path ? IMG + 'w300' + e.still_path : null,
    }));
  }
}

// ---------- OMDb (fallback / alternative) ----------
class Omdb {
  constructor(key) { this.key = (key || '').trim(); this.limit = limiter(4); }
  get ok() { return !!this.key; }
  async find(title, year, type) {
    const u = new URL('https://www.omdbapi.com/');
    u.searchParams.set('apikey', this.key); u.searchParams.set('t', title);
    if (year) u.searchParams.set('y', year);
    u.searchParams.set('type', type === 'tv' ? 'series' : 'movie');
    u.searchParams.set('plot', 'full');
    let d = await this.limit(() => getJson(u.toString()));
    if (d.Response === 'False' && year) { u.searchParams.delete('y'); d = await this.limit(() => getJson(u.toString())); }
    if (d.Response === 'False') return null;
    return {
      imdbId: d.imdbID, title: d.Title, year: parseInt(d.Year, 10) || null, overview: d.Plot !== 'N/A' ? d.Plot : '',
      genres: d.Genre && d.Genre !== 'N/A' ? d.Genre.split(',').map(s => s.trim()) : [],
      rating: d.imdbRating && d.imdbRating !== 'N/A' ? +d.imdbRating : null,
      runtime: parseInt(d.Runtime, 10) || null,
      poster: d.Poster && d.Poster !== 'N/A' ? d.Poster : null, backdrop: null,
      cast: d.Actors && d.Actors !== 'N/A' ? d.Actors.split(',').map(s => s.trim()) : [],
      seasons: d.totalSeasons ? Array.from({ length: +d.totalSeasons }, (_, i) => ({ n: i + 1, name: 'Season ' + (i + 1) })) : undefined,
      watch: { link: null, stream: [], rent: [] },
      scraper: 'omdb',
    };
  }
}

// ---------- Open Library ----------
const olLimit = limiter(3);
async function openLibrary(title, author) {
  const u = new URL('https://openlibrary.org/search.json');
  u.searchParams.set('title', title);
  if (author) u.searchParams.set('author', author);
  u.searchParams.set('limit', '1');
  u.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,subject');
  const d = await olLimit(() => getJson(u.toString(), { headers: { 'User-Agent': 'ArgusLauncher/1.1' } }));
  const b = d.docs && d.docs[0];
  if (!b) return null;
  return {
    title: b.title, author: (b.author_name || [])[0] || author || null, year: b.first_publish_year || null,
    poster: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-L.jpg` : null,
    genres: (b.subject || []).slice(0, 4), olKey: b.key, scraper: 'openlibrary',
  };
}

// ---------- MusicBrainz + Cover Art Archive (album art, no key; MB allows ~1 req/s) ----------
let mbLast = 0;
const mbLimit = limiter(1);
async function musicBrainz(album, artist) {
  return mbLimit(async () => {
    const wait = 1100 - (Date.now() - mbLast); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    mbLast = Date.now();
    const esc = s => String(s).replace(/(["\\])/g, '\\$1');
    const q = `releasegroup:"${esc(album)}"` + (artist && !/^(various artists|unknown artist)$/i.test(artist) ? ` AND artist:"${esc(artist)}"` : '');
    const d = await getJson('https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=1&query=' + encodeURIComponent(q), { headers: { 'User-Agent': 'ArgusLauncher/1.1 ( https://github.com/MagnusPerditor/argus-launcher )', Accept: 'application/json' } });
    const rg = d['release-groups'] && d['release-groups'][0];
    if (!rg || (rg.score || 0) < 80) return null;
    return {
      mbid: rg.id, title: rg.title, artist: (rg['artist-credit'] || []).map(a => a.name + (a.joinphrase || '')).join('') || artist,
      year: rg['first-release-date'] ? parseInt(rg['first-release-date'].slice(0, 4), 10) : null,
      poster: `https://coverartarchive.org/release-group/${rg.id}/front-500`,
      genres: (rg.tags || []).sort((a, b) => b.count - a.count).slice(0, 3).map(t => t.name),
      scraper: 'musicbrainz',
    };
  });
}

// ---------- IMVDb (music videos) ----------
class Imvdb {
  constructor(key) { this.key = (key || '').trim(); this.limit = limiter(4); }
  get ok() { return !!this.key; }
  req(p) { return this.limit(() => getJson('https://imvdb.com/api/v1' + p, { headers: { 'IMVDB-APP-KEY': this.key, Accept: 'application/json' } })); }
  async find(artist, title) {
    const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(feat|ft)\.?\b.*$/, '').replace(/[^a-z0-9]+/g, '');
    const q = [artist && !/^unknown/i.test(artist) ? artist : '', title].filter(Boolean).join(' ');
    const r = await this.req('/search/videos?per_page=10&q=' + encodeURIComponent(q));
    const list = r.results || [];
    const score = v => {
      const names = (v.artists || []).map(a => norm(a.name));
      let s = 0;
      if (norm(v.song_title) === norm(title)) s += 10; else if (norm(v.song_title).includes(norm(title)) || norm(title).includes(norm(v.song_title))) s += 5;
      if (artist && names.includes(norm(artist))) s += 8; else if (artist && names.some(n => n.includes(norm(artist)) || norm(artist).includes(n))) s += 4;
      if (!v.version_name && (v.version_number || 1) === 1) s += 1;
      if (v.is_imvdb_pick) s += 0.5;
      return s;
    };
    const best = list.map(v => ({ v, s: score(v) })).sort((a, b) => b.s - a.s)[0];
    if (!best || best.s < 10) return null; // need a confident title match
    const v = best.v;
    let d = {};
    try { d = await this.req(`/video/${v.id}?include=credits,sources,featured`); } catch {}
    const crew = (d.credits && d.credits.crew) || [];
    const directors = [...new Set([...(d.directors || []).map(x => x.entity_name), ...crew.filter(c => /director/i.test(c.position_name) && !/photography|art|creative/i.test(c.position_name)).map(c => c.entity_name)].filter(Boolean))];
    const yt = (d.sources || []).filter(s => s.source === 'youtube').sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))[0];
    const img = v.image || d.image || {};
    return {
      imvdbId: v.id, title: v.song_title, artist: (v.artists || []).map(a => a.name).join(', ') || artist,
      featured: (d.featured_artists || []).map(a => a.name), year: v.year || null,
      poster: img.l || img.o || img.b || null, backdrop: img.o || img.l || null,
      directors, youtube: yt ? yt.source_data : null, url: v.url || null, version: v.version_name || null, scraper: 'imvdb',
    };
  }
}

// ---------- SteamGridDB ----------
class SteamGrid {
  constructor(key) { this.key = (key || '').trim(); this.limit = limiter(4); }
  get ok() { return !!this.key; }
  req(p) { return this.limit(() => getJson('https://www.steamgriddb.com/api/v2' + p, { headers: { Authorization: 'Bearer ' + this.key } })); }
  async art(name) {
    const s = await this.req('/search/autocomplete/' + encodeURIComponent(name));
    const g = s.data && s.data[0];
    if (!g) return null;
    const [grids, heroes] = await Promise.all([
      this.req(`/grids/game/${g.id}?dimensions=600x900,342x482,660x930`).catch(() => ({})),
      this.req(`/heroes/game/${g.id}`).catch(() => ({})),
    ]);
    return {
      poster: grids.data && grids.data[0] ? grids.data[0].url : null,
      backdrop: heroes.data && heroes.data[0] ? heroes.data[0].url : null,
    };
  }
}

module.exports = { Imvdb, Tmdb, Omdb, SteamGrid, openLibrary, musicBrainz, getJson, limiter };
