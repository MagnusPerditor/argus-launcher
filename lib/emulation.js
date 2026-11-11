// Emulation: system catalog, ROM scanning, RetroArch / standalone emulator launching, libretro box art.
const fs = require('fs');
const path = require('path');
const P = require('./parse');
const { openZip } = require('./zipmini');

// cores: preferred RetroArch cores in order (file base name without _libretro.dll)
// standalone: common standalone emulators with arg templates ({rom} = ROM path)
const SYSTEMS = [
  { id: 'nes', name: 'NES', full: 'Nintendo Entertainment System', lr: 'Nintendo - Nintendo Entertainment System', exts: ['nes', 'fds', 'unf', 'unif', 'zip', '7z'], cores: ['mesen', 'nestopia', 'fceumm'], aliases: ['nes', 'famicom', 'nintendo entertainment system'], color: '#E60012' },
  { id: 'snes', name: 'SNES', full: 'Super Nintendo', lr: 'Nintendo - Super Nintendo Entertainment System', exts: ['sfc', 'smc', 'fig', 'swc', 'bs', 'zip', '7z'], cores: ['snes9x', 'bsnes', 'bsnes_hd_beta'], aliases: ['snes', 'super nintendo', 'super famicom', 'sfc'], color: '#7B5AA6' },
  { id: 'n64', name: 'N64', full: 'Nintendo 64', lr: 'Nintendo - Nintendo 64', exts: ['n64', 'z64', 'v64', 'bin', 'rom', 'ndd', 'u1', 'zip', '7z'], cores: ['mupen64plus_next', 'parallel_n64'], aliases: ['n64', 'nintendo 64'], color: '#009E60',
    standalone: [{ name: 'Project64', exe: 'Project64.exe', args: '"{rom}"' }, { name: 'simple64', exe: 'simple64-gui.exe', args: '--nogui "{rom}"' }] },
  { id: 'gb', name: 'Game Boy', full: 'Game Boy', lr: 'Nintendo - Game Boy', exts: ['gb', 'zip', '7z'], cores: ['gambatte', 'sameboy', 'mgba'], aliases: ['gb', 'game boy', 'gameboy'], color: '#8B956D' },
  { id: 'gbc', name: 'GBC', full: 'Game Boy Color', lr: 'Nintendo - Game Boy Color', exts: ['gbc', 'zip', '7z'], cores: ['gambatte', 'sameboy', 'mgba'], aliases: ['gbc', 'game boy color', 'gameboy color'], color: '#6A3FB5' },
  { id: 'gba', name: 'GBA', full: 'Game Boy Advance', lr: 'Nintendo - Game Boy Advance', exts: ['gba', 'zip', '7z'], cores: ['mgba', 'vba_next', 'gpsp'], aliases: ['gba', 'game boy advance', 'gameboy advance'], color: '#4B3FA8' },
  { id: 'nds', name: 'DS', full: 'Nintendo DS', lr: 'Nintendo - Nintendo DS', exts: ['nds', 'zip', '7z'], cores: ['melondsds', 'melonds', 'desmume'], aliases: ['nds', 'ds', 'nintendo ds'], color: '#B4B4B4',
    standalone: [{ name: 'melonDS', exe: 'melonDS.exe', args: '"{rom}"' }] },
  { id: 'gc', name: 'GameCube', full: 'Nintendo GameCube', lr: 'Nintendo - GameCube', exts: ['iso', 'gcm', 'gcz', 'rvz', 'ciso'], cores: ['dolphin'], aliases: ['gc', 'gamecube', 'ngc', 'gcn'], color: '#6A5ACD', preferStandalone: true,
    standalone: [{ name: 'Dolphin', exe: 'Dolphin.exe', args: '-b -e "{rom}"' }] },
  { id: 'wii', name: 'Wii', full: 'Nintendo Wii', lr: 'Nintendo - Wii', exts: ['iso', 'wbfs', 'rvz', 'gcz', 'wad'], cores: ['dolphin'], aliases: ['wii'], color: '#34BEED', preferStandalone: true,
    standalone: [{ name: 'Dolphin', exe: 'Dolphin.exe', args: '-b -e "{rom}"' }] },
  { id: 'genesis', name: 'Genesis', full: 'Sega Genesis / Mega Drive', lr: 'Sega - Mega Drive - Genesis', exts: ['md', 'gen', 'smd', 'bin', 'zip', '7z'], cores: ['genesis_plus_gx', 'picodrive', 'blastem'], aliases: ['genesis', 'megadrive', 'mega drive', 'md', 'sega genesis'], color: '#1D1D1D' },
  { id: 'sms', name: 'Master System', full: 'Sega Master System', lr: 'Sega - Master System - Mark III', exts: ['sms', 'zip', '7z'], cores: ['genesis_plus_gx', 'picodrive'], aliases: ['sms', 'master system', 'mastersystem'], color: '#D52B1E' },
  { id: 'gg', name: 'Game Gear', full: 'Sega Game Gear', lr: 'Sega - Game Gear', exts: ['gg', 'zip', '7z'], cores: ['genesis_plus_gx', 'picodrive'], aliases: ['gg', 'game gear', 'gamegear'], color: '#2F2F2F' },
  { id: '32x', name: '32X', full: 'Sega 32X', lr: 'Sega - 32X', exts: ['32x', 'zip', '7z'], cores: ['picodrive'], aliases: ['32x', 'sega 32x'], color: '#E4002B' },
  { id: 'segacd', name: 'Sega CD', full: 'Sega CD / Mega-CD', lr: 'Sega - Mega-CD - Sega CD', exts: ['cue', 'chd', 'iso', 'm3u'], cores: ['genesis_plus_gx', 'picodrive'], aliases: ['segacd', 'sega cd', 'megacd', 'mega cd', 'mega-cd'], color: '#3A3A3A' },
  { id: 'saturn', name: 'Saturn', full: 'Sega Saturn', lr: 'Sega - Saturn', exts: ['cue', 'chd', 'iso', 'm3u', 'ccd'], cores: ['mednafen_saturn', 'yabasanshiro', 'kronos'], aliases: ['saturn', 'sega saturn'], color: '#4E5BA6' },
  { id: 'dreamcast', name: 'Dreamcast', full: 'Sega Dreamcast', lr: 'Sega - Dreamcast', exts: ['chd', 'gdi', 'cdi', 'cue', 'm3u'], cores: ['flycast'], aliases: ['dreamcast', 'dc', 'sega dreamcast'], color: '#F26722' },
  { id: 'psx', name: 'PS1', full: 'PlayStation', lr: 'Sony - PlayStation', exts: ['cue', 'chd', 'pbp', 'm3u', 'iso', 'ccd', 'img'], cores: ['swanstation', 'mednafen_psx_hw', 'mednafen_psx', 'pcsx_rearmed'], aliases: ['psx', 'ps1', 'playstation', 'playstation 1', 'sony playstation'], color: '#9B9B9B',
    standalone: [{ name: 'DuckStation', exe: 'duckstation-qt-x64-ReleaseLTCG.exe', args: '-batch -fullscreen -- "{rom}"' }] },
  { id: 'ps2', name: 'PS2', full: 'PlayStation 2', lr: 'Sony - PlayStation 2', exts: ['iso', 'chd', 'cso', 'gz'], cores: ['pcsx2'], aliases: ['ps2', 'playstation 2'], color: '#003791', preferStandalone: true,
    standalone: [{ name: 'PCSX2', exe: 'pcsx2-qt.exe', args: '-batch -fullscreen -- "{rom}"' }] },
  { id: 'psp', name: 'PSP', full: 'PlayStation Portable', lr: 'Sony - PlayStation Portable', exts: ['iso', 'cso', 'pbp', 'chd'], cores: ['ppsspp'], aliases: ['psp', 'playstation portable'], color: '#2C2C2C',
    standalone: [{ name: 'PPSSPP', exe: 'PPSSPPWindows64.exe', args: '--fullscreen "{rom}"' }] },
  { id: 'pce', name: 'TurboGrafx-16', full: 'TurboGrafx-16 / PC Engine', lr: 'NEC - PC Engine - TurboGrafx 16', exts: ['pce', 'zip', '7z'], cores: ['mednafen_pce_fast', 'mednafen_pce'], aliases: ['pce', 'pc engine', 'pcengine', 'turbografx', 'turbografx-16', 'tg16'], color: '#F39800' },
  { id: 'atari2600', name: 'Atari 2600', full: 'Atari 2600', lr: 'Atari - 2600', exts: ['a26', 'bin', 'zip', '7z'], cores: ['stella', 'stella2014'], aliases: ['atari2600', 'atari 2600', '2600', 'atari'], color: '#A0522D' },
  { id: 'arcade', name: 'Arcade', full: 'Arcade (FBNeo / MAME)', lr: 'FBNeo - Arcade Games', exts: ['zip', '7z'], cores: ['fbneo', 'mame2003_plus', 'mame'], aliases: ['arcade', 'mame', 'fbneo', 'fba', 'neogeo', 'neo geo', 'cps1', 'cps2', 'cps3'], color: '#FFCC00' },
];
const BY_ID = Object.fromEntries(SYSTEMS.map(s => [s.id, s]));

