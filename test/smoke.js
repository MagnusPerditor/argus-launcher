// Electron smoke test: boots the real app against the fixture data dir, exercises IPC, captures a screenshot.
// Run: xvfb-run -a node_modules/.bin/electron test/smoke.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
app.setPath('userData', path.join(os.tmpdir(), 'ol-data'));
require('../main.js');

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const res = await win.webContents.executeJavaScript(`(async () => {
        const lib = await window.api.rescan();
        const cfg = await window.api.getConfig();
        const st = await window.api.markPlayed(lib.movies[0].id);
        const players = await window.api.detectPlayers();
        await new Promise(r => setTimeout(r, 400));
        document.querySelector('[data-v=movies]').click();
        await new Promise(r => setTimeout(r, 400));
        return { movies: lib.movies.length, tv: lib.tv.length, games: lib.games.length, setupDone: cfg.setupDone, played: Object.keys(st.played).length, cards: document.querySelectorAll('.card').length, players };
      })()`);
      console.log('SMOKE', JSON.stringify(res));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(os.tmpdir(), 'ol-smoke.png'), img.toPNG());
    } catch (e) { console.log('SMOKE FAIL', e.message); }
    app.exit(0);
  });
});
