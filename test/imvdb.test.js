// Offline test of IMVDb matching with a stubbed fetch
const assert = require('assert');
const { Imvdb } = require('../lib/scrapers');
const calls = [];
global.fetch = async (url, opts) => {
  calls.push({ url, key: opts.headers['IMVDB-APP-KEY'] });
  const body = url.includes('/search/videos') ? { total_results: 3, results: [
    { id: 1, song_title: 'Around the World (Live)', version_name: 'Live', version_number: 2, year: 1997, artists: [{ name: 'Daft Punk' }], image: { l: 'L1' } },
    { id: 2, song_title: 'Around the World', year: 1997, artists: [{ name: 'Daft Punk' }], image: { l: 'https://img/l.jpg', o: 'https://img/o.jpg' }, url: 'https://imvdb.com/video/daft-punk/around-the-world' },
    { id: 3, song_title: 'Around the World', year: 2000, artists: [{ name: 'Red Hot Chili Peppers' }], image: {} },
  ] } : { id: 2, directors: [{ entity_name: 'Michel Gondry' }], credits: { crew: [{ position_name: 'Director of Photography', entity_name: 'Someone Else' }] }, sources: [{ source: 'vimeo', source_data: 'x' }, { source: 'youtube', source_data: 's9MszVE7aR4', is_primary: true }], featured_artists: [] };
  return { ok: true, json: async () => body };
};
(async () => {
  const m = await new Imvdb('KEY').find('Daft Punk', 'Around the World');
  assert.strictEqual(m.imvdbId, 2); assert.deepStrictEqual(m.directors, ['Michel Gondry']); assert.strictEqual(m.youtube, 's9MszVE7aR4');
  assert.strictEqual(m.poster, 'https://img/l.jpg'); assert.strictEqual(m.year, 1997); assert.ok(calls.every(c => c.key === 'KEY'));
  const none = await new Imvdb('KEY').find('Daft Punk', 'Some Song Not There');
  assert.strictEqual(none, null);
  console.log('imvdb ok');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
