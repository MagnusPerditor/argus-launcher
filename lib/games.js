// Game discovery: Steam, Epic, GOG, Ubisoft Connect, Xbox app (MS Store), custom folders,
// Xbox Game Pass catalog (PC + Cloud), and PlayStation Plus (PC app).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { hashId, tidy, normTitle } = require('./parse');
const { getJson } = require('./scrapers');

const IS_WIN = process.platform === 'win32';

function run(cmd, args, timeout = 30000) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : stdout));
  });
}
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// Parse `reg query ... /s` output into { keyPath: { valueName: data } }
function parseReg(out) {
  const res = {}; let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { cur = line.trim(); res[cur] = {}; continue; }
    const m = line.match(/^\s{2,}(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/);
    if (m && cur) res[cur][m[1]] = m[3].trim();
  }
  return res;
}

// ---------------- Steam ----------------
function parseVdfPaths(text) {
  return [...text.matchAll(/"path"\s+"([^"]+)"/gi)].map(m => m[1].replace(/\\\\/g, '\\'));
}
function parseAcf(text) {
  const g = k => { const m = text.match(new RegExp('"' + k + '"\\s+"([^"]*)"', 'i')); return m ? m[1] : null; };
  return { appid: g('appid'), name: g('name'), installdir: g('installdir'), lastPlayed: +(g('LastPlayed') || 0) };
}
const STEAM_SKIP = /Steamworks Common Redistributables|Proton|Steam Linux Runtime|SteamVR|Steam Controller|Spacewar|Steam Audio|Soundtrack/i;

async function scanSteam() {
  if (!IS_WIN) return [];
  let steam = null;
  const reg = parseReg(await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']));
  for (const k of Object.values(reg)) if (k.SteamPath) steam = k.SteamPath.replace(/\//g, '\\');
  for (const c of [steam, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) if (c && exists(c)) { steam = c; break; }
  if (!steam || !exists(steam)) return [];
  const libs = new Set([steam, ...parseVdfPaths(readText(path.join(steam, 'steamapps', 'libraryfolders.vdf')))]);
  const games = [];
  for (const lib of libs) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^appmanifest_\d+\.acf$/i.test(f)); } catch { continue; }
    for (const f of files) {
      const a = parseAcf(readText(path.join(dir, f)));
      if (!a.appid || !a.name || a.appid === '228980' || STEAM_SKIP.test(a.name)) continue;
      games.push({
        id: 'steam:' + a.appid, title: a.name, source: 'steam', sourceLabel: 'Steam',
        installDir: path.join(dir, 'common', a.installdir || ''),
        poster: `https://cdn.cloudflare.steamstatic.com/steam/apps/${a.appid}/library_600x900_2x.jpg`,
        posterFallback: `https://cdn.cloudflare.steamstatic.com/steam/apps/${a.appid}/header.jpg`,
        backdrop: `https://cdn.cloudflare.steamstatic.com/steam/apps/${a.appid}/library_hero.jpg`,
        launch: { type: 'uri', target: 'steam://rungameid/' + a.appid },
        storeUrl: 'https://store.steampowered.com/app/' + a.appid,
        lastPlayedExternal: a.lastPlayed ? a.lastPlayed * 1000 : 0,
        hasArt: true,
      });
    }
  }
  return games;
}

// ---------------- Epic ----------------
async function scanEpic() {
  if (!IS_WIN) return [];
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.item')); } catch { return []; }
  const games = [];
  for (const f of files) {
    let m; try { m = JSON.parse(readText(path.join(dir, f))); } catch { continue; }
    if (!m.DisplayName || m.bIsIncompleteInstall) continue;
    if (Array.isArray(m.AppCategories) && m.AppCategories.length && !m.AppCategories.includes('games')) continue;
    if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue; // DLC
    const id = `${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}`;
    games.push({
      id: 'epic:' + m.AppName, title: m.DisplayName, source: 'epic', sourceLabel: 'Epic',
      installDir: m.InstallLocation,
      launch: { type: 'uri', target: `com.epicgames.launcher://apps/${id}?action=launch&silent=true` },
    });
  }
  return games;
}

