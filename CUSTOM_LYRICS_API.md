# Custom Lyrics API Specification & Developer Guide

This guide explains how to design, build, host, and integrate a **Custom Lyrics API** compatible with this extension and modern time-synced lyrics players (supporting **Word/Syllable-Level Karaoke**, **Apple Music TTML**, **Enhanced LRC**, **Romanisation**, and **Literal Translations**).

---

## 📑 Table of Contents
1. [Architecture & Overview](#1-architecture--overview)
2. [API Protocol & Endpoints](#2-api-protocol--endpoints)
3. [Supported Lyrics Formats](#3-supported-lyrics-formats)
   - [Format A: Apple Music TTML (Recommended for Syllable Sync)](#format-a-apple-music-ttml)
   - [Format B: Structured JSON (SimpMusic / LyricsPlus style)](#format-b-structured-json)
   - [Format C: Enhanced LRC / Karaoke LRC](#format-c-enhanced-lrc--karaoke-lrc)
   - [Format D: Standard Line-Synced LRC](#format-d-standard-line-synced-lrc)
4. [Reference Implementations](#4-reference-implementations)
   - [Node.js / Express Server](#nodejs--express-reference)
   - [Python / FastAPI Server](#python--fastapi-reference)
   - [Cloudflare Worker (Serverless Edge)](#cloudflare-worker-reference)
5. [Integrating Your API into this Extension](#5-integrating-your-api-into-this-extension)
6. [Best Practices for Lyrics APIs](#6-best-practices-for-lyrics-apis)

---

## 1. Architecture & Overview

When a track plays on YouTube Music, the extension's `LyricsRepository` runs a concurrent race across available lyric providers. 

```
                                  ┌──────────────────────────┐
                                  │  YouTube Music Playback  │
                                  └────────────┬─────────────┘
                                               │ (title, artist, duration, videoId, isrc)
                                               ▼
                                  ┌──────────────────────────┐
                                  │ Lyrics Racing Repository │
                                  └────────────┬─────────────┘
                     ┌─────────────────────────┼─────────────────────────┐
                     ▼                         ▼                         ▼
             [ Official lrc.red ]     [ Community LRCLIB ]    [ YOUR CUSTOM API ]
                     │                         │                         │
                     └─────────────────────────┼─────────────────────────┘
                                               ▼
                              ┌──────────────────────────────────┐
                              │ Priority: Word-Sync > Line-Sync  │
                              └────────────────┬─────────────────┘
                                               ▼
                                 Apple Music Fluid Canvas UI
                                (Romanisation + Translation)
```

To achieve the best visual experience, your API should aim to return **Word/Syllable-Synced Lyrics** (TTML or Structured JSON) containing:
- Exact millisecond timestamps for each word/syllable.
- Romanised pronunciation for non-Latin scripts (Japanese, Korean, Hindi, Chinese, Cyrillic).
- English translations for foreign language lyrics.
- Background / answering vocal tags (`ttm:role="x-bg"`).
- Multi-singer / duet identifiers (`ttm:agent="v1"`, `ttm:agent="v2"`).

---

## 2. API Protocol & Endpoints

### Endpoint Specification

- **Method**: `GET`
- **Recommended Path**: `/api/v1/lyrics` or `/getLyrics`
- **CORS**: Must include header `Access-Control-Allow-Origin: *` to support direct browser and extension fetches.

### Request Query Parameters

| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `title` / `song` | `string` | **Yes** | Clean track title | `IRIS OUT` |
| `artist` | `string` | **Yes** | Primary artist name | `Kenshi Yonezu` |
| `duration` | `number` | Recommended | Track length in seconds (or milliseconds) | `189` |
| `album` | `string` | Optional | Album or EP name | `LOST CORNER` |
| `videoId` | `string` | Optional | YouTube Video ID (allows video-specific sync) | `dQw4w9WgXcQ` |
| `isrc` | `string` | Optional | International Standard Recording Code (12 chars) | `JPB602400301` |

### HTTP Response Status Codes
- `200 OK`: Lyrics found.
- `404 Not Found`: No matching lyrics found for this track.
- `400 Bad Request`: Missing required query parameters.
- `500 Internal Error`: Server-side lookup failure.

---

## 3. Supported Lyrics Formats

Your API can return lyrics in any of the four formats below. The extension automatically detects and parses them.

---

### Format A: Apple Music TTML
*(Highest Fidelity — Syllable Sync, Background Vocals, Duets, Romanisation & Translation)*

Return HTTP `200` with `Content-Type: application/xml` or `application/ttml+xml`, or return a JSON object `{ "format": "ttml", "lyrics": "<tt>...</tt>" }`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" 
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/lyric-ttml-extensions">
  <head>
    <metadata>
      <ttm:agent xml:id="v1" type="person" />
      <ttm:agent xml:id="v2" type="person" />
    </metadata>
  </head>
  <body dur="00:03:12.000">
    <div>
      <!-- Syllable-synced lead vocal -->
      <p begin="00:00:14.200" end="00:00:18.500" ttm:agent="v1">
        <span begin="00:00:14.200" end="00:00:15.100">ばら</span>
        <span begin="00:00:15.100" end="00:00:16.000">撒く</span>
        <span begin="00:00:16.000" end="00:00:17.200">乱心</span>
        <!-- Optional embedded Romanisation subtext -->
        <span ttm:role="x-roman">bara maku ranshin</span>
        <!-- Optional embedded English translation subtext -->
        <span ttm:role="x-translation">Scattering chaos</span>
      </p>

      <!-- Duet answering line with background vocal -->
      <p begin="00:00:18.600" end="00:00:22.000" ttm:agent="v2">
        <span begin="00:00:18.600" end="00:00:20.100">アイラブユー</span>
        <!-- Background vocal tucked under the line -->
        <span ttm:role="x-bg">
          <span begin="00:00:20.200" end="00:00:21.800">(I love you)</span>
        </span>
        <span ttm:role="x-roman">ai rabu yuu</span>
      </p>
    </div>
  </body>
</tt>
```

---

### Format B: Structured JSON
*(SimpMusic / LyricsPlus style — Clean, modern, easiest to produce with custom engines)*

Return `Content-Type: application/json`:

```json
{
  "success": true,
  "source": "CustomEngine",
  "isWordSynced": true,
  "lyrics": [
    {
      "timeMs": 14200,
      "endTimeMs": 18500,
      "text": "ばら撒く乱心 気づけば蕩尽",
      "alignment": "Start",
      "roman": "bara maku ranshin kizukeba toujin",
      "translation": "Scattering chaos, before you know it, exhausted",
      "syllables": [
        { "text": "ばら", "startTimeMs": 14200, "endTimeMs": 15100 },
        { "text": "撒く", "startTimeMs": 15100, "endTimeMs": 16000 },
        { "text": "乱心", "startTimeMs": 16000, "endTimeMs": 17200 },
        { "text": "気づけば", "startTimeMs": 17250, "endTimeMs": 17900 },
        { "text": "蕩尽", "startTimeMs": 17900, "endTimeMs": 18500 }
      ]
    },
    {
      "timeMs": 18600,
      "endTimeMs": 22000,
      "text": "アイラブユー",
      "roman": "airabuyuu",
      "translation": "I love you",
      "background": {
        "text": "(I love you)",
        "timeMs": 20200,
        "endTimeMs": 21800
      }
    }
  ]
}
```

---

### Format C: Enhanced LRC / Karaoke LRC
*(Word-timed text file)*

```lrc
[ti:IRIS OUT]
[ar:Kenshi Yonezu]
[length:03:09]

[00:14.20] <00:14.20>ばら <00:15.10>撒く <00:16.00>乱心 <00:17.25>気づけば <00:17.90>蕩尽
[00:18.60] <00:18.60>アイラブユー <00:20.20>(I love you)
```

---

### Format D: Standard Line-Synced LRC
*(Line-timed text file)*

```lrc
[00:14.20]ばら撒く乱心 気づけば蕩尽 この世に
[00:18.60]生まれた君が悪い
[00:22.10]やたらとしんどい恋煩い
```

---

## 4. Reference Implementations

### Node.js / Express Reference

Create a file `server.js`:

```javascript
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); // Enable CORS for extension requests
app.use(express.json());

// In-memory or database store
const LYRICS_DATABASE = new Map();

// Helper: normalize track keys
function makeKey(title, artist) {
  return `${(title || '').toLowerCase().trim()}::${(artist || '').toLowerCase().trim()}`;
}

// 1. Seed sample data
LYRICS_DATABASE.set(makeKey('IRIS OUT', 'Kenshi Yonezu'), {
  isWordSynced: true,
  lyrics: [
    {
      timeMs: 14200,
      endTimeMs: 18500,
      text: "ばら撒く乱心 気づけば蕩尽 この世に",
      roman: "bara maku ranshin kizukeba toujin kono yo ni",
      translation: "Scattering chaos, before you know it, exhausted in this world",
      syllables: [
        { text: "ばら撒く", startTimeMs: 14200, endTimeMs: 15300 },
        { text: "乱心", startTimeMs: 15300, endTimeMs: 16200 },
        { text: "気づけば", startTimeMs: 16250, endTimeMs: 17100 },
        { text: "蕩尽", startTimeMs: 17100, endTimeMs: 17900 },
        { text: "この世に", startTimeMs: 17900, endTimeMs: 18500 }
      ]
    },
    {
      timeMs: 18600,
      endTimeMs: 22000,
      text: "生まれた君が悪い",
      roman: "umareta kimi ga warui",
      translation: "You who were born are bad",
      syllables: [
        { text: "生まれた", startTimeMs: 18600, endTimeMs: 19800 },
        { text: "君が", startTimeMs: 19800, endTimeMs: 20600 },
        { text: "悪い", startTimeMs: 20600, endTimeMs: 22000 }
      ]
    }
  ]
});

// 2. Lyrics Lookup Route
app.get('/api/v1/lyrics', (req, res) => {
  const { title, artist, duration, videoId } = req.query;

  if (!title) {
    return res.status(400).json({ error: 'Missing title parameter' });
  }

  const key = makeKey(title, artist);
  const match = LYRICS_DATABASE.get(key);

  if (!match) {
    return res.status(404).json({ error: 'Lyrics not found' });
  }

  return res.json({
    success: true,
    provider: 'MyCustomLyricsAPI',
    title,
    artist,
    isWordSynced: match.isWordSynced,
    lyrics: match.lyrics
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lyrics API server running on port ${PORT}`);
});
```

---

### Python / FastAPI Reference

Create a file `main.py`:

```python
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
from pydantic import BaseModel

app = FastAPI(title="Custom Lyrics API")

# Enable CORS for Chrome Extensions and web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Syllable(BaseModel):
    text: str
    startTimeMs: int
    endTimeMs: int

class LyricLine(BaseModel):
    timeMs: int
    text: str
    endTimeMs: Optional[int] = None
    roman: Optional[str] = ""
    translation: Optional[str] = ""
    syllables: Optional[List[Syllable]] = None

class LyricsResponse(BaseModel):
    success: bool
    provider: str
    isWordSynced: bool
    lyrics: List[LyricLine]

@app.get("/api/v1/lyrics", response_model=LyricsResponse)
def get_lyrics(
    title: str = Query(..., description="Track title"),
    artist: Optional[str] = Query("", description="Artist name"),
    duration: Optional[int] = Query(None, description="Duration in seconds"),
    videoId: Optional[str] = Query(None, description="YouTube Video ID")
):
    # Lookup logic here (Database / Redis / AI alignment engine / external scraper)
    if "iris out" in title.lower():
        return LyricsResponse(
            success=True,
            provider="FastAPILyrics",
            isWordSynced=True,
            lyrics=[
                LyricLine(
                    timeMs=14200,
                    endTimeMs=18500,
                    text="ばら撒く乱心 気づけば蕩尽 この世に",
                    roman="bara maku ranshin kizukeba toujin kono yo ni",
                    translation="Scattering chaos, before you know it, exhausted in this world",
                    syllables=[
                        Syllable(text="ばら撒く", startTimeMs=14200, endTimeMs=15300),
                        Syllable(text="乱心", startTimeMs=15300, endTimeMs=16200),
                        Syllable(text="気づけば", startTimeMs=16250, endTimeMs=17100),
                        Syllable(text="蕩尽", startTimeMs=17100, endTimeMs=17900),
                        Syllable(text="この世に", startTimeMs=17900, endTimeMs=18500),
                    ]
                )
            ]
        )

    raise HTTPException(status_code=404, detail="Lyrics not found")

# Run with: uvicorn main:app --port 8000 --reload
```

---

### Cloudflare Worker Reference
*(Zero maintenance, global edge distribution, free tier)*

```javascript
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const title = url.searchParams.get('title');
    const artist = url.searchParams.get('artist');

    if (!title) {
      return new Response(JSON.stringify({ error: 'Missing title' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // Example: fetch from KV or upstream mirror
    const cacheKey = `lyrics:${title.toLowerCase()}:${(artist || '').toLowerCase()}`;
    // const cached = await env.LYRICS_KV.get(cacheKey, { type: 'json' });

    const sample = {
      success: true,
      provider: "CloudflareEdgeLyrics",
      isWordSynced: false,
      lyrics: [
        { timeMs: 12000, text: "Sample line from Cloudflare Worker" },
        { timeMs: 16000, text: "Second line of lyrics" }
      ]
    };

    return new Response(JSON.stringify(sample), {
      status: 200,
      headers: corsHeaders
    });
  }
};
```

---

## 5. Integrating Your API into this Extension

To connect your custom API into this YouTube Music extension:

### Step 1: Add your fetcher in `src/sources.js`

Open `src/sources.js` and add your custom function:

```javascript
async function fetchCustomLyrics(title, artist, durationMs, videoId = null) {
  try {
    const sec = Math.round((durationMs || 0) / 1000);
    const url = `https://your-custom-api.com/api/v1/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${sec}${videoId ? `&videoId=${videoId}` : ''}`;
    
    // netFetch proxies through background worker bypassing any origin restrictions
    const res = await netFetch(url);
    if (!res || !res.ok) return null;

    const data = await res.json();
    const items = data.lyrics || data.result;
    if (!Array.isArray(items) || items.length === 0) return null;

    const rawLines = [];
    items.forEach(item => {
      const timeMs = item.timeMs ?? item.start ?? item.startTimeMs;
      if (timeMs == null) return;
      const text = (item.text || item.line || '').trim();
      if (!text) return;

      let words = [];
      if (Array.isArray(item.syllables) && item.syllables.length > 0) {
        words = item.syllables.map(s => 
          createLyricWord(s.startTimeMs || s.start, s.endTimeMs || s.end, s.text)
        );
      }

      rawLines.push(createLyricLine({
        timeMs: Math.round(timeMs),
        text,
        words,
        sungUntilMs: item.endTimeMs || item.end || null,
        roman: item.roman || '',
        translation: item.translation || ''
      }));
    });

    if (rawLines.length === 0) return null;
    rawLines.sort((a, b) => a.timeMs - b.timeMs);

    const lines = withInstrumentalGaps(withBackgroundVocals(rawLines));

    return {
      source: 'CustomAPI',
      label: 'My Custom API',
      isWordSynced: lines.some(l => l.isWordSynced),
      lines
    };
  } catch (err) {
    console.warn('[CustomAPI] Fetch error:', err);
    return null;
  }
}
```

Export your function at the bottom of `src/sources.js`:
```javascript
window.__YTMLSources = {
  ...
  fetchCustomLyrics
};
```

### Step 2: Register in `src/lyrics-repository.js`

Open `src/lyrics-repository.js` and add `fetchCustomLyrics` to the racing pipeline:

```javascript
// Add to imports at top of lyrics-repository.js:
const {
  ...
  fetchCustomLyrics
} = window.__YTMLSources;

// In queryAllSourcesConcurrent():
const allPromises = [
  wrap('CustomAPI', fetchCustomLyrics(cleanTitle, cleanArtist, durationMs, videoId)),
  wrap('lrc.red', fetchLrcRed(cleanTitle, cleanArtist, durationMs, isrc)),
  // ... other providers
];
```

### Step 3: Register in the Provider Manager List (`src/lyrics-page.js`)

In `src/lyrics-page.js`, add your provider to `ALL_KNOWN_PROVIDERS`:

```javascript
const ALL_KNOWN_PROVIDERS = [
  { id: 'CustomAPI', name: 'My Custom API', service: 'Custom Host', defaultBadge: 'Syllable Sync' },
  { id: 'lrc.red', name: 'lrc.red', service: 'Apple Music TTML', defaultBadge: 'Syllable Sync' },
  // ...
];
```

Reload the unpacked extension at `chrome://extensions`. Your custom API is now part of the concurrent 14-source race!

---

## 6. Best Practices for Lyrics APIs

1. **Title & Artist Normalisation**:
   - Strip channel packaging (`(Official Video)`, `[Lyric Video]`, `HD`, `4K`).
   - Retain audio variant indicators: `(Remix)`, `(Live)`, `(Acoustic)`, `(Sped Up)`, `(Slowed + Reverb)`.
2. **Duration Verification**:
   - Live concert recordings, radio edits, and extended versions differ in track duration. Compare incoming `duration` against your database and reject matches with $> 3\text{s}$ difference.
3. **HTTP Caching**:
   - Once synced, lyric timestamps almost never change. Serve responses with `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` to ensure lightning-fast responses from CDNs.
4. **Instrumental Interludes**:
   - You don't need to manually insert dot lines for pauses. This extension's `withInstrumentalGaps()` automatically inserts animated breathing dots whenever silence between vocal lines is $\ge 4.0\text{s}$.
5. **Multi-Voice Alternation**:
   - For duets, set `ttm:agent="v1"` and `ttm:agent="v2"`, or specify `"agent": "v1"` / `"v2"` in JSON lines. The UI will automatically alternate lead lines between the left and right sides of the screen!