// Match a folder name ("SNES", "Super Nintendo", "Nintendo - Super Nintendo Entertainment System") to a system
function systemForFolder(name) {
  const n = name.toLowerCase().replace(/[_.]+/g, ' ').trim();
  const exact = SYSTEMS.find(s => s.lr.toLowerCase() === n || s.aliases.includes(n) || s.id === n || s.full.toLowerCase() === n);
  if (exact) return exact.id;
  const norm = P.normTitle(n);
  const loose = SYSTEMS.find(s => s.aliases.some(a => P.normTitle(a) === norm));
  return loose ? loose.id : null;
}

// Standalone emulators we can recognise by exe name (regex) + launch args
const STANDALONE = {
  nes: [[/^mesen\.exe$/i, '"{rom}"'], [/^nestopia\.exe$/i, '"{rom}"'], [/^fceux(64)?\.exe$/i, '"{rom}"']],
  snes: [[/^snes9x(-x64)?\.exe$/i, '-fullscreen "{rom}"'], [/^bsnes\.exe$/i, '--fullscreen "{rom}"'], [/^mesen\.exe$/i, '"{rom}"']],
  n64: [[/^project64\.exe$/i, '"{rom}"'], [/^simple64-gui\.exe$/i, '--nogui "{rom}"'], [/^rmg\.exe$/i, '-f "{rom}"']],
  gb: [[/^mgba\.exe$/i, '-f "{rom}"'], [/^sameboy\.exe$/i, '"{rom}"']],
  gbc: [[/^mgba\.exe$/i, '-f "{rom}"'], [/^sameboy\.exe$/i, '"{rom}"']],
  gba: [[/^mgba\.exe$/i, '-f "{rom}"'], [/^visualboyadvance(-m)?\.exe$/i, '"{rom}"']],
  nds: [[/^melonds\.exe$/i, '"{rom}"'], [/^desmume.*\.exe$/i, '"{rom}"']],
  genesis: [[/^fusion\.exe$/i, '"{rom}" -gen -fullscreen'], [/^blastem\.exe$/i, '-f "{rom}"']],
  sms: [[/^fusion\.exe$/i, '"{rom}" -sms -fullscreen']], gg: [[/^fusion\.exe$/i, '"{rom}" -gg -fullscreen']],
  segacd: [[/^fusion\.exe$/i, '"{rom}" -scd -fullscreen']], '32x': [[/^fusion\.exe$/i, '"{rom}" -32x -fullscreen']],
  gc: [[/^dolphin\.exe$/i, '-b -e "{rom}"']], wii: [[/^dolphin\.exe$/i, '-b -e "{rom}"']],
  psx: [[/^duckstation.*\.exe$/i, '-batch -fullscreen -- "{rom}"']], ps2: [[/^pcsx2.*\.exe$/i, '-batch -fullscreen -- "{rom}"']],
  psp: [[/^ppssppwindows64\.exe$/i, '--fullscreen "{rom}"'], [/^ppssppwindows\.exe$/i, '--fullscreen "{rom}"']],
  saturn: [[/^(yabasanshiro|kronos|mednafen)\.exe$/i, '"{rom}"']], dreamcast: [[/^flycast\.exe$/i, '"{rom}"']],
};
const SKIP_SEARCH = /^(roms?|iso|isos|saves?|states?|bios|screenshots|shaders|cheats|downloads|media|images|videos|manuals|\$recycle\.bin|system volume information)$/i;
// Look for exes near the ROM folders: each ancestor up to 4 levels up, searched 2 levels deep
function findExesNear(romFolders, nameRe, maxHits = 50) {
  const hits = []; const seen = new Set();
  const scan = (dir, depth) => {
    if (hits.length >= maxHits || seen.has(dir.toLowerCase())) return; seen.add(dir.toLowerCase());
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isFile() && nameRe.test(e.name)) hits.push(p);
      else if (e.isDirectory() && depth > 0 && !SKIP_SEARCH.test(e.name) && !e.name.startsWith('.')) scan(p, depth - 1);
    }
  };
  for (const f of romFolders) {
    let dir = f;
    for (let up = 0; up < 4; up++) { const parent = path.dirname(dir); if (!parent || parent === dir) break; dir = parent; scan(dir, 2); }
  }
  return hits;
}
// Returns { retroarch, cores, systems: { id: { exe, args } } }
function findEmulators(emu) {
  const allFolders = (emu.systems || []).flatMap(c => c.folders || []);
  let retroarch = emu.retroarchPath && fs.existsSync(emu.retroarchPath) ? emu.retroarchPath : detectRetroArch();
  if (!retroarch) retroarch = findExesNear(allFolders, /^retroarch\.exe$/i, 1)[0] || '';
  const systems = {};
  for (const c of emu.systems || []) {
    const pats = STANDALONE[c.id] || [];
    if (!pats.length) continue;
    const any = new RegExp(pats.map(([re]) => re.source).join('|'), 'i');
    const sysWords = [c.id, ...(BY_ID[c.id] ? BY_ID[c.id].aliases : [])].map(w => w.toLowerCase());
    const near = p => sysWords.some(w => p.toLowerCase().includes(w)) ? 1 : 0;
    const hits = findExesNear(c.folders || [], any).sort((a, b) => near(b) - near(a));
    for (const h of hits) { const m = pats.find(([re]) => re.test(path.basename(h))); if (m) { systems[c.id] = { exe: h, args: m[1] }; break; } }
  }
  return { retroarch, cores: listCores(retroarch), systems };
}