// ---------------- GOG ----------------
async function scanGog() {
  if (!IS_WIN) return [];
  const reg = parseReg(await run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']));
  const galaxy = ['C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe', 'C:\\Program Files\\GOG Galaxy\\GalaxyClient.exe'].find(exists);
  const games = [];
  for (const v of Object.values(reg)) {
    if (!v.gameName || !v.gameID) continue;
    if (v.dependsOn && v.dependsOn.trim()) continue; // DLC
    const launch = galaxy
      ? { type: 'exe', target: galaxy, args: ['/command=runGame', `/gameId=${v.gameID}`, `/path=${v.path}`], cwd: path.dirname(galaxy) }
      : { type: 'exe', target: v.exe, args: v.launchParam ? [v.launchParam] : [], cwd: v.workingDir || v.path };
    games.push({ id: 'gog:' + v.gameID, title: v.gameName, source: 'gog', sourceLabel: 'GOG', installDir: v.path, launch });
  }
  return games;
}

// ---------------- Ubisoft Connect ----------------
async function scanUbisoft() {
  if (!IS_WIN) return [];
  const reg = parseReg(await run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', '/s']));
  const games = [];
  for (const [key, v] of Object.entries(reg)) {
    const id = key.split('\\').pop();
    if (!/^\d+$/.test(id) || !v.InstallDir) continue;
    const dir = v.InstallDir.replace(/\//g, '\\').replace(/\\$/, '');
    if (!exists(dir)) continue;
    games.push({ id: 'ubi:' + id, title: path.basename(dir), source: 'ubisoft', sourceLabel: 'Ubisoft', installDir: dir, launch: { type: 'uri', target: `uplay://launch/${id}/0` } });
  }
  return games;
}

// ---------------- Xbox app / Microsoft Store (installed) ----------------
const XBOX_PS = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$out=@()
Get-AppxPackage | Where-Object { -not $_.IsFramework -and $_.InstallLocation } | ForEach-Object {
  $p=$_; $root=$null
  foreach($c in @($p.InstallLocation, (Join-Path $p.InstallLocation 'Content'))){ if(Test-Path -LiteralPath (Join-Path $c 'MicrosoftGame.config')){ $root=$c; break } }
  if(-not $root){ return }
  [xml]$x=Get-Content -LiteralPath (Join-Path $root 'MicrosoftGame.config') -Raw
  $g=$x.Game
  $sv=$g.ShellVisuals
  $mf=Get-AppxPackageManifest $p
  $app=$mf.Package.Applications.Application | Select-Object -First 1
  $out+=[pscustomobject]@{ name=[string]$sv.DefaultDisplayName; pkg=$p.Name; pfn=$p.PackageFamilyName; appId=[string]$app.Id; root=$root; storeId=[string]$g.StoreId; logo=[string]$sv.Square150x150Logo }
}
ConvertTo-Json -InputObject $out -Compress -Depth 3
`;

async function scanXbox() {
  if (!IS_WIN) return [];
  const enc = Buffer.from(XBOX_PS, 'utf16le').toString('base64');
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], 90000);
  let rows = []; try { rows = JSON.parse(out.trim() || '[]'); } catch { rows = []; }
  if (!Array.isArray(rows)) rows = [rows];
  return rows.filter(r => r && r.pfn && r.appId).map(r => {
    const name = r.name && !r.name.startsWith('ms-resource') ? r.name : tidy(r.pkg.replace(/^[^.]+\./, ''));
    const logo = r.logo ? path.join(r.root, r.logo) : null;
    return {
      id: 'xbox:' + r.pfn, title: name, source: 'xbox', sourceLabel: 'Xbox app', installDir: r.root, storeId: r.storeId || null,
      poster: logo && exists(logo) ? require('url').pathToFileURL(logo).href : null, posterIsLogo: true,
      launch: { type: 'aumid', target: `${r.pfn}!${r.appId}` },
    };
  });
}

// ---------------- Custom folders ----------------
const BAD_EXE = /unins|setup|install|redist|vcredist|vc_redist|dxsetup|directx|crash|report|helper|prereq|dotnet|physx|easyanticheat|battleye|cleanup|updater|patcher|config|benchmark|7z|python|java|cefsharp|notification|uploader|dxwebsetup|oalinst/i;

function findExes(dir, depth, acc = []) {
  if (depth < 0) return acc;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(redist|_commonredist|directx|support|__installer|engine)$/i.test(e.name)) findExes(p, depth - 1, acc); }
    else if (/\.exe$/i.test(e.name) && !BAD_EXE.test(e.name)) {
      let size = 0; try { size = fs.statSync(p).size; } catch {}
      acc.push({ p, name: e.name, size, depth });
    }
  }
  return acc;
}

function bestExe(dir) {
  const exes = findExes(dir, 3);
  if (!exes.length) return null;
  const want = normTitle(path.basename(dir));
  const score = e => {
    const n = normTitle(e.name.replace(/\.exe$/i, ''));
    let s = Math.log10(e.size + 1) + e.depth * 0.5;
    if (n && (want.includes(n) || n.includes(want))) s += 5;
    if (/launcher/i.test(e.name)) s -= 1;
    if (/win64|x64|shipping/i.test(e.p)) s += 1;
    return s;
  };
  return exes.sort((a, b) => score(b) - score(a))[0].p;
}

function scanGameFolders(folders) {
  const games = [];
  for (const root of folders) {
    let ents = []; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(root, e.name);
      if (e.isFile() && /\.(lnk|url|exe)$/i.test(e.name) && !BAD_EXE.test(e.name)) {
        const title = tidy(e.name.replace(/\.(lnk|url|exe)$/i, ''));
        games.push({ id: hashId('gf', p), title, source: 'folder', sourceLabel: 'PC', installDir: root, launch: { type: 'open', target: p } });
      } else if (e.isDirectory() && !e.name.startsWith('$') && !/^(system volume information|windowsapps)$/i.test(e.name)) {
        const exe = bestExe(p);
        if (exe) games.push({ id: hashId('gf', p), title: tidy(e.name), source: 'folder', sourceLabel: 'PC', installDir: p, launch: { type: 'exe', target: exe, cwd: path.dirname(exe) } });
      }
    }
  }
  return games;
}

// ---------------- Xbox Game Pass catalog ----------------
const SIGL = {
  pc: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff',
  cloud: '29a81209-df6f-41fd-a528-2ae6b91f719c',
};
const slugify = s => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function gamePassCatalog(which, market = 'US', lang = 'en-us') {
  const ids = new Map(); // productId -> {pc, cloud}
  for (const kind of ['pc', 'cloud']) {
    if (!which[kind]) continue;
    const list = await getJson(`https://catalog.gamepass.com/sigls/v2?id=${SIGL[kind]}&language=${lang}&market=${market}`);
    for (const row of list) if (row.id) ids.set(row.id, { ...(ids.get(row.id) || {}), [kind]: true });
  }
  const all = [...ids.keys()];
  const out = [];
  for (let i = 0; i < all.length; i += 20) {
    const batch = all.slice(i, i + 20);
    const d = await getJson(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${batch.join(',')}&market=${market}&languages=${lang}&MS-CV=DGU1mcuYo0WMMp+F.1`);
    for (const p of d.Products || []) {
      const lp = (p.LocalizedProperties || [])[0] || {};
      const img = purpose => { const im = (lp.Images || []).find(x => x.ImagePurpose === purpose); return im ? (im.Uri.startsWith('//') ? 'https:' + im.Uri : im.Uri) : null; };
      const flags = ids.get(p.ProductId) || {};
      const title = lp.ProductTitle || p.ProductId;
      out.push({
        id: 'gp:' + p.ProductId, storeId: p.ProductId, title,
        overview: lp.ShortDescription || lp.ProductDescription || '',
        publisher: lp.PublisherName || '',
        poster: img('Poster') || img('BoxArt'), backdrop: img('SuperHeroArt') || img('TitledHeroArt'),
        source: 'gamepass', sourceLabel: 'Game Pass', gamepass: { pc: !!flags.pc, cloud: !!flags.cloud },
        cloudUrl: flags.cloud ? `https://www.xbox.com/${lang}/play/launch/${slugify(title)}/${p.ProductId}` : null,
        launch: flags.pc ? { type: 'uri', target: `msxbox://game/?productId=${p.ProductId}` } : { type: 'cloud', target: `https://www.xbox.com/${lang}/play/launch/${slugify(title)}/${p.ProductId}` },
        storeUrl: `https://www.xbox.com/${lang}/games/store/${slugify(title)}/${p.ProductId}`,
      });
    }
  }
  return out;
}

