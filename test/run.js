// Run: node test/run.js   (creates a fake media tree in the OS temp folder and scans it)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const P = require('../lib/parse');
const { classify } = require('../lib/torbox');
const G = require('../lib/games');
const { Store } = require('../lib/store');
const { Library } = require('../lib/library');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };

// ---------- parsers ----------
t('movie basic', () => assert.deepStrictEqual(P.parseMovie('The.Matrix.1999.1080p.BluRay.x264-GRP.mkv'), { title: 'The Matrix', year: 1999 }));
t('movie year in title', () => assert.deepStrictEqual(P.parseMovie('2001.A.Space.Odyssey.1968.2160p.UHD.mkv'), { title: '2001 A Space Odyssey', year: 1968 }));
t('movie parens', () => assert.deepStrictEqual(P.parseMovie('Heat (1995).mkv'), { title: 'Heat', year: 1995 }));
t('movie no year', () => assert.strictEqual(P.parseMovie("Charlotte's Web.mp4").title, "Charlotte's Web"));
t('movie junk', () => assert.strictEqual(P.parseMovie('Dune Part Two 2024 2160p WEB-DL DDP5.1 Atmos.mkv').title, 'Dune Part Two'));
t('episode SxxEyy', () => { const e = P.parseEpisode('Breaking.Bad.S02E05.Breakage.720p.mkv'); assert.strictEqual(e.show, 'Breaking Bad'); assert.strictEqual(e.season, 2); assert.strictEqual(e.episode, 5); assert.strictEqual(e.epTitle, 'Breakage'); });
t('episode 1x02', () => { const e = P.parseEpisode('Firefly 1x02 The Train Job.avi'); assert.strictEqual(e.show, 'Firefly'); assert.strictEqual(e.episode, 2); });
t('episode folder show', () => { const e = P.parseEpisode('/tv/Severance (2022)/Season 1/S01E03.mkv'); assert.strictEqual(e.show, 'Severance'); });
t('episode show year', () => { const e = P.parseEpisode('Doctor.Who.2005.S01E01.Rose.mkv'); assert.strictEqual(e.show, 'Doctor Who'); assert.strictEqual(e.showYear, 2005); });
t('double episode', () => assert.strictEqual(P.parseEpisode('Show.S01E01E02.mkv').episodeEnd, 2));
t('music video', () => assert.deepStrictEqual(P.parseMusicVideo('Daft Punk - Around the World (Official Video).mp4'), { artist: 'Daft Punk', title: 'Around the World' }));
t('book', () => assert.deepStrictEqual(P.parseBook('Frank Herbert - Dune.epub'), { author: 'Frank Herbert', title: 'Dune' }));
t('normTitle', () => assert.strictEqual(P.normTitle('The Lord of the Rings: Fellowship'), P.normTitle('Lord of the Rings Fellowship')));

