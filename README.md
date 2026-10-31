# Apple Music Lyrics for YouTube Music

A full Apple Music-style time-synced lyrics experience for YouTube Music, powered by the multi-source lyrics racing engine from [BitChord](https://github.com/kushagrasinghx/BitChord).

---

## 🌟 Key Features

### 🍎 Authentic Apple Music Experience & Default Tab View
- **Embedded in YouTube Music's Default "Lyrics" Tab**: The native static / "Lyrics not available" text in the player's Lyrics tab is replaced with fluid, animated Apple Music-style synced lyrics that respond directly to playback!
- **Dedicated Full Lyrics Page**: Press <kbd>L</kbd> or click the toolbar button for an expansive, full-screen view with album artwork, high-resolution metadata, and live fluid canvas backdrop.
- **Dynamic Fluid Mesh Gradient Backdrop**: Samples live colors from the album art and paints an animated, breathing fluid canvas mesh backdrop with organic drift and deep contrast scrim (ported from BitChord's `ArtworkMeshBackdrop.kt`).
- **Word & Syllable-Level Karaoke Lift**: Words rise and illuminate with bloom and glow when sung (`translateY(-3px)`, cubic-hermite easing). Held notes bloom and expand!
- **Interactive Click-to-Seek**: Click on **any lyric line** to immediately seek playback to that exact point in the track (`video.currentTime = line.timeMs / 1000`).
- **Progressive Depth-of-Field Blur**: Inactive lines exhibit subtle Apple Music focus blur and opacity falloff, keeping your visual focus on the active vocal line.
- **Backing / Answering Vocals**: Subordinate vocals (e.g. `(answering phrase)`) render tucked under the lead line in a secondary italic font on their own timing clock.
- **Duet Left/Right Alternation**: When multiple voices are present (`ttm:agent="v1"` / `v2`), lines alternate between Left and Right columns.
- **Instrumental Interludes**: Automatic countdown breathing dots pulse during instrumental breaks ($\ge 4\text{s}$).
- **Manual Scroll Override & Resume Sync**: Scrolling manually temporarily pauses auto-scroll and displays a `⟳ Resume Sync` button.
- **Timing Offset Adjuster**: Easily nudge lyrics by $\pm 0.2\text{s}$ or reset if the video cut has an intro.
- **On-the-Fly Source Switcher**: View and switch between all discovered lyric sources for the current track.

---

## 🚀 Multi-Source Racing Engine (All 13 BitChord Providers)

The extension fires concurrent parallel requests across all 13 BitChord lyric providers and automatically selects the highest-fidelity, word-synced document:

| # | Source | Type | Details |
|---|---|---|---|
| 1 | **lrc.red** | Apple Music TTML | High-fidelity Apple Music TTML synced by recording ISRC / title search (`lrc.red`) |
| 2 | **BiniLyrics** | Apple Music TTML | Word/syllable timing with recording ISRC identification (`lyrics-api.binimum.org`) |
| 3 | **BetterLyrics** | Apple Music TTML | Syllable-timed Apple Music TTML via boidu.dev |
| 4 | **BetterLyrics Portato** | QQ Karaoke | QQ Music word-timed karaoke format |
| 5 | **PaxSenix** | Apple Music timings | Apple Music syllable timings via PaxSenix proxy |
| 6 | **LyricsPlus** | Syllable-timed | YouLy+ backend racing across volunteer mirrors with voice agent tracking |
| 7 | **SimpMusic** | RichSync / LRC | Keyed directly by YouTube video ID so it matches the exact video audio cut |
| 8 | **Unison** | Crowdsourced TTML / Enhanced LRC | Community crowdsourced syllable timings |
| 9 | **KuGou** | Synced LRC | Fast line-synced lyrics with automated credit stripping & instrumental filtering |
| 10 | **LRCLIB** | Synced LRC | High-availability line-synced community database with duration matching |
| 11 | **Musixmatch** | RichSync / Subtitles | Musixmatch RichSync word timings and line subtitles |
| 12 | **Genius** | Plain text | Web catalogue lyrics fallback |
| 13 | **YouTube Music** | Plain text | Native YouTube Music tab text fallback |

### Smart Query Sanitization
Strips channel packaging (`(Official Music Video)`, `(Lyric Video)`, `HD`, `4K`, `(feat. ...)`) and `" - Topic"` suffixes while **preserving** recording markers (`(Remix)`, `(Live)`, `(Acoustic)`, `(Sped Up)`) to guarantee exact audio matching.

---

## 📦 How to Install & Reload

1. Open Google Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle switch)
3. Click **Load unpacked** (or click the reload icon if already loaded)
4. Select the directory:
   ```
   c:\Users\Aneesh\Documents\Projects\yt-music-better
   ```
5. Navigate to [music.youtube.com](https://music.youtube.com) and refresh the page.
6. Play any song — the default **Lyrics** tab will display synced Apple Music lyrics, or press **`L`** / click the player bar icon for full screen!

---

## 📁 Architecture

```
yt-music-better/
├── manifest.json              # Manifest V3 (Main world bridge + isolated scripts + service worker)
├── src/
│   ├── main-world-bridge.js   # Runs in page execution world; hooks #movie_player & mediaSession
│   ├── models.js              # LyricWord, LyricLine, background vocal splitting, gap detection, duet logic
│   ├── ttml-parser.js         # Apple Music TTML parser & serializer (agents, syllables, x-bg)
│   ├── lrc-parser.js          # Enhanced LRC, Karaoke LRC, Standard LRC, and Plain parser
│   ├── sources.js             # All 13 BitChord provider fetchers & query sanitizers
│   ├── lyrics-repository.js   # Concurrent racing engine & LRU cache
│   ├── mesh-backdrop.js       # Animated fluid canvas mesh gradient backdrop
│   ├── lyrics-page.js         # Tab & full-screen UI orchestrator (animations, seek, scroll)
│   ├── content.js             # YouTube Music DOM observer, tab switching, and shortcuts
│   └── styles.css             # Apple Music styling, depth blur falloffs, typography, animations
├── popup/
│   ├── popup.html             # Extension popup UI
│   └── popup.js               # Toggle & track status sync
└── icons/                     # 16px, 48px, 128px extension icons
```

---

## ⌨️ Controls & Shortcuts

- **`L`**: Toggle the Full-Screen Apple Music Lyrics Page
- **`Esc`**: Close the Full-Screen Lyrics Page
- **Click any lyric line**: Seek playback to that line's timestamp
- **`+` / `−` Buttons**: Nudge lyric timing offset in increments of 0.2s
- **`Auto` / Source Dropdown**: Switch between any of the 13 discovered providers
- **Default Lyrics Tab**: Click "Lyrics" in YouTube Music's player to view embedded synced lyrics