// ---------------- PlayStation Plus ----------------
async function detectPsPlus() {
  if (!IS_WIN) return { app: null, remotePlay: null };
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const cands = [
    path.join(pf86, 'PlayStationPlus', 'pspluslauncher.exe'),
    path.join(pf, 'PlayStationPlus', 'pspluslauncher.exe'),
    path.join(pf86, 'PlayStation', 'PlayStationPlus', 'pspluslauncher.exe'),
    path.join(pf86, 'PlayStationPlus', 'agl', 'agl.exe'),
  ];
  let app = cands.find(exists) || null;
  if (!app) {
    const ps = "$ErrorActionPreference='SilentlyContinue'; Get-ItemProperty 'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -like 'PlayStation*Plus*' } | Select-Object -First 1 -ExpandProperty InstallLocation";
    const loc = (await run('powershell.exe', ['-NoProfile', '-Command', ps])).trim();
    if (loc) { const p = path.join(loc, 'pspluslauncher.exe'); if (exists(p)) app = p; }
  }
  const remotePlay = [path.join(pf86, 'Sony', 'PS Remote Play', 'RemotePlay.exe'), path.join(pf, 'Sony', 'PS Remote Play', 'RemotePlay.exe')].find(exists) || null;
  return { app, remotePlay };
}

module.exports = {
  scanSteam, scanEpic, scanGog, scanUbisoft, scanXbox, scanGameFolders, gamePassCatalog, detectPsPlus,
  parseReg, parseVdfPaths, parseAcf, bestExe, slugify, SIGL,
};
