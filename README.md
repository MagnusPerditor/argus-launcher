# OmniLauncher

All-in-one media launcher for Windows: **Movies, TV, Music, Music Videos, Books, Audiobooks and Games** in one library.

## Run it

**Portable:** unzip `OmniLauncher-portable-win-x64.zip` anywhere and run `OmniLauncher.exe`.

**Installer / from source** (needs Node.js 20+):

```
npm install
npm start            # run in dev
npm run dist         # builds dist\OmniLauncher Setup 1.0.0.exe (NSIS installer)
npm test             # parser + scanner tests
```

## First run → Library Setup

The app opens on **Library Setup**. Tabs:

| Tab | What you set |
|---|---|
| **General** | API keys (TMDB, OMDb, TorBox, SteamGridDB) with *Test* buttons, video player (Windows default / VLC / mpv / built-in, with auto-detect), region |
| **Movies / TV Shows** | Folders, scraper (TMDB / OMDb / none), streaming services, TorBox on/off |
| **Music** | Folders, MusicBrainz album-art lookup, music services (Spotify, Apple Music, YouTube Music, Amazon Music, TIDAL, Deezer, SoundCloud, Pandora, Plex, Jellyfin), TorBox |
| **Music Videos** | Folders, IMVDb lookup (stills, year, director, official YouTube link; free app key), music-video services (YouTube, YouTube Music, Apple Music, TIDAL, Spotify, Vevo, Plex, Jellyfin), TorBox |
| **Books / Audiobooks** | Folders, Open Library cover lookup, TorBox |
| **Games** | Scan this PC (Steam, Epic, GOG, Xbox app/MS Store, Ubisoft), game folders, Xbox Game Pass (PC + Cloud catalogs), PlayStation Plus, manual games, SteamGridDB art, TorBox |

Hit **Save & Scan**. The library rescans on its own when it's more than 6 hours old, or use *Rescan library*.

## How things work

- **Scrapers:** TMDB gives posters, backdrops, ratings, cast, episode titles/stills and *where it's streaming* in your region. OMDb is the alternative/fallback. Results are cached (14 days; misses retried after 3).
- **Streaming services:** Each movie/show shows **Streaming on your services** (matched from TMDB/JustWatch data) with a button that opens that service's search for the title, plus search buttons for your other services. Plex and Jellyfin take your server URL; you can add custom services (home URL + search URL with `{q}`).
- **TorBox:** Torrents, usenet and web downloads are classified automatically (S01E02 names → TV, other video → Movies, M4B or “audiobook / unabridged / chapter” audio → Audiobooks, other audio → Music, EPUB/PDF → Books, repacks/ISOs/installers → Games). Wrong guess? Use *Move this TorBox item to…* on the detail page. Videos stream to VLC/mpv (or the built-in player); books download to `Downloads\OmniLauncher` and open; audiobooks stream in the built-in player; games open the download link.
- **Games:** the Games page opens on collection tiles (PC Library, Game Pass, Cloud Gaming, PS Plus, TorBox, and one per retro system), each a collage of its own box art with a count. Pick one to browse it with its own filter box, launcher chips (PC) and sorting; ‹ or B goes back.
  - Steam → `steam://rungameid`, Epic → launcher URI, GOG → Galaxy (or the exe directly), Ubisoft → `uplay://`, Xbox app games → their AppX ID.
  - **Game Pass:** the live PC + Cloud catalogs for your region. Installed ones launch directly; others offer *Install in Xbox app* and/or *Play in Cloud* (default browser or an OmniLauncher window; F11 = fullscreen).
  - **PS Plus:** Sony has no public catalog or per-game launch links, so you add the titles you play; each opens the PlayStation Plus PC app. *Auto-detect* finds the app.
  - **Emulation / retro games:** Library Setup → Games → Emulation. *Auto-detect* finds RetroArch (C:\RetroArch-Win64, AppData, Program Files, Scoop, Steam). *Add ROM folder* matches folders named after systems (`SNES`, `Mega Drive`, `PS1`, or the full libretro names), and a parent folder with one subfolder per system is split automatically. Each system plays through a RetroArch core (installed ones are marked ✓) or a standalone emulator with an argument template (`{rom}`; presets for Dolphin, PCSX2, DuckStation, PPSSPP, melonDS, Project64). Supported: NES, SNES, N64, GB/GBC/GBA, DS, GameCube, Wii, Genesis, Master System, Game Gear, 32X, Sega CD, Saturn, Dreamcast, PS1, PS2, PSP, TurboGrafx-16, Atari 2600, Arcade. Multi-disc games collapse to one entry (`.m3u` preferred, else Disc 1), and `.bin` tracks behind a `.cue` are hidden. Box art comes from the libretro thumbnail server and matches No-Intro/Redump file names. Use the **Retro** filter and the **All systems** dropdown on the Games page.
  - **Game folders:** each subfolder = one game (main .exe picked automatically; installers, redists and crash handlers skipped). A folder of `.lnk`/`.url` shortcuts also works.