// ---------- RetroArch detection ----------
function retroarchCandidates() {
  const env = process.env;
  const home = env.USERPROFILE || require('os').homedir();
  const pf = env.ProgramFiles || 'C:\\Program Files', pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    'C:\\RetroArch-Win64\\retroarch.exe', 'C:\\RetroArch\\retroarch.exe',
    path.join(env.APPDATA || '', 'RetroArch', 'retroarch.exe'),
    path.join(pf, 'RetroArch', 'retroarch.exe'), path.join(pf86, 'RetroArch', 'retroarch.exe'),
    path.join(home, 'scoop', 'apps', 'retroarch', 'current', 'retroarch.exe'),
    path.join(pf86, 'Steam', 'steamapps', 'common', 'RetroArch', 'retroarch.exe'),
    path.join(env.LOCALAPPDATA || '', 'Programs', 'RetroArch', 'retroarch.exe'),
  ];
}
function detectRetroArch() {
  const found = retroarchCandidates().find(p => { try { return fs.existsSync(p); } catch { return false; } });
  return found || '';
}
function listCores(retroarchPath) {
  if (!retroarchPath) return [];
  const dir = path.join(path.dirname(retroarchPath), 'cores');
  try { return fs.readdirSync(dir).filter(f => /_libretro\.(dll|so|dylib)$/i.test(f)).map(f => f.replace(/_libretro\.(dll|so|dylib)$/i, '')).sort(); } catch { return []; }
}
function pickCore(sys, installed) {
  return sys.cores.find(c => installed.includes(c)) || null;
}

