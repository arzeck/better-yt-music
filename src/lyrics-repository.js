/**
 * Multi-source concurrent lyrics racing repository.
 *
 * Implements BitChord's LyricsRepository.kt architecture:
 *   - Concurrent requests across all BitChord providers:
 *     1. lrc.red (Apple Music TTML via ISRC / search)
 *     2. BiniLyrics (Apple Music TTML with ISRC discovery)
 *     3. BetterLyrics (Apple Music TTML)
 *     4. BetterLyrics Portato (QQ Karaoke timings)
 *     5. PaxSenix (Apple Music timings)
 *     6. LyricsPlus (Syllable timings across community mirrors)
 *     7. SimpMusic (YouTube-video-id keyed rich sync)
 *     8. Unison (Crowdsourced TTML / Enhanced LRC)
 *     9. KuGou (Whole lines with credit stripping & instrumental notices)
 *     10. LRCLIB (Line-synced community database with fuzzy search)
 *     11. Musixmatch (RichSync and subtitle lines)
 *     12. Genius (Web catalogue plain lines)
 *     13. YouTube Music (Native tab plain text)
 *   - Word/syllable-synced result takes immediate precedence.
 *   - Line-synced results display immediately while word-synced sources race.
 *   - Collects all available hits per track so the user can switch sources at any time.
 *   - In-memory LRU cache so previous tracks load instantly without refetching.
 */

(() => {
  'use strict';

  const {
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
  } = window.__YTMLSources;

  class LyricsRepository {
    constructor() {
      this.cache = new Map(); // key -> { activeResult, allResults: Map<sourceName, result> }
      this.currentTrackKey = '';
      this.inFlightKey = '';
    }

    getTrackKey(title, artist, durationMs, videoId = '') {
      return `${(title || '').trim()}|${(artist || '').trim()}|${Math.round((durationMs || 0) / 1000)}|${videoId || ''}`;
    }

    /**
     * Fetches lyrics across all providers concurrently.
     *
     * @param {Object} trackInfo { title, artist, durationMs, videoId, album }
     * @param {Function} onProgress callback invoked as sources return: (activeResult, allResults) => void
     * @returns {Promise<Object>} { activeResult, allResults }
     */
    async fetchLyrics(trackInfo, onProgress = null) {
      const { title, artist, durationMs, videoId, album } = trackInfo;
      const key = this.getTrackKey(title, artist, durationMs, videoId);
      this.inFlightKey = key;

      // Check memory cache
      if (this.cache.has(key)) {
        const cached = this.cache.get(key);
        if (onProgress) onProgress(cached.activeResult, cached.allResults);
        return cached;
      }

      const cleanTitle = cleanSearchTitle(title);
      const cleanArtist = cleanSearchArtist(artist);

      const allResults = new Map();
      let bestResult = null;

      const priorityOrder = [
        'lrc.red',
        'BiniLyrics',
        'BetterLyrics',
        'BetterLyricsPortato',
        'PaxSenix',
        'LyricsPlus',
        'SimpMusic',
        'Unison',
        'LRCLIB',
        'KuGou',
        'Musixmatch',
        'Genius',
        'YouTubeMusic'
      ];

      const recordResult = (res) => {
        if (!res || !res.lines || res.lines.length === 0) return;
        if (this.inFlightKey !== key) return; // Stale request

        allResults.set(res.source, res);

        let shouldPromote = false;
        if (!bestResult) {
          shouldPromote = true;
        } else if (res.isWordSynced && !bestResult.isWordSynced) {
          shouldPromote = true;
        } else if (res.isWordSynced === bestResult.isWordSynced) {
          const curPriority = priorityOrder.indexOf(bestResult.source);
          const newPriority = priorityOrder.indexOf(res.source);
          if (newPriority >= 0 && (curPriority < 0 || newPriority < curPriority)) {
            shouldPromote = true;
          }
        }

        if (shouldPromote) {
          bestResult = res;
        }

        if (onProgress && this.inFlightKey === key) {
          onProgress(bestResult, allResults);
        }
      };

      // 1. Discover recording ISRC via BiniLyrics or fast search
      let discoveredIsrc = null;

      // Launch all BitChord providers concurrently
      const tasks = [
        // 1. lrc.red
        (async () => {
          const res = await fetchLrcRed(cleanTitle, cleanArtist, durationMs, discoveredIsrc);
          if (res) recordResult(res);
        })(),

        // 2. BiniLyrics
        (async () => {
          const res = await fetchBiniLyrics(cleanTitle, cleanArtist, durationMs, discoveredIsrc);
          if (res) {
            if (res.isrc && !discoveredIsrc) {
              discoveredIsrc = res.isrc;
              fetchLrcRed(cleanTitle, cleanArtist, durationMs, discoveredIsrc).then(r => { if (r) recordResult(r); });
            }
            recordResult(res);
          }
        })(),

        // 3. BetterLyrics
        (async () => {
          const res = await fetchBetterLyrics(cleanTitle, cleanArtist, durationMs, album);
          if (res) recordResult(res);
        })(),

        // 4. BetterLyrics Portato (QQ Karaoke)
        (async () => {
          const res = await fetchBetterLyricsPortato(cleanTitle, cleanArtist, durationMs, album);
          if (res) recordResult(res);
        })(),

        // 5. PaxSenix
        (async () => {
          const res = await fetchPaxSenix(cleanTitle, cleanArtist, durationMs);
          if (res) recordResult(res);
        })(),

        // 6. LyricsPlus
        (async () => {
          const res = await fetchLyricsPlus(cleanTitle, cleanArtist, durationMs);
          if (res) recordResult(res);
        })(),

        // 7. SimpMusic
        (async () => {
          if (videoId) {
            const res = await fetchSimpMusicLyrics(videoId, durationMs);
            if (res) recordResult(res);
          }
        })(),

        // 8. Unison
        (async () => {
          const res = await fetchUnison(cleanTitle, cleanArtist, durationMs, album);
          if (res) recordResult(res);
        })(),

        // 9. KuGou
        (async () => {
          const res = await fetchKuGou(cleanTitle, cleanArtist, durationMs, album);
          if (res) recordResult(res);
        })(),

        // 10. LRCLIB
        (async () => {
          const res = await fetchLrcLib(cleanTitle, cleanArtist, durationMs);
          if (res) recordResult(res);
        })(),

        // 11. Musixmatch
        (async () => {
          const res = await fetchMusixmatch(cleanTitle, cleanArtist, durationMs);
          if (res) recordResult(res);
        })(),

        // 12. Genius
        (async () => {
          const res = await fetchGenius(cleanTitle, cleanArtist);
          if (res) recordResult(res);
        })(),

        // 13. YouTube Music native lyrics (Innertube API)
        (async () => {
          const res = await fetchYouTubeMusicNative(videoId);
          if (res) recordResult(res);
        })()
      ];

      await Promise.allSettled(tasks);

      const outcome = {
        activeResult: bestResult,
        allResults
      };

      if (bestResult && this.inFlightKey === key) {
        this.cache.set(key, outcome);
        if (this.cache.size > 50) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
      }

      return outcome;
    }
  }

  window.__YTMLLyricsRepo = new LyricsRepository();
})();