// ---------- torbox classification ----------
const tbf = (id, name, size) => ({ id, name: path.basename(name), path: name, size });
t('tb tv', () => assert.strictEqual(classify({ name: 'Show.S01.1080p', files: [tbf(1, 'Show.S01/Show.S01E01.mkv', 1e9), tbf(2, 'Show.S01/Show.S01E02.mkv', 1e9)] }).category, 'tv'));
t('tb movie + sample', () => { const r = classify({ name: 'Heat.1995.1080p', files: [tbf(1, 'Heat.1995.mkv', 9e9), tbf(2, 'sample.mkv', 5e7)] }); assert.strictEqual(r.category, 'movies'); assert.strictEqual(r.files.length, 1); });
t('tb game', () => assert.strictEqual(classify({ name: 'Some Game [FitGirl Repack]', files: [tbf(1, 'setup.exe', 5e6), tbf(2, 'data.bin', 4e9)] }).category, 'games'));
t('tb audiobook', () => assert.strictEqual(classify({ name: 'Author - Book', files: [tbf(1, 'Book.m4b', 3e8)] }).category, 'audiobooks'));
t('tb audiobook mp3 hint', () => assert.strictEqual(classify({ name: 'Andy Weir - Artemis (Unabridged)', files: [tbf(1, '01.mp3', 3e7), tbf(2, '02.mp3', 3e7)] }).category, 'audiobooks'));
t('tb audiobook chapters', () => assert.strictEqual(classify({ name: 'Dune', files: [tbf(1, 'Chapter 01.mp3', 3e7), tbf(2, 'Chapter 02.mp3', 3e7)] }).category, 'audiobooks'));
t('tb music album', () => assert.strictEqual(classify({ name: 'Radiohead - OK Computer (1997) [FLAC]', files: [tbf(1, '01 - Airbag.flac', 3e7), tbf(2, '02 - Paranoid Android.flac', 5e7)] }).category, 'music'));
t('album folder parse', () => assert.deepStrictEqual(require('../lib/scanner').parseAlbumFolder('Radiohead - OK Computer (1997) [FLAC]'), { artist: 'Radiohead', album: 'OK Computer', year: 1997 }));
t('track name parse', () => assert.deepStrictEqual(require('../lib/scanner').trackFromName('1-03 - Radiohead - Subterranean Homesick Alien.mp3'), { title: 'Subterranean Homesick Alien', track: 3, disc: 1 }));
t('tb book', () => assert.strictEqual(classify({ name: 'Dune', files: [tbf(1, 'Dune.epub', 1e6)] }).category, 'books'));
t('tb override', () => assert.strictEqual(classify({ name: 'Heat.1995', files: [tbf(1, 'Heat.mkv', 9e9)] }, 'musicvideos').category, 'musicvideos'));

// ---------- emulation ----------
const E = require('../lib/emulation');
t('sys folder names', () => { assert.strictEqual(E.systemForFolder('SNES'), 'snes'); assert.strictEqual(E.systemForFolder('Nintendo - Super Nintendo Entertainment System'), 'snes'); assert.strictEqual(E.systemForFolder('Mega Drive'), 'genesis'); assert.strictEqual(E.systemForFolder('psx'), 'psx'); assert.strictEqual(E.systemForFolder('PlayStation 2'), 'ps2'); assert.strictEqual(E.systemForFolder('Game Boy Advance'), 'gba'); assert.strictEqual(E.systemForFolder('Photos'), null); });
t('no-intro title', () => { const r = E.cleanRomTitle('Legend of Zelda, The - A Link to the Past (USA).sfc'); assert.strictEqual(r.title, 'The Legend of Zelda - A Link to the Past'); assert.strictEqual(r.region, 'USA'); });
t('rom title tags', () => assert.strictEqual(E.cleanRomTitle('Super Mario World (USA) [!] (Rev 1).smc').title, 'Super Mario World'));
t('libretro url', () => { const u = E.boxartUrls(E.BY_ID.snes, 'Mario & Luigi (USA)'); assert.strictEqual(u.poster, 'https://thumbnails.libretro.com/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/Named_Boxarts/Mario%20_%20Luigi%20(USA).png'); });
t('arg template', () => assert.deepStrictEqual(E.splitArgs('-b -e "{rom}"', 'D:\\ROMs\\GC\\Metroid Prime.rvz'), ['-b', '-e', 'D:\\ROMs\\GC\\Metroid Prime.rvz']));
t('arg template rom only', () => assert.deepStrictEqual(E.splitArgs('', 'C:\\a b.iso'), ['C:\\a b.iso']));