// ---------- ROM title cleanup (No-Intro / Redump naming) ----------
// Region tags: No-Intro "(USA)", "(Europe)", "(USA, Europe)"; TOSEC "(US)", "(EU)", "(JP)"; GoodTools "(U)", "(E)", "(J)"
const REGIONS = [
  ['USA', /^(usa|us|u|ue|ju|usa, europe|japan, usa|usa, japan|world|w)$/i],
  ['Europe', /^(europe|eu|e|uk|de|fr|es|it|nl|se|germany|france|spain|italy|sweden|netherlands|australia|au|a)$/i],
  ['Japan', /^(japan|jp|j|ja)$/i],
  ['China', /^(china|cn|ch)$/i], ['Korea', /^(korea|kr|k)$/i], ['Brazil', /^(brazil|br|b)$/i], ['Asia', /^(asia|as)$/i],
];
const BAD_FLAG = /\[(b|o|t|h|f|p|cr|m|tr|x)[\s\d+\-]*[^\]]*\]|\((hack|beta|proto|prototype|demo|sample|pirate|unl|unlicensed|bootleg|kiosk|debug)[^)]*\)/i;
function cleanRomTitle(file) {
  const base = P.stripExt(path.basename(file));
  const parens = [...base.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim());
  let region = null, regionFull = null, year = null;
  for (const p of parens) {
    if (!year && /^(19|20)[\dx]{2}/i.test(p)) { const y = parseInt(p, 10); if (y > 1970) year = y; continue; }
    if (!regionFull) {
      const first = p.split(/\s*,\s*/)[0];
      const hit = REGIONS.find(([, re]) => re.test(p) || re.test(first));
      if (hit) { region = p; regionFull = hit[0]; }
    }
  }
  const rawTitle = base.replace(/\s*[\[(].*$/, '').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim() || base;
  let title = rawTitle;
  const m = title.match(/^(.*), (The|A|An)( - .*)?$/i);
  if (m) title = `${m[2]} ${m[1]}${m[3] || ''}`;
  const verified = /\[!\]/.test(base), bad = BAD_FLAG.test(base), alt = /\[a\d*\]|\(alt[^)]*\)/i.test(base);
  // libretro thumbnails use No-Intro names: "Title (USA)". Build one from TOSEC/GoodTools names when needed.
  const isNoIntro = /\((USA|Europe|Japan|World|USA, Europe|Japan, USA|Korea|China|Brazil|Asia|Germany|France|Spain|Italy)[^)]*\)/.test(base) && !/\)\(/.test(base);
  const noIntro = isNoIntro ? base.replace(/\s*\[[^\]]*\]/g, '').trim() : `${rawTitle}${regionFull ? ` (${regionFull})` : ''}`;
  return { title: title || base, rawTitle, region: regionFull || region, year, verified, bad, alt, noIntro, variantLabel: base.slice(rawTitle.length).trim() || base };
}
function romScore(c) {
  let s = 0;
  if (!c.bad) s += 100;
  if (c.verified) s += 30;
  if (c.alt) s -= 5;
  s += { USA: 20, Europe: 10, Japan: 4 }[c.region] || 0;
  return s - c.variantLabel.length * 0.01;
}
// libretro-thumbnails replaces these characters with _
const lrName = s => s.replace(/[&*/:`<>?\\|"]/g, '_');
function boxartUrls(sys, noIntroName) {
  const base = `https://thumbnails.libretro.com/${encodeURIComponent(sys.lr)}`;
  const file = encodeURIComponent(lrName(noIntroName)) + '.png';
  return { poster: `${base}/Named_Boxarts/${file}`, fallback: `${base}/Named_Titles/${file}`, backdrop: `${base}/Named_Snaps/${file}` };
}

// ---------- collection zips ----------
const PACK_MIN = 24 * 1024 * 1024;
function packEntries(sys, rom) {
  if (!/\.zip$/i.test(rom) || sys.id === 'arcade') return null;
  let size = 0; try { size = fs.statSync(rom).size; } catch { return null; }
  if (size < PACK_MIN) return null;
  const romExts = new Set(sys.exts.filter(e => e !== 'zip' && e !== '7z').map(e => '.' + e));
  let z;
  try {
    z = openZip(rom);
    const list = z.entries.filter(e => !e.name.endsWith('/') && romExts.has(path.extname(e.name).toLowerCase()) && !/__MACOSX/.test(e.name));
    if (list.length > 1) return list.sort((a, b) => P.naturalCompare(a.name, b.name));
    // pack of zipped ROMs (zip inside zip): RetroArch loads the inner .zip directly
    const zipped = z.entries.filter(e => /\.(zip|7z)$/i.test(e.name) && sys.exts.includes(path.extname(e.name).slice(1).toLowerCase()));
    return zipped.length > 1 ? zipped.sort((a, b) => P.naturalCompare(a.name, b.name)) : null;
  } catch { return null; } finally { if (z) z.close(); }
}

// ---------- argument template ----------
function splitArgs(tpl, rom) {
  const out = []; let cur = '', q = false, had = false;
  for (const ch of String(tpl || '"{rom}"')) {
    if (ch === '"') { q = !q; had = true; continue; }
    if (/\s/.test(ch) && !q) { if (cur || had) out.push(cur); cur = ''; had = false; continue; }
    cur += ch;
  }
  if (cur || had) out.push(cur);
  return out.map(a => a.replace(/\{rom\}/g, rom).replace(/\{romdir\}/g, path.dirname(rom)).replace(/\{romname\}/g, P.stripExt(path.basename(rom))));
}

// ---------- scanning ----------
const DISC_RE = /\s*\((disc|disk|cd)\s*(\d+)[^)]*\)/i;
function scanSystemFolder(sys, folder) {
  const exts = new Set(sys.exts.map(e => '.' + e));
  const files = [];
  const walk = (dir, depth) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0 && !/^(bios|saves?|states?|media|images|snaps|boxart|manuals|videos|downloaded_images)$/i.test(e.name)) walk(p, depth - 1); }
      else if (exts.has(path.extname(e.name).toLowerCase())) files.push(p);
    }
  };
  walk(folder, 7);
  // disc-image hygiene: prefer .m3u, skip tracks referenced by .cue/.gdi, group multi-disc sets
  const byDir = new Map();
  for (const f of files) { const d = path.dirname(f); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(f); }
  const keep = [];
  for (const [, list] of byDir) {
    const m3u = list.filter(f => /\.m3u$/i.test(f));
    const covered = new Set();
    for (const m of m3u) {
      try { for (const line of fs.readFileSync(m, 'utf8').split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) covered.add(path.resolve(path.dirname(m), line.trim()).toLowerCase()); } catch {}
    }
    for (const c of list.filter(f => /\.(cue|gdi)$/i.test(f))) {
      try { for (const m of fs.readFileSync(c, 'utf8').matchAll(/FILE\s+"?([^"\r\n]+?)"?\s+(BINARY|MOTOROLA|WAVE|MP3)/gi)) covered.add(path.resolve(path.dirname(c), m[1]).toLowerCase()); } catch {}
      if (/\.gdi$/i.test(c)) try { for (const line of fs.readFileSync(c, 'utf8').split(/\r?\n/).slice(1)) { const t = line.trim().split(/\s+/)[4]; if (t) covered.add(path.resolve(path.dirname(c), t.replace(/"/g, '')).toLowerCase()); } } catch {}
    }
    const seenDisc = new Set(m3u.map(m => P.normTitle(P.stripExt(path.basename(m)).replace(DISC_RE, ''))));
    for (const f of list) {
      if (covered.has(path.resolve(f).toLowerCase())) continue;
      if (/\.bin$/i.test(f) && list.some(x => /\.cue$/i.test(x)) && !['genesis', 'atari2600'].includes(sys.id)) continue;
      if (!/\.m3u$/i.test(f) && DISC_RE.test(path.basename(f))) {
        const key = P.normTitle(P.stripExt(path.basename(f)).replace(DISC_RE, ''));
        const disc = parseInt(path.basename(f).match(DISC_RE)[2], 10);
        if (seenDisc.has(key) && disc !== 1) continue;
        if (disc !== 1 && list.some(x => x !== f && P.normTitle(P.stripExt(path.basename(x)).replace(DISC_RE, '')) === key && /\((disc|disk|cd)\s*1\b/i.test(x) && path.extname(x).toLowerCase() === path.extname(f).toLowerCase())) continue;
        seenDisc.add(key);
      }
      keep.push(f);
    }
  }
  return keep;
}

function scanEmulation(emu, opts = {}) {
  if (!emu || !emu.enabled) return [];
  const installedCores = listCores(emu.retroarchPath);
  const games = [];
  for (const conf of emu.systems || []) {
    const sys = BY_ID[conf.id];
    if (!sys) continue;
    const launcher = resolveLauncher(sys, conf, emu, installedCores);
    for (const folder of conf.folders || []) {
      for (const rom of scanSystemFolder(sys, folder)) {
        // A big .zip holding many ROMs (a "collection pack"): list each ROM inside as its own game
        const inner = packEntries(sys, rom);
        if (inner) {
          for (const entry of inner) {
            const base = path.basename(entry.name);
            const cr = cleanRomTitle(base);
            const { title, region, noIntro } = cr;
            const art = boxartUrls(sys, noIntro.replace(DISC_RE, '').trim());
            games.push({
              id: P.hashId('rom', rom + '#' + entry.name), title, source: 'emulator', sourceLabel: sys.name, system: sys.id, systemName: sys.full, region,
              _cr: cr, year: cr.year, genres: [sys.name], installed: true, romPath: rom + ' › ' + entry.name, installDir: path.dirname(rom), noIntro, inArchive: true,
              poster: art.poster, posterFallback: art.fallback, backdrop: art.backdrop, added: 0,
              emulatorLabel: launcher && !launcher.missing ? launcher.label : 'nothing yet (RetroArch isn\'t set up)',
              launch: launcher && !launcher.missing ? { type: 'romzip', zip: rom, entry: entry.name, size: entry.size, target: launcher.exe, args: launcher.args('{{ROM}}'), cwd: path.dirname(launcher.exe) }
                : { type: 'missing', error: `No emulator for ${sys.full} yet: RetroArch isn't set up. Go to Library Setup → Games → Emulation and click “Find emulators”.` },
            });
          }
          continue;
        }
        const cr = cleanRomTitle(rom.replace(DISC_RE, ''));
        const { title, region, noIntro } = cr;
        const art = boxartUrls(sys, noIntro.replace(DISC_RE, '').trim());
        let st = null; try { st = fs.statSync(rom); } catch {}
        games.push({
          id: P.hashId('rom', rom), title, source: 'emulator', sourceLabel: sys.name, system: sys.id, systemName: sys.full, region,
          _cr: cr, year: cr.year, genres: [sys.name], installed: true, romPath: rom, installDir: path.dirname(rom), noIntro,
          poster: art.poster, posterFallback: art.fallback, backdrop: art.backdrop, added: st ? st.mtimeMs : 0,
          emulatorLabel: launcher && !launcher.missing ? launcher.label : 'nothing yet (RetroArch isn\'t set up)',
          launch: launcher && !launcher.missing ? { type: 'exe', target: launcher.exe, args: launcher.args(rom), cwd: path.dirname(launcher.exe) }
            : { type: 'missing', error: `No emulator for ${sys.full} yet: RetroArch isn't set up. Go to Library Setup → Games → Emulation and click “Find emulators”, or choose a standalone emulator for ${sys.name}.` },
        });
      }
    }
  }
  return dedupeRoms(games);
}

// One entry per system + title: the best dump (verified, clean, US > EU > JP); the rest become "Other versions"
function dedupeRoms(games) {
  const groups = new Map();
  for (const g of games) {
    const k = g.system + '|' + P.normTitle(g.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => romScore(b._cr) - romScore(a._cr));
    const best = list[0];
    if (list.length > 1) best.variants = list.slice(1).map(v => ({ label: v._cr.variantLabel, region: v.region, bad: v._cr.bad, launch: v.launch, romPath: v.romPath }));
    for (const g of list) delete g._cr;
    out.push(best);
  }
  return out;
}

function resolveLauncher(sys, conf, emu, installedCores) {
  if (conf.emulator === 'custom' && conf.customExe) {
    return { exe: conf.customExe, label: path.basename(conf.customExe, '.exe'), args: rom => splitArgs(conf.customArgs || '"{rom}"', rom) };
  }
  if (!emu.retroarchPath) return { missing: true };
  const core = conf.core || pickCore(sys, installedCores) || sys.cores[0];
  const ra = emu.retroarchPath;
  return {
    exe: ra, label: 'RetroArch · ' + core,
    args: rom => [...(emu.fullscreen !== false ? ['-f'] : []), '-L', path.join(path.dirname(ra), 'cores', core + '_libretro.dll'), rom],
  };
}

// Given a root like D:\ROMs with subfolders named per system, return [{id, folder}]
function autoAssign(root) {
  const out = [];
  let ents = []; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  const self = systemForFolder(path.basename(root));
  if (self) return [{ id: self, folder: root }];
  for (const e of ents) if (e.isDirectory()) { const id = systemForFolder(e.name); if (id) out.push({ id, folder: path.join(root, e.name) }); }
  return out;
}

module.exports = { dedupeRoms, romScore, packEntries, findEmulators, findExesNear, STANDALONE, SYSTEMS, BY_ID, systemForFolder, detectRetroArch, listCores, pickCore, cleanRomTitle, boxartUrls, splitArgs, scanSystemFolder, scanEmulation, autoAssign, lrName };
