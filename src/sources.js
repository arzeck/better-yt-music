/**
 * Lyrics source providers and query sanitization ported from BitChord:
 *   - lrc.red (Apple Music TTML by recording ISRC / title search)
 *   - BiniLyrics (Apple Music TTML with ISRC identification)
 *   - BetterLyrics (Apple Music TTML)
 *   - BetterLyrics Portato (QQ Music word-timed karaoke)
 *   - Unison (Crowdsourced TTML / Enhanced LRC)
 *   - PaxSenix (Apple Music timings via PaxSenix proxy)
 *   - LyricsPlus (Syllable-timed lyrics across community mirrors)
 *   - SimpMusic (YouTube-video-id keyed rich sync)
 *   - KuGou (Whole lines with credit stripping & instrumental filtering)
 *   - LRCLIB (Community line-synced database with fuzzy fallback)
 *   - Musixmatch (RichSync and subtitle lines with HMAC-SHA256 signing)
 *   - Genius (Plain text web catalogue fallback)
 *   - YouTube Music (Native tab text fallback)
 */

(() => {
  'use strict';

  const { createLyricWord, createLyricLine, computeLineAlignments, withInstrumentalGaps, withBackgroundVocals } = window.__YTMLModels;
  const { parseTtmlLyrics } = window.__YTMLTtml;
  const { parseAnyLrc, parseStandardLrc, decodeEntities } = window.__YTMLLrc;

  /**
   * Helper that proxies requests through the extension background worker,
   * avoiding page-level CORS and origin restrictions (e.g. 401 on music.youtube.com).
   */
  async function netFetch(url, options = {}) {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'PROXY_FETCH',
            url,
            options
          }, res => {
            if (chrome.runtime.lastError || !res) {
              resolve(null);
            } else {
              resolve(res);
            }
          });
        });

        if (response != null && typeof response === 'object') {
          return {
            ok: !!response.ok,
            status: response.status || (response.ok ? 200 : 500),
            text: async () => response.data || '',
            json: async () => {
              try {
                return JSON.parse(response.data || '{}');
              } catch (_) {
                return {};
              }
            }
          };
        }
      } catch (_) {}
    }

    try {
      return await fetch(url, options);
    } catch (err) {
      return {
        ok: false,
        status: 0,
        text: async () => '',
        json: async () => ({})
      };
    }
  }

  // ─── Query Sanitization (ported from BitChord LyricsQuery.kt) ─────────────────────────

  const CREDITS_REGEXES = [
    /\s*\((?:feat\.?|ft\.?|featuring|with)\s+[^)]+\)/gi,
    /\s*\[(?:feat\.?|ft\.?|featuring|with)\s+[^\]]+\]/gi,
  ];

  const PACKAGING_REGEXES = [
    /\s*[([]\s*(?:official\s+(?:music\s+)?(?:video|audio)|music\s+video|lyric(?:s)?(?:\s+video)?|visualizer|audio\s+track|full\s+song|album\s+version|hd|4k|hq|exclusive|stream|clip\s+officiel)[^)\]]*[)\]]/gi,
    /\s*\|\s*(?:official\s+(?:music\s+)?video|visualizer|lyric\s+video|audio).*$/gi,
    /\s*-\s*(?:official\s+(?:music\s+)?video|visualizer|lyric\s+video|audio).*$/gi,
  ];

  const VERSION_WORDS = new Set([
    'live', 'remix', 'remixed', 'mix', 'acoustic', 'unplugged', 'instrumental', 'karaoke', 'cappella', 'acapella',
    'demo', 'edit', 'version', 'cover', 'sped', 'slowed', 'reverb', 'nightcore', 'lofi', 'orchestral', 'extended',
  ]);
  const BRACKETED = /[([][^)\]]*[)\]]/g;
  const ARTIST_SEPARATORS = /\s*(?:,|&|;|\/|\s+and\s+|\s+x\s+|\s+with\s+|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i;

  const normalized = (val) =>
    (val || '')
      .normalize('NFD')
      .replace(/\p{Mn}+/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const coreOf = (title) => normalized(title.replace(BRACKETED, ' ').split(' - ')[0]) || normalized(title);

  const versionOf = (title) =>
    new Set(
      normalized(`${(title.match(BRACKETED) || []).join(' ')} ${title.includes(' - ') ? title.slice(title.indexOf(' - ') + 3) : ''}`)
        .split(' ')
        .filter((w) => VERSION_WORDS.has(w))
    );

  const artistsOf = (artist) => new Set((artist || '').split(ARTIST_SEPARATORS).map(normalized).filter(Boolean));
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  function cleanSearchTitle(rawTitle) {
    if (!rawTitle) return '';
    let name = rawTitle.replace(/[♪♫★☆【】《》「」~_]/g, ' ');
    for (const re of CREDITS_REGEXES) name = name.replace(re, ' ');
    for (const re of PACKAGING_REGEXES) name = name.replace(re, ' ');
    name = name.replace(/\s+/g, ' ').trim().replace(/[,–—-]+$/g, '').trim();
    return name.length > 0 ? name : rawTitle.trim();
  }

  function cleanSearchArtist(rawArtist) {
    if (!rawArtist) return '';
    let a = rawArtist.replace(/\s*-\s*Topic\s*$/i, '').trim();
    a = a.split('•')[0].split('·')[0].trim();
    return a.length > 0 ? a : rawArtist.trim();
  }

  // ─── 1. lrc.red (LrcRed.kt) ──────────────────────────────────────────────────────────

  const LRC_RED = 'https://lrc.red/';
  const ISRC_REGEX = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;

  function lrcRedDocument(isrc) {
    const code = (isrc || '').trim().toUpperCase();
    return code && ISRC_REGEX.test(code) ? `${LRC_RED}s/${code}.ttml` : null;
  }

  function bestLrcRedHit(hits, title, artist, durationMs) {
    if (!Array.isArray(hits) || hits.length === 0) return null;
    const wantedTitle = coreOf(title);
    const wantedVersion = versionOf(title);
    const wantedArtists = artistsOf(artist);
    const secs = durationMs / 1000;
    const distance = (hit) => (durationMs > 0 && hit.duration != null ? Math.abs(hit.duration - secs) : 0);

    const passing = hits.filter(hit =>
      !!hit.title &&
      !!lrcRedDocument(hit.isrc) &&
      coreOf(hit.title) === wantedTitle &&
      sameSet(versionOf(hit.title), wantedVersion) &&
      (!wantedArtists.size || [...artistsOf(hit.artist || '')].some(a => wantedArtists.has(a))) &&
      distance(hit) <= 4
    );

    return passing.sort((a, b) => distance(a) - distance(b))[0] || null;
  }

  async function fetchLrcRed(title, artist, durationMs, isrc = null) {
    try {
      // 1. Direct ISRC hit
      const knownUrl = lrcRedDocument(isrc);
      if (knownUrl) {
        const res = await netFetch(knownUrl);
        if (res.ok) {
          const text = await res.text();
          const lines = parseTtmlLyrics(text);
          if (lines && lines.length > 0) {
            return {
              source: 'lrc.red',
              label: 'lrc.red (Apple Music)',
              isrc,
              isWordSynced: lines.some(l => l.isWordSynced),
              lines
            };
          }
        }
      }

      // 2. Search lrc.red catalog
      const sUrl = `${LRC_RED}search.json?q=${encodeURIComponent(`${title} ${artist}`.trim())}`;
      const sRes = await netFetch(sUrl);
      if (!sRes.ok) return null;
      const data = await sRes.json();
      const hit = bestLrcRedHit(data?.hits || [], title, artist, durationMs);
      const url = lrcRedDocument(hit?.isrc);
      if (!url) return null;

      const ttmlRes = await netFetch(url);
      if (!ttmlRes.ok) return null;
      const ttml = await ttmlRes.text();
      const lines = parseTtmlLyrics(ttml);
      if (!lines || lines.length === 0) return null;

      return {
        source: 'lrc.red',
        label: 'lrc.red (Apple Music)',
        isrc: hit.isrc,
        isWordSynced: lines.some(l => l.isWordSynced),
        lines
      };
    } catch (_) {
      return null;
    }
  }

  // ─── 2. BiniLyrics (BiniLyrics.kt) ───────────────────────────────────────────────────

  const BINI_BASE = 'https://lyrics-api.binimum.org/';

  async function fetchBiniLyrics(title, artist, durationMs, isrc = null) {
    try {
      const url = new URL(BINI_BASE);
      if (isrc) {
        url.searchParams.set('isrc', isrc);
      } else {
        url.searchParams.set('track', title);
        url.searchParams.set('artist', artist);
        const sec = Math.round(durationMs / 1000);
        if (sec > 0) url.searchParams.set('duration', sec.toString());
      }

      const res = await netFetch(url.toString());
      if (!res.ok) return null;

      const data = await res.json();
      const hit = data?.results?.[0];
      if (!hit?.lyricsUrl) return null;

      const ttmlRes = await netFetch(hit.lyricsUrl);
      if (!ttmlRes.ok) return null;

      const ttmlText = await ttmlRes.text();
      const lines = parseTtmlLyrics(ttmlText);
      if (!lines || lines.length === 0) return null;

      return {
        source: 'BiniLyrics',
        label: 'BiniLyrics (Apple Music)',
        isrc: hit.isrc || null,
        isWordSynced: lines.some(l => l.isWordSynced),
        lines
      };
    } catch (_) {
      return null;
    }
  }

  // ─── 3. BetterLyrics (BetterLyrics.kt) ────────────────────────────────────────────────

  async function fetchBetterLyricsAt(endpoint, title, artist, durationMs, album = null, label = 'BetterLyrics (Apple Music)', sourceId = 'BetterLyrics') {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('s', title);
      url.searchParams.set('a', artist);
      const sec = Math.round(durationMs / 1000);
      if (sec > 0) url.searchParams.set('d', sec.toString());
      if (album) url.searchParams.set('al', album);

      const res = await netFetch(url.toString());
      if (!res.ok) return null;

      const text = await res.text();
      if (!text || text.length === 0) return null;

      let content = text.trim();
      try {
        const parsed = JSON.parse(content);
        content = parsed.ttml || parsed.lyrics || parsed.content || parsed.text || content;
      } catch (_) {}

      let lines = [];
      if (content.includes('<tt') || content.includes('http://www.w3.org/ns/ttml')) {
        lines = parseTtmlLyrics(content);
      } else {
        lines = parseAnyLrc(content);
      }

      if (!lines || lines.length === 0) return null;

      return {
        source: sourceId,
        label,
        isWordSynced: lines.some(l => l.isWordSynced),
        lines
      };
    } catch (_) {
      return null;
    }
  }

  const fetchBetterLyrics = (title, artist, durationMs, album = null) =>
    fetchBetterLyricsAt('https://lyrics-api.boidu.dev/getLyrics', title, artist, durationMs, album, 'BetterLyrics (Apple Music)', 'BetterLyrics');

  const fetchBetterLyricsPortato = (title, artist, durationMs, album = null) =>
    fetchBetterLyricsAt('https://lyrics-api.boidu.dev/qq/getLyrics', title, artist, durationMs, album, 'BetterLyrics Portato (QQ Karaoke)', 'BetterLyricsPortato');

  // ─── 4. Unison (Unison.kt) ───────────────────────────────────────────────────────────

  async function fetchUnison(title, artist, durationMs, album = null) {
    const endpoints = [
      'https://unison.boidu.dev/lyrics',
      'https://unison.betterlyrics.org/lyrics'
    ];
    const sec = Math.round(durationMs / 1000);

    for (const base of endpoints) {
      try {
        const url = new URL(base);
        url.searchParams.set('song', title);
        url.searchParams.set('artist', artist);
        if (album) url.searchParams.set('album', album);
        if (sec > 0) url.searchParams.set('duration', sec.toString());

        const res = await netFetch(url.toString());
        if (!res.ok) continue;

        const body = await res.json();
        const data = body?.success ? body.data : (body?.lyrics ? body : null);
        const text = data?.lyrics?.trim();
        if (!text) continue;

        let lines = [];
        if (data.format?.toLowerCase() === 'ttml' || text.includes('<tt')) {
          lines = parseTtmlLyrics(text);
        } else {
          lines = parseAnyLrc(text);
        }

        if (lines && lines.length > 0) {
          return {
            source: 'Unison',
            label: 'Unison (Community)',
            isWordSynced: lines.some(l => l.isWordSynced),
            lines
          };
        }
      } catch (_) {}
    }
    return null;
  }

  // ─── 5. PaxSenix (PaxSenix.kt) ────────────────────────────────────────────────────────

  async function fetchPaxSenix(title, artist, durationMs) {
    try {
      const q = encodeURIComponent(`${title} ${artist}`);
      const searchRes = await netFetch(`https://lyrics.paxsenix.org/apple-music/lyrics?q=${q}&ttml=true`);
      if (searchRes.ok) {
        const text = await searchRes.text();
        if (text && (text.includes('<tt') || text.includes('http://www.w3.org/ns/ttml'))) {
          const lines = parseTtmlLyrics(text);
          if (lines && lines.length > 0) {
            return {
              source: 'PaxSenix',
              label: 'PaxSenix (Apple Music)',
              isWordSynced: lines.some(l => l.isWordSynced),
              lines
            };
          }
        }
      }
    } catch (_) {}
    return null;
  }

  // ─── 6. LyricsPlus (LyricsPlus.kt) ────────────────────────────────────────────────────

  const LYRICS_PLUS_MIRRORS = [
    'https://lyricsplus.binimum.org',
    'https://lyricsplus.prjktla.my.id',
    'https://lyricsplus.atomix.one',
    'https://lyricsplus.prjktla.workers.dev',
    'https://lyricsplus-seven.vercel.app',
    'https://lyrics-plus-backend.vercel.app'
  ];

  let lastGoodMirror = LYRICS_PLUS_MIRRORS[0];

  function parseLyricsPlusResponse(data) {
    const lyrics = data?.lyrics;
    if (!Array.isArray(lyrics) || lyrics.length === 0) return null;

    const agentTypes = {};
    if (data.metadata?.agents) {
      for (const [id, ag] of Object.entries(data.metadata.agents)) {
        if (ag?.type) agentTypes[ag.alias || id] = ag.type;
      }
    }

    const rawSung = [];

    for (const item of lyrics) {
      const start = item.time;
      if (start == null) continue;

      const syllabus = item.syllabus;
      if (Array.isArray(syllabus) && syllabus.length > 0) {
        const words = [];
        let curText = '';
        let wStart = 0;
        let wEnd = 0;

        for (const s of syllabus) {
          if (!s.text) continue;
          const sTime = s.time != null ? s.time : start;
          const sDur = s.duration || 0;

          if (curText === '') wStart = sTime;
          curText += s.text.trim();
          wEnd = sTime + sDur;

          if (/\s$/.test(s.text)) {
            if (curText.length > 0) {
              words.push(createLyricWord(wStart, wEnd, curText));
            }
            curText = '';
          }
        }
        if (curText.length > 0) {
          words.push(createLyricWord(wStart, wEnd, curText));
        }

        if (words.length > 0) {
          const fullText = words.map(w => w.text).join(' ');
          rawSung.push({
            line: createLyricLine({
              timeMs: Math.min(start, words[0].startMs),
              text: fullText,
              words
            }),
            singer: item.singer || (typeof item.element === 'object' ? item.element?.singer : null)
          });
          continue;
        }
      }

      if (item.text && item.text.trim()) {
        rawSung.push({
          line: createLyricLine({
            timeMs: start,
            text: item.text.trim(),
            sungUntilMs: item.duration ? (start + item.duration) : null
          }),
          singer: item.singer || null
        });
      }
    }

    if (rawSung.length === 0) return null;

    rawSung.sort((a, b) => a.line.timeMs - b.line.timeMs);

    const sides = computeLineAlignments(rawSung.map(r => r.singer), agentTypes);
    const aligned = rawSung.map((r, i) => {
      return createLyricLine({
        ...r.line,
        alignment: sides[i] || 'Start'
      });
    });

    return withInstrumentalGaps(withBackgroundVocals(aligned));
  }

  async function fetchLyricsPlus(title, artist, durationMs) {
    const hosts = [lastGoodMirror, ...LYRICS_PLUS_MIRRORS.filter(m => m !== lastGoodMirror)];
    const sec = Math.round(durationMs / 1000);

    const promises = hosts.map(async host => {
      try {
        const url = `${host}/v2/lyrics/get?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}${sec > 0 ? `&duration=${sec}` : ''}`;
        const res = await netFetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const lines = parseLyricsPlusResponse(data);
        if (lines && lines.length > 0) {
          lastGoodMirror = host;
          return {
            source: 'LyricsPlus',
            label: 'LyricsPlus (Syllable Sync)',
            isWordSynced: lines.some(l => l.isWordSynced),
            lines
          };
        }
      } catch (_) {}
      return null;
    });

    for (const p of promises) {
      const res = await p;
      if (res) return res;
    }
    return null;
  }

  // ─── 7. SimpMusic (Keyed by YouTube Video ID) ─────────────────────────────────────────

  const SIMP_BASE = 'https://api-lyrics.simpmusic.org/v1/';

  async function fetchSimpMusicLyrics(videoId, durationMs) {
    if (!videoId) return null;
    try {
      const res = await netFetch(`${SIMP_BASE}${encodeURIComponent(videoId)}`);
      if (!res.ok) return null;

      const data = await res.json();
      const lyricsArray = Array.isArray(data) ? data : (data?.lyrics || data?.result);
      if (!Array.isArray(lyricsArray) || lyricsArray.length === 0) return null;

      const rawLines = [];
      lyricsArray.forEach(item => {
        const timeMs = item.startTimeMs || item.start || item.time;
        if (timeMs == null) return;

        const text = (item.text || item.words || item.line || '').trim();
        if (!text) return;

        let words = [];
        if (Array.isArray(item.syllables) && item.syllables.length > 0) {
          words = item.syllables.map(s => createLyricWord(s.startTimeMs || s.start, s.endTimeMs || s.end, s.text));
        }

        rawLines.push(createLyricLine({
          timeMs: Math.round(timeMs),
          text,
          words,
          sungUntilMs: item.endTimeMs || item.end || null
        }));
      });

      if (rawLines.length === 0) return null;
      rawLines.sort((a, b) => a.timeMs - b.timeMs);

      const lines = withInstrumentalGaps(withBackgroundVocals(rawLines));
      return {
        source: 'SimpMusic',
        label: 'SimpMusic (YouTube Sync)',
        isWordSynced: lines.some(l => l.isWordSynced),
        lines
      };
    } catch (_) {
      return null;
    }
  }

  // ─── 8. KuGou (KuGou.kt) ──────────────────────────────────────────────────────────────

  const stripParenthetical = (s) => (s || '').replace(/[(（].*?[)）]/g, '').trim() || s;
  const KUGOU_STAMPED = /^\[\d{2}:\d{2}\.\d{2,3}\].*/;
  const KUGOU_CREDIT = /.+\][^[]+[:：].+/;
  const KUGOU_STAMP = /\[\d{2}:\d{2}\.\d{2,3}\]/g;
  const KUGOU_INSTRUMENTAL = /纯音乐.*欣赏/;

  function stripKugouCredits(lrc) {
    const lines = lrc.split(/\r?\n/).filter((l) => KUGOU_STAMPED.test(l));
    if (!lines.length) return '';
    let head = 0;
    for (let i = Math.min(30, lines.length - 1); i >= 0; i--) {
      if (KUGOU_CREDIT.test(lines[i])) {
        head = i + 1;
        break;
      }
    }
    const body = lines.slice(head);
    let tail = 0;
    for (let i = 0; i <= Math.min(30, body.length - 1); i++) {
      if (KUGOU_CREDIT.test(body[body.length - 1 - i])) {
        tail = i + 1;
        break;
      }
    }
    return body.slice(0, body.length - tail).join('\n');
  }

  function isKugouInstrumentalNotice(lrc) {
    const lines = lrc.split(/\r?\n/).map((l) => l.replace(KUGOU_STAMP, '').trim()).filter(Boolean);
    return lines.length > 0 && lines.every((l) => KUGOU_INSTRUMENTAL.test(l));
  }

  async function fetchKuGou(title, artist, durationMs, album = null) {
    try {
      const keyword = `${stripParenthetical(title)} - ${stripParenthetical(artist)}${album ? ` ${album}` : ''}`;
      const secs = Math.floor(durationMs / 1000);

      // Search songs to get candidate hashes
      const searchUrl = `https://mobileservice.kugou.com/api/v3/search/song?version=9108&plat=0&pagesize=8&showtype=0&keyword=${encodeURIComponent(keyword)}`;
      const searchRes = await netFetch(searchUrl);
      let candidate = null;

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const songs = searchData?.data?.info || [];
        const hashes = songs
          .filter(s => secs <= 0 || Math.abs((s.duration || 0) - secs) <= 8)
          .sort((a, b) => Math.abs((a.duration || 0) - secs) - Math.abs((b.duration || 0) - secs))
          .map(s => s.hash);

        for (const hash of hashes) {
          const lyricSearchUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${hash}`;
          const lyrRes = await netFetch(lyricSearchUrl);
          if (lyrRes.ok) {
            const lyrData = await lyrRes.json();
            if (lyrData?.candidates?.[0]) {
              candidate = lyrData.candidates[0];
              break;
            }
          }
        }
      }

      // Fallback keyword search
      if (!candidate) {
        const fallbackUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(keyword)}${secs > 0 ? `&duration=${secs * 1000}` : ''}`;
        const fRes = await netFetch(fallbackUrl);
        if (fRes.ok) {
          const fData = await fRes.json();
          candidate = fData?.candidates?.[0];
        }
      }

      if (!candidate?.id || !candidate?.accesskey) return null;

      // Download LRC
      const dlUrl = `https://lyrics.kugou.com/download?fmt=lrc&charset=utf8&client=pc&ver=1&id=${candidate.id}&accesskey=${candidate.accesskey}`;
      const dlRes = await netFetch(dlUrl);
      if (!dlRes.ok) return null;

      const dlData = await dlRes.json();
      if (!dlData?.content) return null;

      let lrcText = '';
      try {
        const rawBytes = Uint8Array.from(atob(dlData.content), (c) => c.charCodeAt(0));
        lrcText = new TextDecoder('utf-8').decode(rawBytes);
      } catch (_) {
        lrcText = atob(dlData.content);
      }

      const stripped = stripKugouCredits(lrcText);
      if (isKugouInstrumentalNotice(stripped)) return null;

      const lines = parseAnyLrc(stripped);
      if (!lines || lines.length === 0) return null;

      return {
        source: 'KuGou',
        label: 'KuGou (Synced)',
        isWordSynced: lines.some(l => l.isWordSynced),
        lines
      };
    } catch (_) {
      return null;
    }
  }

  // ─── 9. LRCLIB (LrcLib.kt) ────────────────────────────────────────────────────────────

  const LRCLIB_BASE = 'https://lrclib.net/api';

  async function fetchLrcLib(title, artist, durationMs) {
    const sec = Math.round(durationMs / 1000);

    // 1. Exact match
    try {
      const url = new URL(`${LRCLIB_BASE}/get`);
      url.searchParams.set('track_name', title);
      url.searchParams.set('artist_name', artist);
      if (sec > 0) url.searchParams.set('duration', sec.toString());

      const res = await netFetch(url.toString(), {
        headers: { 'Lrclib-Client': 'YTMusicBetterLyrics/2.0' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.syncedLyrics) {
          const lines = parseAnyLrc(data.syncedLyrics);
          if (lines.length > 0) {
            return {
              source: 'LRCLIB',
              label: 'LRCLIB (Synced)',
              isWordSynced: lines.some(l => l.isWordSynced),
              lines
            };
          }
        }
      }
    } catch (_) {}

    // 2. Fuzzy search
    try {
      const sUrl = new URL(`${LRCLIB_BASE}/search`);
      sUrl.searchParams.set('track_name', title);
      sUrl.searchParams.set('artist_name', artist);

      const sRes = await netFetch(sUrl.toString(), {
        headers: { 'Lrclib-Client': 'YTMusicBetterLyrics/2.0' }
      });
      if (sRes.ok) {
        const hits = await sRes.json();
        if (Array.isArray(hits)) {
          const withSync = hits.filter(h => h.syncedLyrics);
          if (withSync.length > 0) {
            withSync.sort((a, b) => Math.abs((a.duration || 0) - sec) - Math.abs((b.duration || 0) - sec));
            const lines = parseAnyLrc(withSync[0].syncedLyrics);
            if (lines.length > 0) {
              return {
                source: 'LRCLIB',
                label: 'LRCLIB (Synced)',
                isWordSynced: lines.some(l => l.isWordSynced),
                lines
              };
            }
          }
        }
      }
    } catch (_) {}

    return null;
  }

  // ─── 10. Musixmatch (Musixmatch.kt) ───────────────────────────────────────────────────

  const MXM = 'https://apic.musixmatch.com/ws/1.1';
  const MXM_APP = 'mobile-app-v1.0';
  const MXM_FALLBACK_SECRET = 'f09016176ba43a1cfd1031fbd6b3d26c';
  let mxmToken = null;

  async function mxmSign(url, secret = MXM_FALLBACK_SECRET) {
    const normalizedUrl = url.replace(/%20/g, '+').replace(/ /g, '+');
    const now = new Date();
    const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const raw = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${normalizedUrl}${date}`)));
    const signature = btoa(String.fromCharCode(...raw));
    return `${normalizedUrl}&signature=${encodeURIComponent(signature)}&signature_protocol=sha256`;
  }

  function parseRichSync(body) {
    let entries = [];
    try {
      entries = JSON.parse(body);
    } catch (_) {}
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const lines = entries.map(entry => {
      const lineStart = Math.trunc(entry.ts * 1000);
      const lineEnd = Math.max(lineStart, Math.trunc(entry.te * 1000));
      let prev = lineStart;
      const words = (entry.l || []).map(w => {
        const wStart = prev;
        const wEnd = Math.max(wStart, Math.trunc((entry.ts + (w.o || 0)) * 1000));
        prev = wEnd;
        return createLyricWord(wStart, wEnd, (w.c || '').trim());
      }).filter(w => w.text.length > 0);

      const text = words.map(w => w.text).join(' ');
      return createLyricLine({
        timeMs: lineStart,
        text: text || (entry.x || '').trim(),
        words,
        sungUntilMs: lineEnd
      });
    }).filter(l => l.text.length > 0);

    return withInstrumentalGaps(withBackgroundVocals(lines));
  }

  async function fetchMusixmatch(title, artist, durationMs) {
    try {
      const secs = Math.round(durationMs / 1000);
      if (!mxmToken) {
        const tokenUrl = await mxmSign(`${MXM}/token.get?app_id=${MXM_APP}&format=json`);
        const tRes = await netFetch(tokenUrl);
        if (tRes.ok) {
          const tData = await tRes.json();
          mxmToken = tData?.message?.body?.user_token || null;
        }
      }
      if (!mxmToken) return null;

      const sUrl = await mxmSign(`${MXM}/track.search?app_id=${MXM_APP}&format=json&q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&f_has_lyrics=1&s_track_rating=desc&page_size=5&page=1&usertoken=${mxmToken}`);
      const sRes = await netFetch(sUrl);
      if (!sRes.ok) return null;

      const sData = await sRes.json();
      const tracks = (sData?.message?.body?.track_list || []).map(t => t.track);
      if (!tracks.length) return null;

      const track = tracks[0];

      // Try RichSync
      if (track.has_richsync) {
        const rUrl = await mxmSign(`${MXM}/track.richsync.get?app_id=${MXM_APP}&format=json&track_id=${track.track_id}&usertoken=${mxmToken}`);
        const rRes = await netFetch(rUrl);
        if (rRes.ok) {
          const rData = await rRes.json();
          const body = rData?.message?.body?.richsync?.richsync_body;
          if (body) {
            const lines = parseRichSync(body);
            if (lines.length > 0) {
              return {
                source: 'Musixmatch',
                label: 'Musixmatch (RichSync)',
                isWordSynced: true,
                lines
              };
            }
          }
        }
      }

      // Try Subtitles
      if (track.has_subtitles) {
        const subUrl = await mxmSign(`${MXM}/track.subtitle.get?app_id=${MXM_APP}&format=json&track_id=${track.track_id}&subtitle_format=mxm&usertoken=${mxmToken}`);
        const subRes = await netFetch(subUrl);
        if (subRes.ok) {
          const subData = await subRes.json();
          const body = subData?.message?.body?.subtitle?.subtitle_body;
          if (body) {
            let entries = [];
            try { entries = JSON.parse(body); } catch (_) {}
            const rawLines = entries.filter(e => e.text && e.text.trim()).map(e => createLyricLine({
              timeMs: Math.trunc((e.time?.total || 0) * 1000),
              text: e.text.trim()
            }));
            if (rawLines.length > 0) {
              return {
                source: 'Musixmatch',
                label: 'Musixmatch (Synced)',
                isWordSynced: false,
                lines: withInstrumentalGaps(rawLines)
              };
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  // ─── 11. Genius (Genius.kt) ──────────────────────────────────────────────────────────

  const GENIUS_NOISE = /\s*[([]\s*(?:from|feat\.?|ft\.?|featuring|with|prod\.?|official|video|remix)[^)\]]*[)\]]/gi;
  const geniusClean = (s) => (s || '').replace(/[♪♫★☆【】《》「」~_]/g, ' ').replace(GENIUS_NOISE, ' ').trim() || s.trim();

  function parseGeniusHtml(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      let containers = [...doc.querySelectorAll('div[data-lyrics-container="true"]')];
      if (!containers.length) containers = [...doc.querySelectorAll('div.lyrics')];
      if (!containers.length) return [];

      let text = '';
      for (const container of containers) {
        container.querySelectorAll('[data-exclude-from-selection="true"], [class*="LyricsHeader"], button, script, style').forEach(n => n.remove());
        container.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        text += `${container.textContent || ''}\n`;
      }

      const cleaned = text.replace(/\d*You might also like/gi, '').replace(/\d*Embed\s*$/i, '').trim();
      const out = [];
      for (const raw of cleaned.split('\n')) {
        const t = raw.trim();
        if (t) out.push(createLyricLine({ timeMs: 0, text: decodeEntities(t) }));
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  async function fetchGenius(title, artist) {
    try {
      const cleanT = geniusClean(title);
      const cleanA = geniusClean(artist);
      const q = encodeURIComponent(`${cleanA} ${cleanT}`.trim());
      const sRes = await netFetch(`https://genius.com/api/search/multi?q=${q}`);
      if (!sRes.ok) return null;

      const sData = await sRes.json();
      const hits = sData?.response?.sections?.find(s => s.type === 'song')?.hits;
      if (!Array.isArray(hits) || hits.length === 0) return null;

      const hitPath = hits[0]?.result?.path;
      if (!hitPath) return null;

      const pageRes = await netFetch(`https://genius.com${hitPath}`);
      if (!pageRes.ok) return null;

      const html = await pageRes.text();
      const lines = parseGeniusHtml(html);
      if (lines.length > 0) {
        return {
          source: 'Genius',
          label: 'Genius (Plain)',
          isWordSynced: false,
          isPlain: true,
          lines
        };
      }
    } catch (_) {}
    return null;
  }

  // ─── 12. YouTube Music Native Lyrics (Innertube API) ─────────────────────────────────

  async function fetchYouTubeMusicNative(videoId) {
    if (!videoId) return null;
    try {
      const ctx = {
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20241028.01.00',
            hl: 'en'
          }
        }
      };

      // Step 1: Get the lyrics browseId from next endpoint
      const nextRes = await netFetch('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ctx, videoId })
      });
      if (!nextRes.ok) return null;

      const nextData = await nextRes.json();
      const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer
        ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
      if (!Array.isArray(tabs)) return null;

      const lyricsTab = tabs.find(t =>
        t?.tabRenderer?.endpoint?.browseEndpoint?.browseId?.startsWith('MPLYt')
      );
      const browseId = lyricsTab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
      if (!browseId) return null;

      // Step 2: Fetch actual lyrics using the browseId
      const browseRes = await netFetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ctx, browseId })
      });
      if (!browseRes.ok) return null;

      const browseData = await browseRes.json();
      const shelf = browseData?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer;
      const text = shelf?.description?.runs?.[0]?.text;
      if (!text || text.toLowerCase().includes('lyrics not available') || text.toLowerCase().includes('no lyrics')) {
        return null;
      }

      const source = shelf?.footer?.runs?.[0]?.text || 'LyricFind';
      const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!rawLines.length) return null;

      const lines = rawLines.map(t => createLyricLine({ timeMs: 0, text: decodeEntities(t) }));
      return {
        source: 'YouTubeMusic',
        label: `YouTube Music (${source})`,
        isWordSynced: false,
        isPlain: true,
        lines
      };
    } catch (_) {
      return null;
    }
  }

  window.__YTMLSources = {
    netFetch,
    cleanSearchTitle,
    cleanSearchArtist,
    fetchLrcRed,
    fetchBiniLyrics,
    fetchBetterLyrics,
    fetchBetterLyricsPortato,
    fetchUnison,
    fetchPaxSenix,
    fetchLyricsPlus,
    fetchSimpMusicLyrics,
    fetchKuGou,
    fetchLrcLib,
    fetchMusixmatch,
    fetchGenius,
    fetchYouTubeMusicNative
  };
})();