// ---------- launcher file formats ----------
t('vdf paths', () => assert.deepStrictEqual(G.parseVdfPaths('"libraryfolders"\n{\n "0"\n {\n  "path"  "C:\\\\Program Files (x86)\\\\Steam"\n }\n "1"\n {\n  "path"  "D:\\\\SteamLibrary"\n }\n}'), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']));
t('acf', () => { const a = G.parseAcf('"AppState"\n{\n "appid" "620"\n "name" "Portal 2"\n "installdir" "Portal 2"\n "LastPlayed" "1700000000"\n}'); assert.strictEqual(a.appid, '620'); assert.strictEqual(a.name, 'Portal 2'); });
t('reg parse', () => {
  const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924\r\n    gameName    REG_SZ    The Witcher 3\r\n    gameID    REG_SZ    1207658924\r\n    exe    REG_SZ    D:\\GOG\\Witcher 3\\bin\\x64\\witcher3.exe\r\n';
  const r = G.parseReg(out); const v = Object.values(r)[0]; assert.strictEqual(v.gameName, 'The Witcher 3'); assert.strictEqual(v.exe, 'D:\\GOG\\Witcher 3\\bin\\x64\\witcher3.exe');
});
t('slug', () => assert.strictEqual(G.slugify("Assassin's Creed® Valhalla"), 'assassins-creed-valhalla'));

// ---------- end-to-end scan of a fake tree ----------
(async () => {
  const root = path.join(os.tmpdir(), 'ol-fixture');
  fs.rmSync(root, { recursive: true, force: true });
  const mk = (rel, size = 1000) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); fs.truncateSync(p, size); return p; };
  const GB = 1.2e9;
  mk('Movies/Heat (1995)/Heat.1995.1080p.BluRay.x264.mkv', GB);
  mk('Movies/Heat (1995)/sample.mkv', 30e6);
  mk('Movies/The.Matrix.1999.2160p.UHD.BluRay.mkv', GB);
  mk('Movies/Blade Runner 2049 (2017)/movie.mkv', GB);
  mk('Movies/Extras/Making of.mkv', GB);
  mk('TV/Severance (2022)/Season 1/Severance.S01E01.Good.News.About.Hell.mkv', GB);
  mk('TV/Severance (2022)/Season 1/Severance.S01E02.Half.Loop.mkv', GB);
  mk('TV/Severance (2022)/Season 2/Severance.S02E01.mkv', GB);
  mk('TV/Firefly/Firefly 1x01 Serenity.avi', GB);
  mk('Music Videos/Daft Punk - Around the World (Official Video).mp4', 8e7);
  mk('Music Videos/Radiohead/Karma Police.mp4', 8e7);
  mk('Books/Frank Herbert - Dune.pdf', 2e6);
  mk('Audiobooks/Andy Weir/Project Hail Mary/01 - Chapter 1.mp3', 2e7);
  mk('Audiobooks/Andy Weir/Project Hail Mary/02 - Chapter 2.mp3', 2e7);
  mk('Audiobooks/Andy Weir/Project Hail Mary/cover.jpg', 100);
  mk('Audiobooks/The Martian.m4b', 3e8);
  mk('Music/Daft Punk/Discovery/03 - Digital Love.mp3', 5e6);
  mk('Music/Daft Punk/Discovery/01 - One More Time.mp3', 5e6);
  mk('Music/Daft Punk/Discovery/folder.jpg', 100);
  mk('Music/Pink Floyd - The Wall (1979)/CD1/01 - In the Flesh.mp3', 5e6);
  mk('Music/Pink Floyd - The Wall (1979)/CD2/01 - Hey You.mp3', 5e6);
  mk('Music/Tagged/x1.mp3', 1e5);
  mk('Music/Tagged/x2.mp3', 1e5);
  mk('Music/Lossless/a.flac', 10);
  mk('ROMs/SNES/Super Mario World (USA).sfc', 5e5);
  mk('ROMs/SNES/Legend of Zelda, The - A Link to the Past (USA).zip', 5e5);
  mk('ROMs/SNES/readme.txt', 10);
  mk('ROMs/PSX/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 1).chd', 5e8);
  mk('ROMs/PSX/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 2).chd', 5e8);
  mk('ROMs/PSX/Crash Bandicoot (USA)/Crash Bandicoot (USA).bin', 5e8);
  fs.writeFileSync(path.join(root, 'ROMs/PSX/Crash Bandicoot (USA)/Crash Bandicoot (USA).cue'), 'FILE "Crash Bandicoot (USA).bin" BINARY\n  TRACK 01 MODE2/2352\n');
  mk('ROMs/PSX/Metal Gear Solid (USA)/Metal Gear Solid (USA) (Disc 1).cue', 100);
  mk('ROMs/PSX/Metal Gear Solid (USA)/Metal Gear Solid (USA) (Disc 2).cue', 100);
  fs.writeFileSync(path.join(root, 'ROMs/PSX/Metal Gear Solid (USA)/Metal Gear Solid (USA).m3u'), 'Metal Gear Solid (USA) (Disc 1).cue\nMetal Gear Solid (USA) (Disc 2).cue\n');
  mk('ROMs/GameCube/Metroid Prime (USA).rvz', 1e9);
  mk('RetroArch/retroarch.exe', 1e6);
  mk('RetroArch/cores/snes9x_libretro.dll', 1e5);
  mk('RetroArch/cores/swanstation_libretro.dll', 1e5);
  mk('Games/Hollow Knight/hollow_knight.exe', 3e7);
  mk('Games/Hollow Knight/UnityCrashHandler64.exe', 1e6);
  mk('Games/Hollow Knight/unins000.exe', 1e6);
  mk('Games/Celeste/Celeste.exe', 2e7);
  mk('Games/Shortcut Game.url', 100);
  // real EPUB + CBZ built with python's zipfile
  const py = `
import zipfile,sys
root=sys.argv[1]
z=zipfile.ZipFile(root+'/Books/neuromancer.epub','w')
z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
z.writestr('META-INF/container.xml','<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/content.opf','<package><metadata><dc:title>Neuromancer</dc:title><dc:creator>William Gibson</dc:creator><dc:description>&lt;p&gt;The sky above the port...&lt;/p&gt;</dc:description><meta name="cover" content="cov"/></metadata><manifest><item id="cov" href="images/cover.jpg" media-type="image/jpeg"/></manifest></package>',compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/images/cover.jpg',b'\\xff\\xd8\\xff\\xe0FAKEJPEG'*50,compress_type=zipfile.ZIP_DEFLATED)
z.close()
c=zipfile.ZipFile(root+'/Books/Saga 001.cbz','w')
c.writestr('page002.png',b'PNG2'); c.writestr('page001.png',b'PNG1'); c.close()
`;
  fs.mkdirSync(path.join(root, 'Books'), { recursive: true });
  execFileSync('python3', ['-c', py, root]);
  const tagpy = `
import sys,struct
from mutagen.id3 import ID3,TIT2,TPE1,TPE2,TALB,TRCK,TDRC,TCON,APIC
r=sys.argv[1]+'/Music/'
for f,t,n in [('Tagged/x1.mp3','Teardrop','1/11'),('Tagged/x2.mp3','Angel','2/11')]:
    i=ID3(); i.add(APIC(encoding=3,mime='image/jpeg',type=3,desc='c',data=b'\\xff\\xd8'+b'J'*5000)); i.add(TIT2(encoding=1,text=t)); i.add(TPE1(encoding=3,text='Massive Attack')); i.add(TALB(encoding=3,text='Mezzanine')); i.add(TRCK(encoding=3,text=n)); i.add(TDRC(encoding=3,text='1998')); i.add(TCON(encoding=3,text='Trip Hop'))
    i.save(r+f, v2_version=(3 if t=='Teardrop' else 4))
def blk(t,data,last=False): return bytes([(0x80 if last else 0)|t])+len(data).to_bytes(3,'big')+data
vc=b''.join([struct.pack('<I',len(x))+x for x in [b'TITLE=So What',b'ARTIST=Miles Davis',b'ALBUM=Kind of Blue',b'TRACKNUMBER=1',b'DATE=1959-08-17']])
vc=struct.pack('<I',3)+b'ref'+struct.pack('<I',5)+vc
img=b'\\x89PNG'+b'P'*300
pic=struct.pack('>I',3)+struct.pack('>I',9)+b'image/png'+struct.pack('>I',0)+struct.pack('>IIII',1,1,24,0)+struct.pack('>I',len(img))+img
open(r+'Lossless/a.flac','wb').write(b'fLaC'+blk(0,b'\\0'*34)+blk(4,vc)+blk(6,pic,True))
`;
  execFileSync('python3', ['-c', tagpy, root]);

  const dataDir = path.join(os.tmpdir(), 'ol-data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  const store = new Store(dataDir);
  const cfg = store.getConfig();
  cfg.setupDone = true;
  cfg.categories.movies.folders = [path.join(root, 'Movies')];
  cfg.categories.tv.folders = [path.join(root, 'TV')];
  cfg.categories.musicvideos.folders = [path.join(root, 'Music Videos')];
  cfg.categories.books.folders = [path.join(root, 'Books')];
  cfg.categories.books.scraper = 'none';
  cfg.categories.audiobooks.folders = [path.join(root, 'Audiobooks')];
  cfg.categories.audiobooks.scraper = 'none';
  cfg.categories.games.folders = [path.join(root, 'Games')];
  cfg.categories.music.folders = [path.join(root, 'Music')];
  const auto = E.autoAssign(path.join(root, 'ROMs'));
  t('auto-assign ROM root', () => assert.deepStrictEqual(auto.map(a => a.id).sort(), ['gc', 'psx', 'snes']));
  cfg.categories.games.emulation = { enabled: true, retroarchPath: path.join(root, 'RetroArch', 'retroarch.exe'), fullscreen: true, systems: auto.map(a => ({ id: a.id, folders: [a.folder], emulator: a.id === 'gc' ? 'custom' : 'retroarch', customExe: a.id === 'gc' ? 'C:\\Dolphin\\Dolphin.exe' : '', customArgs: '-b -e "{rom}"' })) };
  cfg.categories.music.scraper = 'none';
  cfg.categories.music.services = [{ id: 'spotify' }, { id: 'applemusic' }];
  cfg.categories.movies.services = [{ id: 'netflix' }, { id: 'hbomax' }, { id: 'jellyfin', base: 'https://jellyfin.example.com' }];
  cfg.categories.tv.services = [{ id: 'netflix' }, { id: 'appletv' }];
  cfg.categories.musicvideos.services = [{ id: 'youtube' }];
  store.setConfig(cfg);

  const lib = await new Library(store).rescan();
  t('movies found', () => assert.deepStrictEqual(lib.movies.map(m => m.title + ' ' + m.year).sort(), ['Blade Runner 2049 2017', 'Heat 1995', 'The Matrix 1999']));
  t('tv grouped', () => { const s = lib.tv.find(x => x.title === 'Severance'); assert.strictEqual(s.episodes.length, 3); assert.strictEqual(s.year, 2022); assert.ok(lib.tv.find(x => x.title === 'Firefly')); });
  t('music videos', () => assert.deepStrictEqual(lib.musicvideos.map(m => m.artist + '|' + m.title).sort(), ['Daft Punk|Around the World', 'Radiohead|Karma Police']));
  t('epub metadata + cover', () => { const b = lib.books.find(x => x.title === 'Neuromancer'); assert.strictEqual(b.author, 'William Gibson'); assert.ok(b.poster && b.poster.startsWith('file:')); assert.strictEqual(b.overview, 'The sky above the port...'); });
  t('cbz cover', () => { const b = lib.books.find(x => x.format === 'CBZ'); assert.ok(b.poster); assert.ok(fs.readFileSync(new URL(b.poster)).toString() === 'PNG1'); });
  t('pdf by filename', () => assert.ok(lib.books.find(x => x.title === 'Dune' && x.author === 'Frank Herbert')));
  t('audiobook folder', () => { const a = lib.audiobooks.find(x => x.title === 'Project Hail Mary'); assert.strictEqual(a.author, 'Andy Weir'); assert.strictEqual(a.files.length, 2); assert.ok(a.poster); });
  t('audiobook m4b', () => assert.ok(lib.audiobooks.find(x => x.title === 'The Martian')));
  t('music folder album', () => { const a = lib.music.find(x => x.title === 'Discovery'); assert.strictEqual(a.artist, 'Daft Punk'); assert.deepStrictEqual(a.files.map(f => f.title), ['One More Time', 'Digital Love']); assert.ok(a.poster.endsWith('folder.jpg')); });
  t('music multi-disc', () => { const a = lib.music.find(x => x.title === 'The Wall'); assert.strictEqual(a.artist, 'Pink Floyd'); assert.strictEqual(a.year, 1979); assert.strictEqual(a.files.length, 2); });
  t('music id3 tags + art', () => { const a = lib.music.find(x => x.title === 'Mezzanine'); assert.ok(a, JSON.stringify(lib.music.map(m => m.title))); assert.strictEqual(a.artist, 'Massive Attack'); assert.strictEqual(a.year, 1998); assert.deepStrictEqual(a.files.map(f => f.title), ['Teardrop', 'Angel']); assert.deepStrictEqual(a.genres, ['Trip Hop']); assert.ok(a.poster && a.poster.includes('cache')); assert.ok(fs.readFileSync(new URL(a.poster)).length === 5002); });
  t('music flac tags + art', () => { const a = lib.music.find(x => x.title === 'Kind of Blue'); assert.ok(a); assert.strictEqual(a.artist, 'Miles Davis'); assert.strictEqual(a.year, 1959); assert.strictEqual(a.files[0].title, 'So What'); assert.ok(fs.readFileSync(new URL(a.poster)).slice(1, 4).toString() === 'PNG'); });
  const roms = lib.games.filter(g => g.source === 'emulator');
  t('rom titles', () => assert.deepStrictEqual(roms.map(g => g.title).sort(), ['Crash Bandicoot', 'Final Fantasy VII', 'Metal Gear Solid', 'Metroid Prime', 'Super Mario World', 'The Legend of Zelda - A Link to the Past']));
  t('rom multi-disc uses m3u / disc 1', () => { assert.ok(roms.find(g => g.title === 'Metal Gear Solid').romPath.endsWith('.m3u')); assert.ok(roms.find(g => g.title === 'Final Fantasy VII').romPath.includes('(Disc 1)')); });
  t('rom cue not bin', () => assert.ok(roms.find(g => g.title === 'Crash Bandicoot').romPath.endsWith('.cue')));
  t('retroarch launch picks installed core', () => { const g = roms.find(g => g.title === 'Super Mario World'); assert.deepStrictEqual(g.launch.args.slice(0, 2), ['-f', '-L']); assert.ok(g.launch.args[2].endsWith('snes9x_libretro.dll')); assert.strictEqual(g.genres[0], 'SNES'); });
  t('psx core', () => assert.ok(roms.find(g => g.title === 'Crash Bandicoot').launch.args[2].endsWith('swanstation_libretro.dll')));
  t('standalone launch', () => { const g = roms.find(g => g.title === 'Metroid Prime'); assert.strictEqual(g.launch.target, 'C:\\Dolphin\\Dolphin.exe'); assert.deepStrictEqual(g.launch.args.slice(0, 2), ['-b', '-e']); });
  // emulator discovery near ROM folders (mirrors a NAS layout: Emulation\SNES\ROMS\ISO)
  const emuRoot = path.join(root, 'Emulation');
  mk('Emulation/SNES/ROMS/ISO/Aero the Acro-bat.smc', 1e5);
  mk('Emulation/SNES/Snes9x/snes9x-x64.exe', 1e6);
  mk('Emulation/N64/Project64 3.0/Project64.exe', 1e6);
  mk('Emulation/N64/Mario Kart 64.z64', 1e6);
  mk('Emulation/GBA/ROMS/Metroid Fusion.gba', 1e5);
  const sysConf = id => ({ id, folders: [path.join(emuRoot, ...({ snes: ['SNES', 'ROMS', 'ISO'], n64: ['N64'], gba: ['GBA', 'ROMS'] }[id]))], emulator: 'retroarch' });
  let found = E.findEmulators({ retroarchPath: '', systems: ['snes', 'n64', 'gba'].map(sysConf) });
  t('find standalone near roms', () => { assert.ok(found.systems.snes.exe.endsWith('snes9x-x64.exe')); assert.strictEqual(found.systems.snes.args, '-fullscreen "{rom}"'); assert.ok(found.systems.n64.exe.endsWith('Project64.exe')); assert.ok(!found.systems.gba); assert.ok(found.retroarch.endsWith('retroarch.exe')); });
  mk('Emulation/RetroArch/retroarch.exe', 1e6);
  mk('Emulation/RetroArch/cores/mgba_libretro.dll', 1e5);
  found = E.findEmulators({ retroarchPath: '', systems: ['gba'].map(sysConf) });
  t('find retroarch near roms', () => { assert.ok(found.retroarch.endsWith(path.join('RetroArch', 'retroarch.exe'))); assert.deepStrictEqual(found.cores, ['mgba']); });
  t('missing retroarch message', () => { const g = E.scanEmulation({ enabled: true, retroarchPath: '', systems: [sysConf('snes')] })[0]; assert.strictEqual(g.launch.type, 'missing'); assert.ok(/RetroArch isn't set up/.test(g.launch.error)); });
  // collection zip (N64 pack) incl. ZIP64
  const n64dir = path.join(root, 'ROMs64', 'N64'); fs.mkdirSync(n64dir, { recursive: true });
  execFileSync('python3', ['-c', `
import zipfile,os,sys
d=sys.argv[1]
os.makedirs(d+'/src/Nintendo 64 - Games',exist_ok=True)
for n in ['Super Mario 64 (USA).z64','GoldenEye 007 (USA).z64','Legend of Zelda, The - Ocarina of Time (USA).z64']:
    open(d+'/src/Nintendo 64 - Games/'+n,'wb').write(os.urandom(9*1024*1024))
open(d+'/src/Nintendo 64 - Games/readme.txt','w').write('hi')
`, n64dir]);
  execFileSync('zip', ['-q', '-r', '-fz', path.join(n64dir, 'Nintendo 64 - Games.zip'), 'Nintendo 64 - Games'], { cwd: path.join(n64dir, 'src') });
  fs.renameSync(path.join(n64dir, 'src'), path.join(root, 'n64src'));
  const packGames = E.scanEmulation({ enabled: true, retroarchPath: path.join(root, 'RetroArch', 'retroarch.exe'), systems: [{ id: 'n64', folders: [n64dir], emulator: 'retroarch' }] });
  t('zip64 pack expands to games', () => assert.deepStrictEqual(packGames.map(g => g.title).sort(), ['GoldenEye 007', 'Super Mario 64', 'The Legend of Zelda - Ocarina of Time']));
  t('pack launch type', () => { const g = packGames.find(g => g.title === 'Super Mario 64'); assert.strictEqual(g.launch.type, 'romzip'); assert.strictEqual(g.launch.args[g.launch.args.length - 1], '{{ROM}}'); assert.ok(g.launch.args[2].endsWith('mupen64plus_next_libretro.dll')); });
  const { Launcher } = require('../lib/launcher');
  const L = new Launcher({ app: { getPath: () => path.join(os.tmpdir(), 'ol-data') }, getConfig: () => ({ player: {} }) });
  const g64 = packGames.find(g => g.title === 'GoldenEye 007');
  const out = await L.extractRom(g64.launch.zip, g64.launch.entry, g64.launch.size);
  t('extract from zip64 pack', () => assert.deepStrictEqual(fs.readFileSync(out), fs.readFileSync(path.join(root, 'n64src', 'Nintendo 64 - Games', 'GoldenEye 007 (USA).z64'))));
  // deflated (compressible) pack too
  execFileSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
for i in range(3): z.writestr('Game %d (USA).z64'%i, (b'N64ROM%d'%i)*3000000)
z.close()`, path.join(root, 'n64deflate.zip')]);
  const zd = require('../lib/zipmini').openZip(path.join(root, 'n64deflate.zip')); const e1 = zd.entries[1]; zd.close();
  const out2 = await L.extractRom(path.join(root, 'n64deflate.zip'), e1.name, e1.size);
  t('extract deflated entry', () => { const b = fs.readFileSync(out2); assert.strictEqual(b.length, 21000000); assert.ok(b.slice(0, 7).toString() === 'N64ROM1'); });
  execFileSync('python3', ['-c', `
import zipfile,sys,io,os
outer=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_STORED)
for n in ['Mario Kart 64 (USA)','Star Fox 64 (USA)']:
    b=io.BytesIO(); zi=zipfile.ZipFile(b,'w'); zi.writestr(n+'.z64', os.urandom(13*1024*1024)); zi.close(); outer.writestr(n+'.zip', b.getvalue())
outer.close()`, path.join(root, 'nested', 'N64 pack.zip').replace(/^/, '') ].map(x => x), { shell: false, env: process.env, cwd: (fs.mkdirSync(path.join(root, 'nested'), { recursive: true }), root) });
  const nested = E.scanEmulation({ enabled: true, retroarchPath: path.join(root, 'RetroArch', 'retroarch.exe'), systems: [{ id: 'n64', folders: [path.join(root, 'nested')], emulator: 'retroarch' }] });
  t('nested zip pack', () => assert.deepStrictEqual(nested.map(g => g.title).sort(), ['Mario Kart 64', 'Star Fox 64']));
  // TOSEC-named N64 set, nested deep, many variants
  for (const n of ["Yoshi's Story (1998)(Nintendo)(US)(en-ja)", "Yoshi's Story (1998)(Nintendo)(US)(en-ja)[a2]", "Yoshi's Story (1998)(Nintendo)(US)(en-ja)[b1]", "Yoshi's Story (1998)(Nintendo)(EU)(M3)", "Yoshi's Story (1998)(Nintendo)(US)(en-ja)[t1]",
                   "Legend of Zelda, The - Ocarina of Time (1998)(Nintendo)(US)(v1.2)", "Legend of Zelda, The - Ocarina of Time (1998)(Nintendo)(US)(v1.0)[!]", "Zelda no Densetsu - Toki no Ocarina (1998)(Nintendo)(JP)"])
    mk(`TOSEC/N64/Nintendo 64 - Games/[Z64]/Games/${n}.z64`, 1e5);
  const tosec = E.scanEmulation({ enabled: true, retroarchPath: path.join(root, 'RetroArch', 'retroarch.exe'), systems: [{ id: 'n64', folders: [path.join(root, 'TOSEC', 'N64')], emulator: 'retroarch' }] });
  t('tosec deep scan + dedupe', () => assert.deepStrictEqual(tosec.map(g => g.title).sort(), ['The Legend of Zelda - Ocarina of Time', "Yoshi's Story", 'Zelda no Densetsu - Toki no Ocarina']));
  t('tosec best variant', () => { const y = tosec.find(g => g.title === "Yoshi's Story"); assert.ok(y.romPath.endsWith('(US)(en-ja).z64'), y.romPath); assert.strictEqual(y.region, 'USA'); assert.strictEqual(y.year, 1998); assert.strictEqual(y.variants.length, 4); assert.ok(y.variants.find(v => v.label.includes('[b1]')).bad); });
  t('tosec verified wins', () => assert.ok(tosec.find(g => g.title.startsWith('The Legend')).romPath.includes('[!]')));
  t('tosec boxart name', () => assert.ok(tosec.find(g => g.title === "Yoshi's Story").poster.endsWith(encodeURIComponent("Yoshi's Story (USA)") + '.png')));
  t('no-intro boxart keeps name', () => assert.strictEqual(E.cleanRomTitle('Super Mario World (USA) [!].sfc').noIntro, 'Super Mario World (USA)'));
  t('goodtools region', () => assert.strictEqual(E.cleanRomTitle('Super Mario 64 (U) [!].z64').region, 'USA'));
  mk("BinN64/N64/Games/Yoshi's Story (1998)(Nintendo)(US)(en-ja).bin", 1e5);
  mk("BinN64/N64/Games/Yoshi's Story (1998)(Nintendo)(EU)(M3).bin", 1e5);
  mk("BinN64/N64/Games/Yuke Yuke!! Trouble Makers (1997)(Enix)(JP).bin", 1e5);
  const binN64 = E.scanEmulation({ enabled: true, retroarchPath: path.join(root, 'RetroArch', 'retroarch.exe'), systems: [{ id: 'n64', folders: [path.join(root, 'BinN64', 'N64')], emulator: 'retroarch' }] });
  t('n64 .bin roms', () => { assert.deepStrictEqual(binN64.map(g => g.title).sort(), ["Yoshi's Story", 'Yuke Yuke!! Trouble Makers']); assert.ok(binN64.find(g => g.title === "Yoshi's Story").romPath.endsWith('(US)(en-ja).bin')); });
  t('games folder', () => {
    const hk = lib.games.find(g => g.title === 'Hollow Knight');
    assert.ok(hk.launch.target.endsWith('hollow_knight.exe'), hk.launch.target);
    assert.ok(lib.games.find(g => g.title === 'Celeste'));
    assert.ok(lib.games.find(g => g.title === 'Shortcut Game' && g.launch.type === 'open'));
  });
  console.log(`${pass} checks passed${process.exitCode ? ' (with failures)' : ''}`);
  fs.writeFileSync(path.join(__dirname, 'fixture-library.json'), JSON.stringify(lib, null, 1));
  fs.writeFileSync(path.join(__dirname, 'fixture-config.json'), JSON.stringify(store.getConfig(), null, 1));
})();
