// Streaming service catalog. `search` uses {q} as the URL-encoded query.
// `providers` = TMDB watch-provider IDs / names used to show "Available on" badges.
// Edit freely — custom services can also be added from Library Setup.
const VIDEO_SERVICES = [
  { id: 'netflix', name: 'Netflix', color: '#E50914', url: 'https://www.netflix.com/browse', search: 'https://www.netflix.com/search?q={q}', providers: [8, 'netflix'] },
  { id: 'prime', name: 'Prime Video', color: '#00A8E1', url: 'https://www.amazon.com/gp/video/storefront', search: 'https://www.amazon.com/s?k={q}&i=instant-video', providers: [9, 119, 'amazon prime video'] },
  { id: 'disney', name: 'Disney+', color: '#113CCF', url: 'https://www.disneyplus.com/home', search: 'https://www.disneyplus.com/search?q={q}', providers: [337, 'disney plus'] },
  { id: 'hbomax', name: 'HBO Max', color: '#5822B4', url: 'https://play.hbomax.com/', search: 'https://play.hbomax.com/search?q={q}', providers: [1899, 384, 'max', 'hbo max'] },
  { id: 'hulu', name: 'Hulu', color: '#1CE783', url: 'https://www.hulu.com/hub/home', search: 'https://www.hulu.com/search?q={q}', providers: [15, 'hulu'] },
  { id: 'peacock', name: 'Peacock', color: '#FFFFFF', url: 'https://www.peacocktv.com/watch/home', search: 'https://www.peacocktv.com/watch/search?q={q}', providers: [386, 387, 'peacock'] },
  { id: 'paramount', name: 'Paramount+', color: '#0064FF', url: 'https://www.paramountplus.com/home/', search: 'https://www.paramountplus.com/search/?q={q}', providers: [531, 2303, 'paramount plus', 'paramount+'] },
  { id: 'appletv', name: 'Apple TV+', color: '#A2AAAD', url: 'https://tv.apple.com/', search: 'https://tv.apple.com/search?term={q}', providers: [350, 2, 'apple tv'] },
  { id: 'crunchyroll', name: 'Crunchyroll', color: '#F47521', url: 'https://www.crunchyroll.com/', search: 'https://www.crunchyroll.com/search?q={q}', providers: [283, 'crunchyroll'] },
  { id: 'tubi', name: 'Tubi', color: '#FA5714', url: 'https://tubitv.com/home', search: 'https://tubitv.com/search/{q}', providers: [73, 'tubi'] },
  { id: 'pluto', name: 'Pluto TV', color: '#FFF200', url: 'https://pluto.tv/', search: 'https://pluto.tv/search/details?query={q}', providers: [300, 'pluto tv'] },
  { id: 'youtube', name: 'YouTube', color: '#FF0000', url: 'https://www.youtube.com/', search: 'https://www.youtube.com/results?search_query={q}', providers: [192, 'youtube'] },
  { id: 'plex', name: 'Plex', color: '#E5A00D', url: 'https://app.plex.tv/desktop', search: 'https://app.plex.tv/desktop#!/search?query={q}', providers: [538, 'plex'], configurable: true },
  { id: 'jellyfin', name: 'Jellyfin', color: '#AA5CC3', url: '', search: '{base}/web/#/search.html?query={q}', providers: [], configurable: true, needsBase: true },
];

const MUSIC_VIDEO_SERVICES = [
  { id: 'youtube', name: 'YouTube', color: '#FF0000', url: 'https://www.youtube.com/', search: 'https://www.youtube.com/results?search_query={q}+official+video' },
  { id: 'ytmusic', name: 'YouTube Music', color: '#FF0033', url: 'https://music.youtube.com/', search: 'https://music.youtube.com/search?q={q}' },
  { id: 'applemusic', name: 'Apple Music', color: '#FA2D48', url: 'https://music.apple.com/', search: 'https://music.apple.com/us/search?term={q}' },
  { id: 'tidal', name: 'TIDAL', color: '#FFFFFF', url: 'https://listen.tidal.com/', search: 'https://listen.tidal.com/search?q={q}' },
  { id: 'spotify', name: 'Spotify', color: '#1DB954', url: 'https://open.spotify.com/', search: 'https://open.spotify.com/search/{q}' },
  { id: 'vevo', name: 'Vevo', color: '#FF0A54', url: 'https://www.youtube.com/@Vevo', search: 'https://www.youtube.com/results?search_query={q}+vevo' },
  { id: 'plex', name: 'Plex', color: '#E5A00D', url: 'https://app.plex.tv/desktop', search: 'https://app.plex.tv/desktop#!/search?query={q}', configurable: true },
  { id: 'jellyfin', name: 'Jellyfin', color: '#AA5CC3', url: '', search: '{base}/web/#/search.html?query={q}', configurable: true, needsBase: true },
];

const MUSIC_SERVICES = [
  { id: 'spotify', name: 'Spotify', color: '#1DB954', url: 'https://open.spotify.com/', search: 'https://open.spotify.com/search/{q}' },
  { id: 'applemusic', name: 'Apple Music', color: '#FA2D48', url: 'https://music.apple.com/', search: 'https://music.apple.com/us/search?term={q}' },
  { id: 'ytmusic', name: 'YouTube Music', color: '#FF0033', url: 'https://music.youtube.com/', search: 'https://music.youtube.com/search?q={q}' },
  { id: 'amazonmusic', name: 'Amazon Music', color: '#25D1DA', url: 'https://music.amazon.com/', search: 'https://music.amazon.com/search/{q}' },
  { id: 'tidal', name: 'TIDAL', color: '#FFFFFF', url: 'https://listen.tidal.com/', search: 'https://listen.tidal.com/search?q={q}' },
  { id: 'deezer', name: 'Deezer', color: '#A238FF', url: 'https://www.deezer.com/', search: 'https://www.deezer.com/search/{q}' },
  { id: 'soundcloud', name: 'SoundCloud', color: '#FF5500', url: 'https://soundcloud.com/discover', search: 'https://soundcloud.com/search?q={q}' },
  { id: 'pandora', name: 'Pandora', color: '#3668FF', url: 'https://www.pandora.com/', search: 'https://www.pandora.com/search/{q}/all' },
  { id: 'plex', name: 'Plex', color: '#E5A00D', url: 'https://app.plex.tv/desktop', search: 'https://app.plex.tv/desktop#!/search?query={q}', configurable: true },
  { id: 'jellyfin', name: 'Jellyfin', color: '#AA5CC3', url: '', search: '{base}/web/#/search.html?query={q}', configurable: true, needsBase: true },
];

function catalogFor(cat) {
  if (cat === 'music') return MUSIC_SERVICES;
  if (cat === 'movies' || cat === 'tv') return VIDEO_SERVICES;
  if (cat === 'musicvideos') return MUSIC_VIDEO_SERVICES;
  return [];
}

module.exports = { VIDEO_SERVICES, MUSIC_VIDEO_SERVICES, MUSIC_SERVICES, catalogFor };
