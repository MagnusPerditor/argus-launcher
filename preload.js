const { contextBridge, ipcRenderer, webFrame } = require('electron');

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

window.addEventListener('error', e => ipcRenderer.invoke('log', String(e.message), e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => ipcRenderer.invoke('log', 'unhandled', String(e.reason && e.reason.stack || e.reason)));

contextBridge.exposeInMainWorld('api', {
  getConfig: () => call('config:get'),
  setConfig: cfg => call('config:set', cfg),
  catalog: () => call('services:catalog'),
  getLibrary: () => call('library:get'),
  rescan: only => call('library:rescan', only),
  season: (tvId, n) => call('library:season', tvId, n),
  getState: () => call('state:get'),
  markPlayed: id => call('state:played', id),
  saveProgress: (id, data) => call('state:progress', id, data),
  torboxLink: tb => call('torbox:link', tb),
  torboxOverride: (key, cat) => call('torbox:override', key, cat),
  play: req => call('play', req),
  openExternal: url => call('open:external', url),
  pickFolders: () => call('dialog:folder'),
  pickFile: filters => call('dialog:file', filters),
  detectPlayers: () => call('detect:players'),
  detectPsPlus: () => call('detect:psplus'),
  tilesList: () => call('tiles:list'),
  tilesBundled: () => call('tiles:bundled'),
  tilesPick: key => call('tiles:pick', key),
  tilesSet: (key, mode) => call('tiles:set', key, mode),
  emuSystems: () => call('emu:systems'),
  emuDetect: emu => call('emu:detect', emu),
  emuCores: p => call('emu:cores', p),
  emuAutoAssign: root => call('emu:autoassign', root),
  testKey: (kind, key) => call('keys:test', kind, key),
  setFullScreen: on => call('window:fullscreen', !!on),
  setZoom: f => { try { webFrame.setZoomFactor(Math.min(2, Math.max(0.75, +f || 1))); } catch {} },
  updateInfo: () => call('update:info'),
  updateCheck: () => call('update:check'),
  updateDownload: () => call('update:download'),
  updateInstall: () => call('update:install'),
  onUpdate: fn => ipcRenderer.on('update:status', (_e, s) => fn(s)),
  onProgress: fn => ipcRenderer.on('scan:progress', (_e, p) => fn(p)),
});