- **Music:** albums are built from MP3 (ID3) and FLAC tags, falling back to `Artist\Album\01 - Track` folder names; CD1/CD2 folders merge into one album. Art comes from cover.jpg/folder.jpg, embedded art, then MusicBrainz / Cover Art Archive. Plays in the built-in player with a queue and shuffle.
- **Audiobooks:** built-in player with resume position, speed control, ±30 s and track skipping.

## Controller / couch mode

Pick up a controller (Xbox, PlayStation, or most others Windows sees) and OmniLauncher switches to **couch mode**: full screen, scaled up, cursor hidden, with a button legend along the bottom. Toggle it with **Start/☰** or **F10**. Options are in Library Setup → General (start in couch mode, auto-switch on controller, 100–175% size).

| Button | Action |
|---|---|
| D-pad / left stick | Move |
| A | Select (cycles dropdowns) |
| B | Back: closes the detail page, jumps to the sidebar, then Home |
| X | Play (main button on a detail page; play/pause music & audiobooks) |
| Y | Search with the on-screen keyboard (X delete, Y space) |
| LB / RB | Previous / next category |
| LT / RT | Scroll a page |
| View / Back | Library Setup |
| Start / ☰ | Toggle couch mode |

Input is ignored while another window (a game, VLC) has focus. Arrow keys + Enter + Esc navigate the same way on a keyboard.

## Naming tips

- Movies: `Heat (1995)\Heat.1995.1080p.mkv` or `The.Matrix.1999.mkv`
- TV: `Show\Season 1\Show.S01E02.mkv` (also `1x02`)
- Music videos: `Artist - Title.mp4`, or artist folders
- Audiobooks: `Author\Title\01.mp3 …` or `Title.m4b`
- Books: Calibre libraries work as-is; EPUB title/author/cover are read from the file.

## Data

Settings, library cache and covers live in `%APPDATA%\OmniLauncher` (`config.json`, `library.json`, `metacache.json`, `state.json`, `cache\`). Delete `library.json` + `metacache.json` to force a clean rescan.

## Files

```
main.js            Electron main + IPC
preload.js         Safe bridge (window.api)
lib/parse.js       Filename parsing (movies, episodes, music videos, books)
lib/scanner.js     Local folder scanners (+ EPUB/CBZ covers via lib/zipmini.js; audio tags via lib/tags.js)
lib/scrapers.js    TMDB, OMDb, Open Library, SteamGridDB
lib/torbox.js      TorBox API + classification
lib/games.js       Steam/Epic/GOG/Ubisoft/Xbox scanners, Game Pass catalog, PS Plus detection
lib/library.js     Builds/merges/caches the library
lib/launcher.js    Playback + game launching
lib/services.js    Streaming service list (edit to add your own defaults)
renderer/          UI (index.html) and built-in video player
```

## Installing & updates

Download **OmniLauncher-Setup-x.y.z.exe** from [Releases](https://github.com/MagnusPerditor/omnilauncher/releases) and run it. It installs per-user (no admin prompt) to `%LOCALAPPDATA%\Programs\OmniLauncher`; your settings in `%APPDATA%\OmniLauncher` carry over from the portable version.

Installed copies check for updates at startup and every 6 hours, download them in the background, and install when you close the app (or right away via **Restart & install** in Library Setup → General, or the button in the sidebar). The portable zip doesn't auto-update.

### Publishing a new version

1. Bump `"version"` in `package.json` (e.g. `1.1.0` → `1.2.0`) and commit.
2. Tag and push: `git tag v1.2.0 && git push origin main v1.2.0`
3. GitHub Actions (`.github/workflows/release.yml`) builds the installer on Windows, runs the tests, and publishes the Release. Everyone's copy updates itself.
