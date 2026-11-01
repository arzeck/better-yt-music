/**
 * Apple Music-Style Full Lyrics Page & Default YT Music Lyrics Tab Integration.
 *
 * Provides:
 *   1. Embedded Apple Music Synced Lyrics directly inside the default YouTube Music Lyrics Tab
 *   2. Immersive Full-Screen Apple Music Lyrics View with fluid animated mesh canvas backdrop
 *   3. Shared 60 FPS real-time karaoke animation loop (syllable lift, bloom, duet alignment, click-to-seek)
 */

(() => {
  'use strict';

  const FULL_PAGE_ID = 'ytm-better-lyrics-page';
  const TAB_VIEW_ID  = 'ytm-apple-lyrics-tab-view';

  const SCROLL_OFFSET_RATIO = 0.35;
  const LOOKAHEAD_MS = 40;

  // Full page elements
  let fullPageEl = null;
  let meshBackdrop = null;
  let fullScrollContainer = null;
  let fullStreamEl = null;
  let fullResumeBtn = null;
  let fullSourceDropdownEl = null;
  let fullOffsetDisplayEl = null;

  // Embedded tab view elements
  let tabViewEl = null;
  let tabScrollContainer = null;
  let tabStreamEl = null;
  let tabResumeBtn = null;
  let tabSourceDropdownEl = null;
  let tabOffsetDisplayEl = null;

  // Shared state
  let currentLines = [];
  let fullLineElements = [];
  let tabLineElements = [];

  let lastActiveIdx = -1;
  let rafId = null;

  let isFullUserScrolling = false;
  let fullUserScrollTimeout = null;

  let isTabUserScrolling = false;
  let tabUserScrollTimeout = null;

  let timingOffsetMs = 0;
  let activeSource = null;
  let availableSources = new Map();
  let isPlainMode = false;

  let isFullPageOpen = false;
  let currentModalMode = 'lyrics'; // 'lyrics' | 'player' | 'queue'
  let currentTrackMeta = { title: '', artist: '', album: '', artwork: '' };
  let currentQueue = [];
  let currentPlayerState = { isPaused: true, currentTime: 0, duration: 0, volume: 1, muted: false };

  let currentBackdropUrl = '';

  const ALL_KNOWN_PROVIDERS = [
    { id: 'lrc.red', name: 'lrc.red', service: 'Apple Music TTML', defaultBadge: 'Syllable Sync' },
    { id: 'BiniLyrics', name: 'BiniLyrics', service: 'Apple Music TTML', defaultBadge: 'Syllable Sync' },
    { id: 'BetterLyrics', name: 'BetterLyrics', service: 'Apple Music TTML', defaultBadge: 'Syllable Sync' },
    { id: 'BetterLyricsPortato', name: 'Portato', service: 'QQ Karaoke Sync', defaultBadge: 'Syllable Sync' },
    { id: 'PaxSenix', name: 'PaxSenix', service: 'Apple Music Sync', defaultBadge: 'Syllable Sync' },
    { id: 'LyricsPlus', name: 'LyricsPlus', service: 'Community Syllables', defaultBadge: 'Syllable Sync' },
    { id: 'SimpMusic', name: 'SimpMusic', service: 'YouTube Sync', defaultBadge: 'Syllable Sync' },
    { id: 'Unison', name: 'Unison', service: 'Community Enhanced', defaultBadge: 'Syllable Sync' },
    { id: 'LRCLIB', name: 'LRCLIB', service: 'Community Database', defaultBadge: 'Line Sync' },
    { id: 'KuGou', name: 'KuGou', service: 'KuGou Synced', defaultBadge: 'Line Sync' },
    { id: 'Musixmatch', name: 'Musixmatch', service: 'RichSync / Subtitles', defaultBadge: 'Line Sync' },
    { id: 'Genius', name: 'Genius', service: 'Web Plain Text', defaultBadge: 'Plain' },
    { id: 'YouTubeMusic', name: 'YouTube Music', service: 'Native Tab', defaultBadge: 'Plain' }
  ];

  const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  // Regex for scripts where letters MUST connect cursively (Arabic, Persian, Urdu, etc.)
  // Splitting these into separate inline-block spans breaks letter-shaping.
  const CURSIVE_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  /**
   * Splits a word into user-perceived grapheme clusters (aksharas / syllables),
   * ensuring combining marks, vowel signs (matras), viramas, and conjuncts stay
   * attached to their base characters without creating dotted-circle placeholders.
   */
  function splitIntoGraphemes(text) {
    if (!text) return [];
    if (CURSIVE_SCRIPT_REGEX.test(text)) {
      return [text];
    }
    if (graphemeSegmenter) {
      return Array.from(graphemeSegmenter.segment(text), s => s.segment);
    }
    return text.match(/[\s\S][\u0300-\u036F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]*/g) || Array.from(text);
  }

  // ─── Subtext Engine: Romanization & Translation ─────────────────────────────
  let isRomanizeActive = false;
  let isTranslateActive = false;
  let isFetchingSubtext = false;
  const subtextCache = new Map(); // trackKey -> { roman: string[], trans: string[] }

  function getTrackKey() {
    return `${currentTrackMeta.title || ''}::${currentTrackMeta.artist || ''}`.toLowerCase().trim();
  }

  function isNonLatin(str) {
    if (!str) return false;
    return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u0400-\u04FF\u0900-\u097F\u0600-\u06FF\u0E00-\u0E7F\u0370-\u03FF\u0590-\u05FF]/.test(str);
  }

  function romanizeHangul(text) {
    const CHOSEONG = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
    const JUNGSEONG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
    const JONGSEONG = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xAC00 && code <= 0xD7A3) {
        const syl = code - 0xAC00;
        const cho = Math.floor(syl / 588);
        const jung = Math.floor((syl % 588) / 28);
        const jong = syl % 28;
        result += CHOSEONG[cho] + JUNGSEONG[jung] + JONGSEONG[jong];
      } else {
        result += text[i];
      }
    }
    return result;
  }

  const KANA_ROM_MAP = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','を':'wo','ん':'n',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'dzu','で':'de','ど':'do',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
    'しゃ':'sha','しゅ':'shu','しょ':'sho',
    'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
    'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
    'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
    'みゃ':'mya','みゅ':'myu','みょ':'myo',
    'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
    'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
    'じゃ':'ja','じゅ':'ju','じょ':'jo',
    'びゃ':'bya','びゅ':'byu','びょ':'byo',
    'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
    'ー':'-'
  };

  function kanaToRomaji(str) {
    let hira = '';
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c >= 0x30A1 && c <= 0x30F6) {
        hira += String.fromCharCode(c - 0x60);
      } else {
        hira += str[i];
      }
    }
    let res = '';
    for (let i = 0; i < hira.length; i++) {
      const two = hira.slice(i, i + 2);
      if (KANA_ROM_MAP[two]) {
        res += KANA_ROM_MAP[two];
        i++;
        continue;
      }
      if (hira[i] === 'っ') {
        const nextTwo = hira.slice(i + 1, i + 3);
        const nextChar = hira[i + 1];
        const nextRom = KANA_ROM_MAP[nextTwo] || KANA_ROM_MAP[nextChar];
        if (nextRom) {
          res += nextRom[0];
        }
        continue;
      }
      if (KANA_ROM_MAP[hira[i]]) {
        res += KANA_ROM_MAP[hira[i]];
      } else {
        res += hira[i];
      }
    }
    return res.trim();
  }

  const CYRILLIC_MAP = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh','З':'Z','И':'I','Й':'Y',
    'К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F',
    'Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya'
  };

  const DEVA_CONSONANTS = {
    'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
    'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
    'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h',
    'क़':'q','ख़':'kh','ग़':'gh','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f'
  };
  const DEVA_VOWELS = {
    'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au'
  };
  const DEVA_MATRAS = {
    'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au'
  };

  function devanagariToLatin(str) {
    let res = '';
    for (let i = 0; i < str.length; i++) {
      const two = str.slice(i, i + 2);
      if (DEVA_CONSONANTS[two]) {
        const c = DEVA_CONSONANTS[two];
        const next = str[i + 2];
        if (next === '्') { res += c; i += 2; }
        else if (DEVA_MATRAS[next]) { res += c + DEVA_MATRAS[next]; i += 2; }
        else if (next === 'ं' || next === 'ँ') { res += c + 'an'; i += 2; }
        else { res += c + 'a'; i += 1; }
        continue;
      }
      const ch = str[i];
      if (DEVA_CONSONANTS[ch]) {
        const c = DEVA_CONSONANTS[ch];
        const next = str[i + 1];
        if (next === '्') { res += c; i++; }
        else if (DEVA_MATRAS[next]) { res += c + DEVA_MATRAS[next]; i++; }
        else if (next === 'ं' || next === 'ँ') { res += c + 'an'; i++; }
        else { res += c + 'a'; }
        continue;
      }
      if (DEVA_VOWELS[ch]) { res += DEVA_VOWELS[ch]; continue; }
      if (DEVA_MATRAS[ch]) { res += DEVA_MATRAS[ch]; continue; }
      if (ch === 'ं' || ch === 'ँ') { res += 'n'; continue; }
      if (ch === '्') continue;
      res += ch;
    }
    return res.replace(/\s+/g, ' ').trim();
  }

  function transliterateFallback(text) {
    if (!text) return '';
    if (/[\uAC00-\uD7AF]/.test(text)) return romanizeHangul(text);
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text) && !/[\u4E00-\u9FFF]/.test(text)) return kanaToRomaji(text);
    if (/[\u0400-\u04FF]/.test(text)) return text.split('').map(c => CYRILLIC_MAP[c] !== undefined ? CYRILLIC_MAP[c] : c).join('');
    if (/[\u0900-\u097F]/.test(text)) return devanagariToLatin(text);
    return '';
  }

  async function fetchGoogleSubtext(linesArr) {
    if (!linesArr || linesArr.length === 0) return { roman: [], trans: [] };
    const netFetch = window.__YTMLSources?.netFetch;
    if (!netFetch) return { roman: [], trans: [] };

    const chunkSize = 20;
    const allRoman = new Array(linesArr.length).fill('');
    const allTrans = new Array(linesArr.length).fill('');

    const chunks = [];
    for (let i = 0; i < linesArr.length; i += chunkSize) {
      chunks.push({ startIdx: i, slice: linesArr.slice(i, i + chunkSize) });
    }

    await Promise.all(chunks.map(async (chunk) => {
      try {
        const textToQuery = chunk.slice.map(l => (l.text || '').trim() || '...').join('\n');
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q=${encodeURIComponent(textToQuery)}`;
        const res = await netFetch(url, { timeoutMs: 7000 });
        if (!res || !res.ok) return;

        let json;
        try {
          json = typeof res.json === 'function' ? await res.json() : JSON.parse(res.data);
        } catch (_) {
          return;
        }

        if (!Array.isArray(json) || !Array.isArray(json[0])) return;

        let transCombined = '';
        let romanCombined = '';

        for (const seg of json[0]) {
          if (!seg) continue;
          if (typeof seg[0] === 'string') {
            transCombined += seg[0];
          } else if (seg[0] === null) {
            if (typeof seg[2] === 'string' && seg[2].trim()) {
              romanCombined = seg[2];
            } else if (typeof seg[3] === 'string' && seg[3].trim()) {
              romanCombined = seg[3];
            }
          }
        }

        const splittedTrans = transCombined.split('\n').map(s => s.trim());
        const splittedRoman = romanCombined.split('\n').map(s => s.trim());

        chunk.slice.forEach((line, relIdx) => {
          const absIdx = chunk.startIdx + relIdx;
          const tr = splittedTrans[relIdx] || '';
          const rm = splittedRoman[relIdx] || '';

          if (tr && tr !== '...' && tr.toLowerCase() !== line.text.trim().toLowerCase()) {
            allTrans[absIdx] = tr;
          }

          if (isNonLatin(line.text)) {
            allRoman[absIdx] = (rm && rm !== '...') ? rm : transliterateFallback(line.text);
          }
        });
      } catch (err) {
        console.warn('[YTMLyrics] Subtext batch error:', err);
      }
    }));

    return { roman: allRoman, trans: allTrans };
  }

  function applySubtextToDom() {
    const applyToArr = (arr) => {
      arr.forEach((rowEl, i) => {
        if (!rowEl) return;
        const line = currentLines[i];
        if (!line) return;
        const romanEl = rowEl.querySelector('.ytm-subtext-roman');
        const transEl = rowEl.querySelector('.ytm-subtext-trans');
        if (romanEl) romanEl.textContent = line.roman || '';
        if (transEl) transEl.textContent = line.translation || '';
      });
    };
    applyToArr(fullLineElements);
    applyToArr(tabLineElements);
  }

  async function ensureSubtextLoaded() {
    if (!currentLines || currentLines.length === 0) return;
    const trackKey = getTrackKey();

    if (subtextCache.has(trackKey)) {
      const cached = subtextCache.get(trackKey);
      currentLines.forEach((l, i) => {
        if (!l.roman && cached.roman[i]) l.roman = cached.roman[i];
        if (!l.translation && cached.trans[i]) l.translation = cached.trans[i];
      });
      applySubtextToDom();
      return;
    }

    const hasAnyRoman = currentLines.some(l => l.roman);
    const hasAnyTrans = currentLines.some(l => l.translation);
    const needRoman = isRomanizeActive && !hasAnyRoman && currentLines.some(l => isNonLatin(l.text));
    const needTrans = isTranslateActive && !hasAnyTrans && currentLines.some(l => l.text.trim().length > 0);

    if (!needRoman && !needTrans) {
      applySubtextToDom();
      return;
    }

    // Instant local fallback for romanization
    currentLines.forEach(l => {
      if (!l.roman && isNonLatin(l.text)) {
        l.roman = transliterateFallback(l.text);
      }
    });
    applySubtextToDom();

    if (isFetchingSubtext) return;
    isFetchingSubtext = true;
    updateSubtextVisibility();

    try {
      const fetched = await fetchGoogleSubtext(currentLines);
      subtextCache.set(trackKey, fetched);

      if (getTrackKey() === trackKey) {
        currentLines.forEach((l, i) => {
          if (fetched.roman[i]) l.roman = fetched.roman[i];
          if (fetched.trans[i]) l.translation = fetched.trans[i];
        });
        applySubtextToDom();
      }
    } catch (e) {
      console.warn('[YTMLyrics] Failed to fetch subtext:', e);
    } finally {
      isFetchingSubtext = false;
      updateSubtextVisibility();
    }
  }

  function updateSubtextVisibility() {
    const fullRomanBtn = document.getElementById('ytm-lyrics-romanize-btn');
    const fullTransBtn = document.getElementById('ytm-lyrics-translate-btn');
    if (fullRomanBtn) {
      fullRomanBtn.classList.toggle('ytm-footer-btn-active', isRomanizeActive);
      fullRomanBtn.classList.toggle('ytm-subtext-loading', isFetchingSubtext && isRomanizeActive);
    }
    if (fullTransBtn) {
      fullTransBtn.classList.toggle('ytm-footer-btn-active', isTranslateActive);
      fullTransBtn.classList.toggle('ytm-subtext-loading', isFetchingSubtext && isTranslateActive);
    }

    const tabRomanBtn = document.getElementById('ytm-tab-romanize-btn');
    const tabTransBtn = document.getElementById('ytm-tab-translate-btn');
    if (tabRomanBtn) {
      tabRomanBtn.classList.toggle('ytm-tab-btn-active', isRomanizeActive);
    }
    if (tabTransBtn) {
      tabTransBtn.classList.toggle('ytm-tab-btn-active', isTranslateActive);
    }

    if (fullScrollContainer) {
      fullScrollContainer.classList.toggle('ytm-show-roman', isRomanizeActive);
      fullScrollContainer.classList.toggle('ytm-show-trans', isTranslateActive);
    }
    if (tabScrollContainer) {
      tabScrollContainer.classList.toggle('ytm-show-roman', isRomanizeActive);
      tabScrollContainer.classList.toggle('ytm-show-trans', isTranslateActive);
    }
  }

  // Restore saved preferences from extension storage
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.get(['lyricsRomanize', 'lyricsTranslate'], (res) => {
        if (res) {
          if (typeof res.lyricsRomanize === 'boolean') isRomanizeActive = res.lyricsRomanize;
          if (typeof res.lyricsTranslate === 'boolean') isTranslateActive = res.lyricsTranslate;
          updateSubtextVisibility();
          if ((isRomanizeActive || isTranslateActive) && currentLines.length > 0) {
            ensureSubtextLoaded();
          }
        }
      });
    }
  } catch (_) {}

  // ─── 1. Full Page DOM Initialization ──────────────────────────────────────────

  function formatSeconds(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function setModalMode(mode) {
    currentModalMode = mode;
    const lyricsView = document.getElementById('ytm-view-lyrics');
    const playerView = document.getElementById('ytm-view-player');
    const queueView = document.getElementById('ytm-view-queue');

    const btnLyrics = document.getElementById('ytm-ctrl-lyrics');
    const btnQueue = document.getElementById('ytm-ctrl-queue');
    const centerAudio = document.querySelector('.ytm-center-pill-audio');
    const centerQueue = document.querySelector('.ytm-center-pill-queue');

    if (lyricsView) lyricsView.style.display = mode === 'lyrics' ? 'flex' : 'none';
    if (playerView) playerView.style.display = mode === 'player' ? 'flex' : 'none';
    if (queueView) queueView.style.display = mode === 'queue' ? 'flex' : 'none';

    if (btnLyrics) btnLyrics.classList.toggle('ytm-active', mode === 'lyrics');
    if (btnQueue) btnQueue.classList.toggle('ytm-active', mode === 'queue');

    if (centerAudio && centerQueue) {
      if (mode === 'queue') {
        centerAudio.style.display = 'none';
        centerQueue.style.display = 'flex';
      } else {
        centerAudio.style.display = 'flex';
        centerQueue.style.display = 'none';
      }
    }

    if (mode === 'lyrics' && lastActiveIdx >= 0 && fullLineElements[lastActiveIdx]) {
      setTimeout(() => scrollToActiveLine(fullScrollContainer, fullLineElements[lastActiveIdx]), 80);
    }
  }

  function toggleModalMode(targetMode) {
    if (currentModalMode === targetMode) {
      setModalMode('player');
    } else {
      setModalMode(targetMode);
    }
  }

  function updateBackdropImage(artworkUrl) {
    if (!artworkUrl) return;
    if (artworkUrl === currentBackdropUrl) return;
    currentBackdropUrl = artworkUrl;

    const prevEl = document.getElementById('ytm-backdrop-img-prev');
    const currEl = document.getElementById('ytm-backdrop-img-curr');
    if (!currEl) return;

    const imgLoader = new Image();
    imgLoader.onload = () => {
      if (prevEl && currEl.style.backgroundImage) {
        prevEl.style.backgroundImage = currEl.style.backgroundImage;
        prevEl.style.opacity = '1';
      }

      currEl.style.opacity = '0';
      currEl.style.backgroundImage = `url("${artworkUrl}")`;
      void currEl.offsetWidth; // trigger reflow
      currEl.style.opacity = '1';

      if (prevEl) {
        setTimeout(() => {
          prevEl.style.opacity = '0';
        }, 900);
      }
    };
    imgLoader.src = artworkUrl;
  }

  function toggleProviderPopup(show) {
    const popupEl = document.getElementById('ytm-provider-popup');
    if (!popupEl) return;
    const shouldOpen = show !== undefined ? show : !popupEl.classList.contains('ytm-popup-open');
    if (shouldOpen) {
      renderProviderPopup();
      popupEl.classList.add('ytm-popup-open');
    } else {
      popupEl.classList.remove('ytm-popup-open');
    }
  }

  function renderProviderPopup() {
    const listEl = document.getElementById('ytm-provider-popup-list');
    const countEl = document.getElementById('ytm-popup-provider-count');
    if (!listEl) return;
    listEl.innerHTML = '';

    let availableCount = 0;
    const handledIds = new Set();

    ALL_KNOWN_PROVIDERS.forEach(prov => {
      handledIds.add(prov.id);
      const res = availableSources.get(prov.id);
      const isAvailable = Boolean(res && res.lines && res.lines.length > 0);
      if (isAvailable) availableCount++;

      const isActive = isAvailable && (activeSource === prov.id || activeSource === res?.source);

      const row = document.createElement('div');
      row.className = `ytm-provider-row ${isActive ? 'ytm-provider-active' : ''} ${!isAvailable ? 'ytm-provider-disabled' : ''}`;

      let badgeHtml = '';
      if (isAvailable) {
        const badgeClass = res.isWordSynced ? 'ytm-provider-badge-word' : (res.isPlain ? 'ytm-provider-badge-plain' : 'ytm-provider-badge-line');
        const badgeText = res.isWordSynced ? 'Syllable Sync' : (res.isPlain ? 'Plain' : 'Line Sync');
        badgeHtml = `<span class="ytm-provider-badge ${badgeClass}">${badgeText}</span>`;
      } else {
        badgeHtml = `<span class="ytm-provider-badge ytm-provider-badge-none">No lyrics</span>`;
      }

      row.innerHTML = `
        <div class="ytm-provider-left">
          <div class="ytm-provider-check">${isActive ? '✓' : ''}</div>
          <div class="ytm-provider-names">
            <span class="ytm-provider-name">${prov.name}</span>
            <span class="ytm-provider-sub">${isAvailable ? `${prov.service} • ${res.lines.length} lines` : prov.service}</span>
          </div>
        </div>
        <div class="ytm-provider-right">
          ${badgeHtml}
        </div>
      `;

      if (isAvailable) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          setLyricsData(res, availableSources);
          renderProviderPopup();
        });
      }

      listEl.appendChild(row);
    });

    availableSources.forEach((res, srcKey) => {
      if (handledIds.has(srcKey)) return;
      const isAvailable = Boolean(res && res.lines && res.lines.length > 0);
      if (isAvailable) availableCount++;
      const isActive = activeSource === srcKey || activeSource === res?.source;

      const row = document.createElement('div');
      row.className = `ytm-provider-row ${isActive ? 'ytm-provider-active' : ''}`;
      const badgeClass = res.isWordSynced ? 'ytm-provider-badge-word' : (res.isPlain ? 'ytm-provider-badge-plain' : 'ytm-provider-badge-line');
      const badgeText = res.isWordSynced ? 'Syllable Sync' : (res.isPlain ? 'Plain' : 'Line Sync');

      row.innerHTML = `
        <div class="ytm-provider-left">
          <div class="ytm-provider-check">${isActive ? '✓' : ''}</div>
          <div class="ytm-provider-names">
            <span class="ytm-provider-name">${res.label || srcKey}</span>
            <span class="ytm-provider-sub">${res.lines ? `${res.lines.length} lines` : 'Custom Source'}</span>
          </div>
        </div>
        <div class="ytm-provider-right">
          <span class="ytm-provider-badge ${badgeClass}">${badgeText}</span>
        </div>
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        setLyricsData(res, availableSources);
        renderProviderPopup();
      });

      listEl.appendChild(row);
    });

    if (countEl) {
      countEl.textContent = `${availableCount} / ${ALL_KNOWN_PROVIDERS.length} available`;
    }
  }

  function initFullLyricsPage() {
    if (document.getElementById(FULL_PAGE_ID)) return;

    const page = document.createElement('div');
    page.id = FULL_PAGE_ID;
    page.className = 'ytm-apple-lyrics-page';

    page.innerHTML = `
      <div class="ytm-backdrop-wrapper">
        <div class="ytm-backdrop-img ytm-backdrop-img-prev" id="ytm-backdrop-img-prev"></div>
        <div class="ytm-backdrop-img ytm-backdrop-img-curr" id="ytm-backdrop-img-curr"></div>
      </div>
      <canvas id="ytm-lyrics-mesh-canvas" class="ytm-mesh-canvas" style="display:none;"></canvas>
      <div class="ytm-lyrics-scrim"></div>

      <!-- Top drag handle pill (close modal trigger) -->
      <div class="ytm-modal-top-handle-area">
        <div class="ytm-modal-drag-handle" id="ytm-modal-drag-handle" title="Close (Esc)"></div>
      </div>

      <div class="ytm-lyrics-header">
        <div class="ytm-header-left">
          <button id="ytm-lyrics-close-btn" class="ytm-icon-btn" title="Close (Esc)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        <div class="ytm-header-right">
          <button id="ytm-lyrics-refresh-btn" class="ytm-icon-btn ytm-refresh-btn" title="Refresh & re-race all 13 lyrics providers">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>

          <div class="ytm-offset-controls" title="Adjust lyrics timing">
            <button id="ytm-offset-minus" class="ytm-pill-btn">−</button>
            <span id="ytm-offset-val">0.0s</span>
            <button id="ytm-offset-plus" class="ytm-pill-btn">+</button>
            <button id="ytm-offset-reset" class="ytm-pill-btn ytm-reset-btn" title="Reset offset">⟲</button>
          </div>

          <div class="ytm-source-selector">
            <button id="ytm-source-btn" class="ytm-source-btn">
              <span id="ytm-source-label">Auto</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div id="ytm-source-dropdown" class="ytm-dropdown-menu"></div>
          </div>

          <button id="ytm-fullscreen-btn" class="ytm-icon-btn" title="Toggle Fullscreen">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="ytm-lyrics-main-grid">
        <!-- Left Pane: Centered Album Art + Bottom Controls Row (Images 1, 2, 4) -->
        <div class="ytm-lyrics-left-pane">
          <div class="ytm-art-wrapper">
            <img id="ytm-lyrics-art" src="" alt="Album Artwork" class="ytm-lyrics-art-img" />
            <div class="ytm-art-glow" id="ytm-art-glow"></div>
          </div>

          <!-- Bottom controls bar under album art -->
          <div class="ytm-modal-bottom-controls">
            <!-- Lyrics Mode Toggle -->
            <button id="ytm-ctrl-lyrics" class="ytm-modal-bottom-btn ytm-active" title="Lyrics View">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 11.5c0 .83-.67 1.5-1.5 1.5S7 14.33 7 13.5s.67-1.5 1.5-1.5c.14 0 .27.02.4.06-.05-.88-.5-1.63-1.17-2.11l.88-1.22c1.07.77 1.79 1.98 1.88 3.37.01.13.01.27.01.4zm6 0c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5c.14 0 .27.02.4.06-.05-.88-.5-1.63-1.17-2.11l.88-1.22c1.07.77 1.79 1.98 1.88 3.37.01.13.01.27.01.4z"/>
              </svg>
            </button>

            <!-- Center Pill: Audio Output or Queue Controls -->
            <div id="ytm-ctrl-center-pill" class="ytm-modal-center-pill">
              <!-- Default: Audio output -->
              <div class="ytm-center-pill-audio">
                <div class="ytm-pill-icons">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                </div>
                <span class="ytm-pill-subtext">System default</span>
              </div>
              <!-- In Queue Mode: Shuffle / Repeat / Autoplay -->
              <div class="ytm-center-pill-queue" style="display: none;">
                <button id="ytm-queue-shuffle" class="ytm-pill-mini-btn" title="Shuffle"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg></button>
                <button id="ytm-queue-repeat" class="ytm-pill-mini-btn" title="Repeat"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg></button>
                <button id="ytm-queue-autoplay" class="ytm-pill-mini-btn ytm-active" title="AutoPlay"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L12 10.98l-2.83-2.83c-.97-.97-2.33-1.53-3.77-1.53-2.94 0-5.4 2.46-5.4 5.4s2.46 5.4 5.4 5.4c1.44 0 2.8-.56 3.77-1.53L12 13.02l2.83 2.83c.97.97 2.33 1.53 3.77 1.53 2.94 0 5.4-2.46 5.4-5.4s-2.46-5.4-5.4-5.4zm-13.2 8.8c-1.87 0-3.4-1.53-3.4-3.4s1.53-3.4 3.4-3.4c.91 0 1.77.35 2.39.97l2.43 2.43-2.43 2.43c-.62.62-1.48.97-2.39.97zm13.2 0c-.91 0-1.77-.35-2.39-.97l-2.43-2.43 2.43-2.43c.62-.62 1.48-.97 2.39-.97 1.87 0 3.4 1.53 3.4 3.4s-1.53 3.4-3.4 3.4z"/></svg></button>
              </div>
            </div>

            <!-- Queue Mode Toggle -->
            <button id="ytm-ctrl-queue" class="ytm-modal-bottom-btn" title="Queue">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Right Pane: Switchable Mode Views -->
        <div class="ytm-lyrics-right-pane">
          <!-- Mode 1: Lyrics Stream View (Image 1) -->
          <div class="ytm-modal-view-panel ytm-view-lyrics" id="ytm-view-lyrics">
            <div class="ytm-lyrics-scroll-container" id="ytm-lyrics-scroll-container">
              <div class="ytm-lyrics-stream" id="ytm-lyrics-stream">
                <div class="ytm-loading-state">
                  <div class="ytm-spinner"></div>
                  <p>Finding synced lyrics...</p>
                </div>
              </div>

              <button id="ytm-resume-sync-btn" class="ytm-resume-sync-pill">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                </svg>
                Resume Sync
              </button>
            </div>

            <div class="ytm-lyrics-footer">
              <button id="ytm-lyrics-romanize-btn" class="ytm-footer-icon-btn" title="Romanise lyrics (show phonetic pronunciation below line)"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></button>
              <span id="ytm-lyrics-footer-source" class="ytm-footer-source" role="button" tabindex="0" title="Click to manage lyrics providers & sync">Getting the lyrics</span>
              <button id="ytm-lyrics-translate-btn" class="ytm-footer-icon-btn" title="Translate lyrics to English (show translation below line)"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg></button>

              <!-- Floating Lyrics Provider Manager Popover -->
              <div id="ytm-provider-popup" class="ytm-provider-popup" role="dialog" aria-label="Lyrics Providers">
                <div class="ytm-popup-header">
                  <div class="ytm-popup-title-wrap">
                    <span class="ytm-popup-title">Lyrics Providers</span>
                    <span class="ytm-popup-count" id="ytm-popup-provider-count">13 providers</span>
                  </div>
                  <div class="ytm-popup-header-actions">
                    <button id="ytm-popup-refresh-btn" class="ytm-popup-action-btn ytm-refresh-btn" title="Re-race all 13 providers">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                      </svg>
                    </button>
                    <button id="ytm-popup-close-btn" class="ytm-popup-action-btn" title="Close">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </div>
                </div>

                <div class="ytm-popup-timing-bar">
                  <div class="ytm-popup-timing-label">Sync Offset</div>
                  <div class="ytm-popup-timing-controls">
                    <button id="ytm-popup-offset-minus" class="ytm-popup-pill-btn" title="-0.1s">−</button>
                    <span id="ytm-popup-offset-val" class="ytm-popup-offset-text">0.0s</span>
                    <button id="ytm-popup-offset-plus" class="ytm-popup-pill-btn" title="+0.1s">+</button>
                    <button id="ytm-popup-offset-reset" class="ytm-popup-pill-btn ytm-popup-reset-btn" title="Reset offset to 0.0s">Reset</button>
                  </div>
                </div>

                <div class="ytm-popup-list-container">
                  <div class="ytm-popup-list" id="ytm-provider-popup-list"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Mode 2: Player Controls View (Image 2) -->
          <div class="ytm-modal-view-panel ytm-view-player" id="ytm-view-player" style="display: none;">
            <div class="ytm-player-view-container">
              <div class="ytm-player-subtitle-context">Playing from Recents</div>

              <div class="ytm-player-meta-row">
                <div class="ytm-player-text-block">
                  <h1 id="ytm-player-view-title" class="ytm-player-view-title">—</h1>
                  <h2 id="ytm-player-view-artist" class="ytm-player-view-artist">—</h2>
                </div>
                <div class="ytm-player-action-btns">
                  <button id="ytm-player-view-like-btn" class="ytm-round-glass-btn" title="Like track"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>
                  <button id="ytm-player-view-more-btn" class="ytm-round-glass-btn" title="More options"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></button>
                </div>
              </div>

              <!-- Mini Lyrics preview pill (click flips to lyrics mode!) -->
              <div class="ytm-player-lyrics-preview" id="ytm-player-view-lyrics-preview" title="View Full Lyrics">
                <span id="ytm-player-lyrics-preview-text">Lyrics sync ready...</span>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
              </div>

              <!-- Timeline Seekbar -->
              <div class="ytm-player-timeline-block">
                <div class="ytm-player-times-row">
                  <span id="ytm-player-time-current">0:00</span>
                  <span class="ytm-high-quality-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg> High quality</span>
                  <span id="ytm-player-time-remaining">-0:00</span>
                </div>
                <div class="ytm-seekbar-wrapper">
                  <input type="range" id="ytm-player-seekbar" min="0" max="100" value="0" class="ytm-apple-slider" />
                </div>
              </div>

              <!-- Playback Transport Controls -->
              <div class="ytm-player-transport-row">
                <button id="ytm-player-ctrl-prev" class="ytm-transport-btn" title="Previous Track"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
                <button id="ytm-player-ctrl-play" class="ytm-play-big-btn" title="Play / Pause"><svg id="ytm-play-icon-svg" viewBox="0 0 24 24" width="44" height="44" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg></button>
                <button id="ytm-player-ctrl-next" class="ytm-transport-btn" title="Next Track"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
              </div>

              <!-- Volume Control Slider -->
              <div class="ytm-player-volume-row">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="rgba(255,255,255,0.6)"><path d="M7 9v6h4l5 5V4L11 9H7z"/></svg>
                <div class="ytm-volume-slider-wrapper">
                  <input type="range" id="ytm-player-volume-slider" min="0" max="1" step="0.01" value="1" class="ytm-apple-slider" />
                </div>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="rgba(255,255,255,0.6)"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
              </div>
            </div>
          </div>

          <!-- Mode 3: Queue View (Image 4) -->
          <div class="ytm-modal-view-panel ytm-view-queue" id="ytm-view-queue" style="display: none;">
            <div class="ytm-queue-view-container">
              <h2 class="ytm-queue-header-title">Queue</h2>

              <div class="ytm-queue-section-label">Now playing</div>
              <div class="ytm-queue-now-playing-card" id="ytm-queue-now-card">
                <img id="ytm-queue-now-img" class="ytm-queue-thumb" src="" alt="" />
                <div class="ytm-queue-item-meta">
                  <div id="ytm-queue-now-title" class="ytm-queue-item-title">—</div>
                  <div id="ytm-queue-now-artist" class="ytm-queue-item-artist">—</div>
                </div>
                <div class="ytm-queue-playing-bars">
                  <span></span><span></span><span></span>
                </div>
              </div>

              <div class="ytm-queue-autoplay-header">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="rgba(255,255,255,0.7)"><path d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L12 10.98l-2.83-2.83c-.97-.97-2.33-1.53-3.77-1.53-2.94 0-5.4 2.46-5.4 5.4s2.46 5.4 5.4 5.4c1.44 0 2.8-.56 3.77-1.53L12 13.02l2.83 2.83c.97.97 2.33 1.53 3.77 1.53 2.94 0 5.4-2.46 5.4-5.4s-2.46-5.4-5.4-5.4zm-13.2 8.8c-1.87 0-3.4-1.53-3.4-3.4s1.53-3.4 3.4-3.4c.91 0 1.77.35 2.39.97l2.43 2.43-2.43 2.43c-.62.62-1.48.97-2.39.97zm13.2 0c-.91 0-1.77-.35-2.39-.97l-2.43-2.43 2.43-2.43c.62-.62 1.48-.97 2.39-.97 1.87 0 3.4 1.53 3.4 3.4s-1.53 3.4-3.4 3.4z"/></svg>
                <span class="ytm-queue-autoplay-title">AutoPlay</span>
                <span class="ytm-queue-autoplay-desc">Similar music, selected to play next</span>
              </div>

              <div class="ytm-queue-list-scroll" id="ytm-queue-items-container">
                <!-- Dynamically populated queue items -->
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(page);
    fullPageEl = page;

    const canvas = document.getElementById('ytm-lyrics-mesh-canvas');
    meshBackdrop = new window.__YTMLMeshBackdrop(canvas);

    fullScrollContainer = document.getElementById('ytm-lyrics-scroll-container');
    fullStreamEl = document.getElementById('ytm-lyrics-stream');
    fullResumeBtn = document.getElementById('ytm-resume-sync-btn');
    fullSourceDropdownEl = document.getElementById('ytm-source-dropdown');
    fullOffsetDisplayEl = document.getElementById('ytm-offset-val');

    bindFullPageEvents();
  }

  function sendPlayerCommand(command, value) {
    window.postMessage({
      source: 'ytml-isolated',
      type: 'PLAYER_COMMAND',
      payload: { command, value }
    }, '*');
  }

  function bindFullPageEvents() {
    // Top drag handle & close buttons
    const handleEl = document.getElementById('ytm-modal-drag-handle');
    if (handleEl) handleEl.addEventListener('click', closeFullLyricsPage);

    const handleArea = document.querySelector('.ytm-modal-top-handle-area');
    if (handleArea) handleArea.addEventListener('click', closeFullLyricsPage);

    const closeBtn = document.getElementById('ytm-lyrics-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeFullLyricsPage);

    // Left pane bottom controls row
    const btnLyrics = document.getElementById('ytm-ctrl-lyrics');
    if (btnLyrics) btnLyrics.addEventListener('click', () => toggleModalMode('lyrics'));

    const btnQueue = document.getElementById('ytm-ctrl-queue');
    if (btnQueue) btnQueue.addEventListener('click', () => toggleModalMode('queue'));

    // Center pill queue buttons
    const btnShuffle = document.getElementById('ytm-queue-shuffle');
    if (btnShuffle) {
      btnShuffle.addEventListener('click', () => {
        const nativeShuffle = document.querySelector('ytmusic-player-bar .shuffle') ||
                              document.querySelector('ytmusic-player-bar [aria-label*="Shuffle"]') ||
                              document.querySelector('ytmusic-player-bar [aria-label*="shuffle"]');
        if (nativeShuffle) nativeShuffle.click();
        btnShuffle.classList.toggle('ytm-active');
      });
    }

    const btnRepeat = document.getElementById('ytm-queue-repeat');
    if (btnRepeat) {
      btnRepeat.addEventListener('click', () => {
        const nativeRepeat = document.querySelector('ytmusic-player-bar .repeat') ||
                             document.querySelector('ytmusic-player-bar [aria-label*="Repeat"]') ||
                             document.querySelector('ytmusic-player-bar [aria-label*="repeat"]');
        if (nativeRepeat) nativeRepeat.click();
        btnRepeat.classList.toggle('ytm-active');
      });
    }

    const btnAutoplay = document.getElementById('ytm-queue-autoplay');
    if (btnAutoplay) {
      btnAutoplay.addEventListener('click', () => {
        btnAutoplay.classList.toggle('ytm-active');
      });
    }

    // Player View: Mini Lyrics preview flips to lyrics view
    const previewEl = document.getElementById('ytm-player-view-lyrics-preview');
    if (previewEl) {
      previewEl.addEventListener('click', () => setModalMode('lyrics'));
    }

    // Player View transport buttons
    const playBtn = document.getElementById('ytm-player-ctrl-play');
    if (playBtn) playBtn.addEventListener('click', () => sendPlayerCommand('TOGGLE_PLAY'));

    const prevBtn = document.getElementById('ytm-player-ctrl-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => sendPlayerCommand('PREV'));

    const nextBtn = document.getElementById('ytm-player-ctrl-next');
    if (nextBtn) nextBtn.addEventListener('click', () => sendPlayerCommand('NEXT'));

    const likeBtn = document.getElementById('ytm-player-view-like-btn');
    if (likeBtn) likeBtn.addEventListener('click', () => sendPlayerCommand('TOGGLE_LIKE'));

    // Seekbar
    const seekbar = document.getElementById('ytm-player-seekbar');
    if (seekbar) {
      seekbar.addEventListener('input', () => {
        const curTimeEl = document.getElementById('ytm-player-time-current');
        const remTimeEl = document.getElementById('ytm-player-time-remaining');
        const curSec = Number(seekbar.value);
        const durSec = Number(seekbar.max) || 0;
        if (curTimeEl) curTimeEl.textContent = formatSeconds(curSec);
        if (remTimeEl) remTimeEl.textContent = '-' + formatSeconds(Math.max(0, durSec - curSec));
        const pct = durSec > 0 ? (curSec / durSec) * 100 : 0;
        seekbar.style.setProperty('--ytm-slider-fill', `${pct.toFixed(1)}%`);
      });
      seekbar.addEventListener('change', () => {
        sendPlayerCommand('SEEK', Number(seekbar.value));
      });
    }

    // Volume slider
    const volumeSlider = document.getElementById('ytm-player-volume-slider');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        const val = Number(volumeSlider.value);
        sendPlayerCommand('SET_VOLUME', val);
        volumeSlider.style.setProperty('--ytm-slider-fill', `${(val * 100).toFixed(1)}%`);
      });
    }

    const refreshBtn = document.getElementById('ytm-lyrics-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('ytml:retry-search'));
      });
    }

    // Escape closes provider popup if open, else closes full page
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const popupEl = document.getElementById('ytm-provider-popup');
        if (popupEl && popupEl.classList.contains('ytm-popup-open')) {
          e.stopPropagation();
          toggleProviderPopup(false);
          return;
        }
        if (isFullPageOpen) closeFullLyricsPage();
      }
    }, true);

    // Lyrics Footer Source -> Toggles Lyrics Provider Management Popover
    const footerSrcEl = document.getElementById('ytm-lyrics-footer-source');
    if (footerSrcEl) {
      footerSrcEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleProviderPopup();
      });
    }

    const romanBtn = document.getElementById('ytm-lyrics-romanize-btn');
    if (romanBtn) {
      romanBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isRomanizeActive = !isRomanizeActive;
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.set({ lyricsRomanize: isRomanizeActive });
        }
        updateSubtextVisibility();
        if (isRomanizeActive && currentLines.length > 0) {
          ensureSubtextLoaded();
        }
      });
    }

    const transBtn = document.getElementById('ytm-lyrics-translate-btn');
    if (transBtn) {
      transBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isTranslateActive = !isTranslateActive;
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.set({ lyricsTranslate: isTranslateActive });
        }
        updateSubtextVisibility();
        if (isTranslateActive && currentLines.length > 0) {
          ensureSubtextLoaded();
        }
      });
    }

    const popupCloseBtn = document.getElementById('ytm-popup-close-btn');
    if (popupCloseBtn) {
      popupCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleProviderPopup(false);
      });
    }

    const popupRefreshBtn = document.getElementById('ytm-popup-refresh-btn');
    if (popupRefreshBtn) {
      popupRefreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRefreshSpinning(true);
        if (footerSrcEl) footerSrcEl.textContent = 'Getting the lyrics...';
        showLoadingState();
        window.dispatchEvent(new CustomEvent('ytml:retry-search'));
      });
    }

    const popupMinusBtn = document.getElementById('ytm-popup-offset-minus');
    if (popupMinusBtn) {
      popupMinusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustOffset(-100);
      });
    }

    const popupPlusBtn = document.getElementById('ytm-popup-offset-plus');
    if (popupPlusBtn) {
      popupPlusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adjustOffset(100);
      });
    }

    const popupResetBtn = document.getElementById('ytm-popup-offset-reset');
    if (popupResetBtn) {
      popupResetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetOffset();
      });
    }

    const providerPopupEl = document.getElementById('ytm-provider-popup');
    if (providerPopupEl) {
      providerPopupEl.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    document.getElementById('ytm-fullscreen-btn').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        fullPageEl.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    const srcBtn = document.getElementById('ytm-source-btn');
    srcBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fullSourceDropdownEl.classList.toggle('ytm-dropdown-open');
    });

    document.getElementById('ytm-offset-minus').addEventListener('click', () => adjustOffset(-200));
    document.getElementById('ytm-offset-plus').addEventListener('click', () => adjustOffset(200));
    document.getElementById('ytm-offset-reset').addEventListener('click', () => resetOffset());

    fullScrollContainer.addEventListener('wheel', () => handleFullUserScroll(), { passive: true });
    fullScrollContainer.addEventListener('touchmove', () => handleFullUserScroll(), { passive: true });

    fullResumeBtn.addEventListener('click', () => {
      isFullUserScrolling = false;
      fullResumeBtn.classList.remove('ytm-pill-visible');
      if (lastActiveIdx >= 0 && fullLineElements[lastActiveIdx]) {
        scrollToActiveLine(fullScrollContainer, fullLineElements[lastActiveIdx]);
      }
    });

    document.addEventListener('click', (e) => {
      if (fullSourceDropdownEl) fullSourceDropdownEl.classList.remove('ytm-dropdown-open');
      if (tabSourceDropdownEl) tabSourceDropdownEl.classList.remove('ytm-dropdown-open');
      const popupEl = document.getElementById('ytm-provider-popup');
      if (popupEl && popupEl.classList.contains('ytm-popup-open')) {
        const footerEl = document.getElementById('ytm-lyrics-footer-source');
        if (!popupEl.contains(e.target) && e.target !== footerEl && !footerEl?.contains(e.target)) {
          toggleProviderPopup(false);
        }
      }
    });
  }

  // ─── 2. Default YouTube Music Lyrics Tab Integration ─────────────────────────

  function getTabTarget() {
    let target = document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');
    if (target) return target;

    const customRenderer = document.querySelector('.ytm-custom-lyrics-tab-renderer');
    if (customRenderer) return customRenderer;

    const shelf = document.querySelector('ytmusic-description-shelf-renderer');
    if (shelf) {
      target = shelf.closest('ytmusic-tab-renderer') || shelf.parentElement;
      if (target) return target;
    }

    const tabRendererContainer = document.querySelector('ytmusic-player-page #tab-renderer') ||
                                 document.querySelector('#tab-renderer');
    if (tabRendererContainer) {
      target = tabRendererContainer.querySelector('[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');
      if (target) return target;

      const existing = tabRendererContainer.querySelector('.ytm-custom-lyrics-tab-renderer');
      if (existing) return existing;

      // Create a dedicated custom lyrics tab renderer!
      const newRenderer = document.createElement('div');
      newRenderer.className = 'ytm-custom-lyrics-tab-renderer style-scope ytmusic-player-page';
      newRenderer.setAttribute('page-type', 'MUSIC_PAGE_TYPE_TRACK_LYRICS');
      newRenderer.style.cssText = 'width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden;';

      if (tabRendererContainer.children.length > 1) {
        tabRendererContainer.insertBefore(newRenderer, tabRendererContainer.children[1]);
      } else {
        tabRendererContainer.appendChild(newRenderer);
      }
      return newRenderer;
    }
    return null;
  }

  function mountLyricsInTab() {
    const tabTarget = getTabTarget();
    if (!tabTarget) return;

    tabStreamEl = document.getElementById('ytm-tab-stream');
    tabScrollContainer = document.getElementById('ytm-tab-scroll-container');
    tabResumeBtn = document.getElementById('ytm-tab-resume-btn');
    tabSourceDropdownEl = document.getElementById('ytm-tab-source-dropdown');
    tabOffsetDisplayEl = document.getElementById('ytm-tab-offset-val');

    const existingTabView = document.getElementById(TAB_VIEW_ID);
    if (existingTabView) {
      if (existingTabView.parentElement === tabTarget) {
        if (currentLines.length > 0 && tabStreamEl) {
          if (tabLineElements.length === 0 || tabStreamEl.querySelectorAll('.ytm-lyric-row').length === 0) {
            renderLyricsStreamInto(tabStreamEl, tabLineElements, 'tab');
          }
        }
        return;
      }
      existingTabView.remove();
    }

    // Hide native static lyrics description / "Lyrics not available"
    tabTarget.classList.add('ytm-enhanced-tab-host');

    const tabView = document.createElement('div');
    tabView.id = TAB_VIEW_ID;
    tabView.className = 'ytm-tab-lyrics-container';

    tabView.innerHTML = `
      <div class="ytm-tab-header">
        <div class="ytm-tab-header-left">
          <button id="ytm-tab-refresh-btn" class="ytm-pill-btn ytm-btn-compact ytm-refresh-btn" title="Refresh & re-race all 13 lyrics providers">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            <span>Retry</span>
          </button>

          <div class="ytm-source-selector">
            <button id="ytm-tab-source-btn" class="ytm-source-btn ytm-btn-compact">
              <span id="ytm-tab-source-label">Auto</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div id="ytm-tab-source-dropdown" class="ytm-dropdown-menu"></div>
          </div>

          <div class="ytm-offset-controls ytm-controls-compact" title="Adjust lyrics timing">
            <button id="ytm-tab-offset-minus" class="ytm-pill-btn">−</button>
            <span id="ytm-tab-offset-val">0.0s</span>
            <button id="ytm-tab-offset-plus" class="ytm-pill-btn">+</button>
            <button id="ytm-tab-offset-reset" class="ytm-pill-btn ytm-reset-btn" title="Reset">⟲</button>
          </div>

          <button id="ytm-tab-romanize-btn" class="ytm-pill-btn ytm-btn-compact" title="Romanise lyrics">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span>Rom</span>
          </button>
          <button id="ytm-tab-translate-btn" class="ytm-pill-btn ytm-btn-compact" title="Translate lyrics to English">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
            </svg>
            <span>Trans</span>
          </button>
        </div>

        <button id="ytm-tab-expand-btn" class="ytm-tab-expand-btn" title="Expand to Apple Music Full View (L)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
          </svg>
          <span>Full View</span>
        </button>
      </div>

      <div class="ytm-tab-lyrics-scroll" id="ytm-tab-scroll-container">
        <div class="ytm-lyrics-stream ytm-tab-stream" id="ytm-tab-stream">
          <div class="ytm-loading-state">
            <div class="ytm-spinner"></div>
            <p>Finding synced lyrics...</p>
          </div>
        </div>

        <button id="ytm-tab-resume-btn" class="ytm-resume-sync-pill">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          Resume Sync
        </button>
      </div>
    `;

    // Insert as first child of tab target
    tabTarget.insertBefore(tabView, tabTarget.firstChild);

    tabViewEl = tabView;
    tabScrollContainer = document.getElementById('ytm-tab-scroll-container');
    tabStreamEl = document.getElementById('ytm-tab-stream');
    tabResumeBtn = document.getElementById('ytm-tab-resume-btn');
    tabSourceDropdownEl = document.getElementById('ytm-tab-source-dropdown');
    tabOffsetDisplayEl = document.getElementById('ytm-tab-offset-val');

    bindTabViewEvents();
    updateSourceDropdowns();
    updateOffsetDisplays();

    // Render current lyrics if available
    if (currentLines.length > 0) {
      renderLyricsStreamInto(tabStreamEl, tabLineElements, 'tab');
    }
  }

  function bindTabViewEvents() {
    document.getElementById('ytm-tab-expand-btn').addEventListener('click', () => {
      openFullLyricsPage();
    });

    const tabRefreshBtn = document.getElementById('ytm-tab-refresh-btn');
    if (tabRefreshBtn) {
      tabRefreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('ytml:retry-search'));
      });
    }

    const srcBtn = document.getElementById('ytm-tab-source-btn');
    srcBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tabSourceDropdownEl.classList.toggle('ytm-dropdown-open');
    });

    document.getElementById('ytm-tab-offset-minus').addEventListener('click', () => adjustOffset(-200));
    document.getElementById('ytm-tab-offset-plus').addEventListener('click', () => adjustOffset(200));
    document.getElementById('ytm-tab-offset-reset').addEventListener('click', () => resetOffset());

    const tabRomanBtn = document.getElementById('ytm-tab-romanize-btn');
    if (tabRomanBtn) {
      tabRomanBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isRomanizeActive = !isRomanizeActive;
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.set({ lyricsRomanize: isRomanizeActive });
        }
        updateSubtextVisibility();
        if (isRomanizeActive && currentLines.length > 0) {
          ensureSubtextLoaded();
        }
      });
    }

    const tabTransBtn = document.getElementById('ytm-tab-translate-btn');
    if (tabTransBtn) {
      tabTransBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isTranslateActive = !isTranslateActive;
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.set({ lyricsTranslate: isTranslateActive });
        }
        updateSubtextVisibility();
        if (isTranslateActive && currentLines.length > 0) {
          ensureSubtextLoaded();
        }
      });
    }

    tabScrollContainer.addEventListener('wheel', () => handleTabUserScroll(), { passive: true });
    tabScrollContainer.addEventListener('touchmove', () => handleTabUserScroll(), { passive: true });

    tabResumeBtn.addEventListener('click', () => {
      isTabUserScrolling = false;
      tabResumeBtn.classList.remove('ytm-pill-visible');
      if (lastActiveIdx >= 0 && tabLineElements[lastActiveIdx]) {
        scrollToActiveLine(tabScrollContainer, tabLineElements[lastActiveIdx]);
      }
    });
  }

  function handleFullUserScroll() {
    isFullUserScrolling = true;
    fullResumeBtn.classList.add('ytm-pill-visible');
    clearTimeout(fullUserScrollTimeout);
    fullUserScrollTimeout = setTimeout(() => {
      isFullUserScrolling = false;
      fullResumeBtn.classList.remove('ytm-pill-visible');
    }, 4500);
  }

  function handleTabUserScroll() {
    isTabUserScrolling = true;
    tabResumeBtn.classList.add('ytm-pill-visible');
    clearTimeout(tabUserScrollTimeout);
    tabUserScrollTimeout = setTimeout(() => {
      isTabUserScrolling = false;
      tabResumeBtn.classList.remove('ytm-pill-visible');
    }, 4500);
  }

  function adjustOffset(deltaMs) {
    timingOffsetMs += deltaMs;
    updateOffsetDisplays();
  }

  function resetOffset() {
    timingOffsetMs = 0;
    updateOffsetDisplays();
  }

  function updateOffsetDisplays() {
    const sec = (timingOffsetMs / 1000).toFixed(1);
    const text = `${timingOffsetMs > 0 ? '+' : ''}${sec}s`;
    if (fullOffsetDisplayEl) fullOffsetDisplayEl.textContent = text;
    if (tabOffsetDisplayEl) tabOffsetDisplayEl.textContent = text;
    const popupOffsetEl = document.getElementById('ytm-popup-offset-val');
    if (popupOffsetEl) popupOffsetEl.textContent = text;
  }

  // ─── 3. Lyrics Rendering & DOM Construction ──────────────────────────────────

  function renderLyricsStreamInto(streamEl, lineElementsArr, mode) {
    if (!streamEl) return;
    streamEl.innerHTML = '';
    lineElementsArr.length = 0;

    if (!isPlainMode) {
      const topSpacer = document.createElement('div');
      topSpacer.className = 'ytm-stream-spacer';
      streamEl.appendChild(topSpacer);
    }

    currentLines.forEach((line, idx) => {
      const align = (line.alignment || 'start').toLowerCase();
      const lineRow = document.createElement('div');
      lineRow.className = `ytm-lyric-row ytm-align-${align} ${mode === 'tab' ? 'ytm-tab-row' : ''} ${isPlainMode ? 'ytm-plain-row' : ''}`;
      lineRow.dataset.index = idx;
      lineRow.dataset.timeMs = line.timeMs || 0;

      if (isPlainMode) {
        // Plain unsynced lyrics: all lines clearly readable, 0% blur, no timing animations
        lineRow.style.filter = 'none';
        lineRow.style.opacity = '0.92';

        const leadEl = document.createElement('div');
        leadEl.className = 'ytm-lead-vocal';
        const textSpan = document.createElement('span');
        textSpan.className = 'ytm-line-text';
        textSpan.textContent = line.text;
        leadEl.appendChild(textSpan);
        lineRow.appendChild(leadEl);

        const subWrap = document.createElement('div');
        subWrap.className = 'ytm-subtext-wrap';
        const romanEl = document.createElement('div');
        romanEl.className = 'ytm-subtext-line ytm-subtext-roman';
        romanEl.textContent = line.roman || '';
        const transEl = document.createElement('div');
        transEl.className = 'ytm-subtext-line ytm-subtext-trans';
        transEl.textContent = line.translation || '';
        subWrap.appendChild(romanEl);
        subWrap.appendChild(transEl);
        lineRow.appendChild(subWrap);
      } else if (line.isGap) {
        lineRow.classList.add('ytm-gap-row');
        lineRow.innerHTML = `
          <div class="ytm-gap-dots">
            <span class="ytm-dot"></span>
            <span class="ytm-dot"></span>
            <span class="ytm-dot"></span>
          </div>
        `;
      } else {
        const leadEl = document.createElement('div');
        leadEl.className = 'ytm-lead-vocal';

        if (line.isWordSynced) {
          let charOffset = 0;
          line.words.forEach((word, wIdx) => {
            const wStart = line.text.indexOf(word.text, charOffset);
            if (wStart > charOffset) {
              leadEl.appendChild(document.createTextNode(line.text.slice(charOffset, wStart)));
            }

            const wordSpan = document.createElement('span');
            wordSpan.className = 'ytm-word';
            wordSpan.dataset.wordIndex = wIdx;

            // Wrap each grapheme cluster (akshara / letter) in its own span for wave fill animation
            const graphemes = splitIntoGraphemes(word.text);
            for (const ch of graphemes) {
              const charSpan = document.createElement('span');
              charSpan.className = 'ytm-char';
              charSpan.textContent = ch;
              wordSpan.appendChild(charSpan);
            }

            leadEl.appendChild(wordSpan);

            charOffset = (wStart >= 0 ? wStart : charOffset) + word.text.length;
          });

          if (charOffset < line.text.length) {
            leadEl.appendChild(document.createTextNode(line.text.slice(charOffset)));
          }
        } else {
          const textSpan = document.createElement('span');
          textSpan.className = 'ytm-line-text';
          textSpan.textContent = line.text;
          leadEl.appendChild(textSpan);
        }

        lineRow.appendChild(leadEl);

        // Answering / background vocal
        if (line.background) {
          const bgEl = document.createElement('div');
          bgEl.className = 'ytm-bg-vocal';
          if (line.background.isWordSynced) {
            line.background.words.forEach(w => {
              const wSpan = document.createElement('span');
              wSpan.className = 'ytm-bg-word';
              wSpan.textContent = w.text + ' ';
              bgEl.appendChild(wSpan);
            });
          } else {
            bgEl.textContent = line.background.text;
          }
          lineRow.appendChild(bgEl);
        }

        const subWrap = document.createElement('div');
        subWrap.className = 'ytm-subtext-wrap';
        const romanEl = document.createElement('div');
        romanEl.className = 'ytm-subtext-line ytm-subtext-roman';
        romanEl.textContent = line.roman || '';
        const transEl = document.createElement('div');
        transEl.className = 'ytm-subtext-line ytm-subtext-trans';
        transEl.textContent = line.translation || '';
        subWrap.appendChild(romanEl);
        subWrap.appendChild(transEl);
        lineRow.appendChild(subWrap);

        // Interactive Click to Seek
        lineRow.addEventListener('click', () => {
          seekToTimestamp(line.timeMs);
        });
      }

      streamEl.appendChild(lineRow);
      lineElementsArr.push(lineRow);
    });

    if (!isPlainMode) {
      const botSpacer = document.createElement('div');
      botSpacer.className = 'ytm-stream-spacer';
      streamEl.appendChild(botSpacer);
    }
  }

  function seekToTimestamp(targetMs) {
    const video = document.querySelector('video');
    if (!video) return;
    const seekSec = Math.max(0, (targetMs - timingOffsetMs) / 1000);
    video.currentTime = seekSec;
    if (video.paused) video.play().catch(() => {});
  }

  // ─── 4. 60 FPS Real-Time Animation Loop ──────────────────────────────────────

  function startRafLoop() {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  }

  function stopRafLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function tick() {
    if (isPlainMode) {
      stopRafLoop();
      return;
    }
    rafId = requestAnimationFrame(tick);
    if (currentLines.length === 0) return;

    const video = document.querySelector('video');
    if (!video) return;

    const posMs = (video.currentTime * 1000) + timingOffsetMs + LOOKAHEAD_MS;
    updateHighlight(posMs);
  }

  function updateHighlight(posMs) {
    if (isPlainMode) return;
    let activeIdx = -1;
    for (let i = 0; i < currentLines.length; i++) {
      if (currentLines[i].timeMs <= posMs) {
        activeIdx = i;
      } else {
        break;
      }
    }

    const isChanged = activeIdx !== lastActiveIdx;

    // Update lines in both full page and tab view
    if (fullLineElements.length > 0) {
      animateLineSet(fullLineElements, activeIdx, posMs);
    }
    if (tabLineElements.length > 0) {
      animateLineSet(tabLineElements, activeIdx, posMs);
    }

    if (isChanged && activeIdx >= 0) {
      lastActiveIdx = activeIdx;
      // Auto-scroll full view if open
      if (isFullPageOpen && !isFullUserScrolling && fullLineElements[activeIdx]) {
        scrollToActiveLine(fullScrollContainer, fullLineElements[activeIdx]);
      }
      // Auto-scroll tab view
      if (!isTabUserScrolling && tabLineElements[activeIdx]) {
        scrollToActiveLine(tabScrollContainer, tabLineElements[activeIdx]);
      }

      // Update Mini Lyrics preview row in Player view
      const previewTextEl = document.getElementById('ytm-player-lyrics-preview-text');
      if (previewTextEl && currentLines[activeIdx]) {
        previewTextEl.textContent = currentLines[activeIdx].text || '...';
      }
    }
  }

  function animateLineSet(elementsArr, activeIdx, posMs) {
    currentLines.forEach((line, idx) => {
      const rowEl = elementsArr[idx];
      if (!rowEl) return;

      const dist = Math.abs(idx - activeIdx);

      if (idx === activeIdx) {
        rowEl.classList.remove('ytm-row-past', 'ytm-row-future');
        rowEl.classList.add('ytm-row-active');
        rowEl.style.filter = 'none';
        rowEl.style.opacity = '1';

        if (line.isGap) {
          rowEl.classList.add('ytm-gap-active');
        } else if (line.isWordSynced) {
          animateWordSpans(rowEl, line, posMs);
        } else {
          animateLineGradient(rowEl, line, posMs);
        }

        if (line.background) {
          animateBackgroundVocal(rowEl, line.background, posMs);
        }
      } else {
        rowEl.classList.remove('ytm-row-active', 'ytm-gap-active');
        if (idx < activeIdx) {
          rowEl.classList.add('ytm-row-past');
          rowEl.classList.remove('ytm-row-future');
        } else {
          rowEl.classList.add('ytm-row-future');
          rowEl.classList.remove('ytm-row-past');
        }

        applyFocusFalloff(rowEl, dist);
      }
    });
  }

  function animateWordSpans(rowEl, line, posMs) {
    const spans = rowEl.querySelectorAll('.ytm-word');
    spans.forEach((span, i) => {
      const word = line.words[i];
      if (!word) return;

      const isPast    = posMs > word.endMs;
      const isCurrent = posMs >= word.startMs && posMs <= word.endMs;

      const charSpans = span.querySelectorAll('.ytm-char');
      const n = charSpans.length || 1;

      if (isPast) {
        // Word completed — settled white at normal baseline
        span.style.opacity   = '1';
        span.style.transform = 'translateY(0)';
        span.style.filter    = 'none';
        charSpans.forEach(cs => {
          cs.style.setProperty('--ytm-char-fill', '1');
        });
      } else if (isCurrent) {
        const duration = Math.max(1, word.endMs - word.startMs);
        const elapsed  = posMs - word.startMs;
        const progress = Math.min(1, elapsed / duration); // 0 → 1

        // Whole-word vertical lift: the word lifts up smoothly as a single unit (no size scaling)
        const lift = line.wordLift ? line.wordLift(i, posMs) : Math.sin(progress * Math.PI);
        const translateY = -(lift * 4); // ~4px vertical lift for the entire word

        span.style.opacity   = '1';
        span.style.transform = `translateY(${translateY.toFixed(2)}px)`;
        span.style.filter    = 'drop-shadow(0 0 10px rgba(255, 255, 255, 0.45))';

        charSpans.forEach((cs, ci) => {
          // Fill sweeps left-to-right across characters
          const charStart = ci / n;
          const charEnd   = (ci + 1) / n;
          const charFill  = Math.max(0, Math.min(1, (progress - charStart) / (charEnd - charStart)));

          cs.style.setProperty('--ytm-char-fill', String(charFill));
        });
      } else {
        // Future word
        span.style.opacity   = '0.28';
        span.style.transform = 'translateY(0)';
        span.style.filter    = 'none';
        charSpans.forEach(cs => {
          cs.style.setProperty('--ytm-char-fill', '0');
        });
      }
    });
  }

  function animateLineGradient(rowEl, line, posMs) {
    const textEl = rowEl.querySelector('.ytm-line-text');
    if (!textEl) return;

    const revealed = line.revealedChars(posMs);
    const total = line.text.length;
    const pct = total > 0 ? Math.min(100, (revealed / total) * 100) : 100;

    // Blurred, glowing sweep edge instead of a hard plain line
    const lead  = Math.max(0, pct - 10);
    const trail = Math.min(100, pct + 12);
    textEl.style.backgroundImage = `linear-gradient(to right, #ffffff ${lead}%, rgba(255,255,255,0.85) ${pct}%, rgba(255,255,255,0.28) ${trail}%)`;
    textEl.style.webkitBackgroundClip = 'text';
    textEl.style.backgroundClip = 'text';
    textEl.style.webkitTextFillColor = 'transparent';
    textEl.style.filter = pct > 0 && pct < 100 ? 'drop-shadow(0 0 12px rgba(255,255,255,0.4))' : 'none';
  }

  function animateBackgroundVocal(rowEl, bgLine, posMs) {
    const bgEl = rowEl.querySelector('.ytm-bg-vocal');
    if (!bgEl) return;

    const startMs = bgLine.timeMs || 0;
    const endMs   = bgLine.endMs   || startMs;

    if (posMs < startMs) {
      // Not yet — completely hidden
      bgEl.style.opacity    = '0';
      bgEl.style.transform  = 'translateY(4px)';
      bgEl.style.filter     = 'none';
      bgEl.style.visibility = 'hidden';
    } else if (posMs >= startMs && posMs <= endMs) {
      // Actively being sung — bright and lifted in
      bgEl.style.visibility = 'visible';
      bgEl.style.opacity    = '0.92';
      bgEl.style.transform  = 'translateY(0)';
      bgEl.style.filter     = 'brightness(1.25)';
    } else {
      // Done — dimmed but still visible (faded echo)
      bgEl.style.visibility = 'visible';
      bgEl.style.opacity    = '0.55';
      bgEl.style.transform  = 'translateY(0)';
      bgEl.style.filter     = 'none';
    }
  }

  function applyFocusFalloff(rowEl, dist) {
    if (dist === 0) {
      rowEl.style.filter  = 'none';
      rowEl.style.opacity = '1';
      return;
    }

    // Subtle Apple Music depth-of-field: gentle lens softening that keeps upcoming lyrics readable
    const blur = dist === 1 ? 0.7
               : dist === 2 ? 1.5
               : dist === 3 ? 2.4
               : Math.min(3.8, 2.4 + (dist - 3) * 0.5);

    const opacity = dist === 1 ? 0.70
                  : dist === 2 ? 0.52
                  : dist === 3 ? 0.38
                  : Math.max(0.22, 0.38 - (dist - 3) * 0.04);

    rowEl.style.filter  = `blur(${blur.toFixed(1)}px)`;
    rowEl.style.opacity = opacity.toFixed(2);
  }

  function scrollToActiveLine(container, targetRow) {
    if (!container || !targetRow) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = targetRow.getBoundingClientRect();
    const relativeTop = rowRect.top - containerRect.top + container.scrollTop;
    const targetScroll = relativeTop - (container.clientHeight * SCROLL_OFFSET_RATIO);

    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    });
  }

  // ─── 5. Public Controls & Lifecycle ──────────────────────────────────────────

  function openFullLyricsPage(initialMode) {
    initFullLyricsPage();
    if (initialMode) {
      setModalMode(initialMode);
    }
    isFullPageOpen = true;
    fullPageEl.classList.add('ytm-page-open');
    document.body.classList.add('ytm-lyrics-open');
    if (currentTrackMeta.artwork) {
      updateBackdropImage(currentTrackMeta.artwork);
    }
    if (meshBackdrop) meshBackdrop.start();
    if (!isPlainMode) {
      startRafLoop();
    }
    chrome.storage.local.set({ lyricsPageOpen: true });
    window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_QUEUE' }, '*');
    window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
  }

  function closeFullLyricsPage() {
    if (!fullPageEl) return;
    isFullPageOpen = false;
    fullPageEl.classList.remove('ytm-page-open');
    document.body.classList.remove('ytm-lyrics-open');
    meshBackdrop.stop();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    chrome.storage.local.set({ lyricsPageOpen: false });
  }

  function toggleFullLyricsPage(initialMode) {
    if (isFullPageOpen) {
      if (initialMode && currentModalMode !== initialMode) {
        setModalMode(initialMode);
      } else {
        closeFullLyricsPage();
      }
    } else {
      openFullLyricsPage(initialMode);
    }
  }

  function updateTrackMeta(meta) {
    currentTrackMeta = { ...currentTrackMeta, ...meta };
    initFullLyricsPage();
    mountLyricsInTab();

    const artImg = document.getElementById('ytm-lyrics-art');
    const playerTitle = document.getElementById('ytm-player-view-title');
    const playerArtist = document.getElementById('ytm-player-view-artist');
    const queueTitle = document.getElementById('ytm-queue-now-title');
    const queueArtist = document.getElementById('ytm-queue-now-artist');
    const queueImg = document.getElementById('ytm-queue-now-img');

    if (meta.artwork && artImg) {
      artImg.src = meta.artwork;
      updateBackdropImage(meta.artwork);
      if (meshBackdrop) meshBackdrop.sampleFromImage(artImg);
    }
    if (playerTitle) playerTitle.textContent = meta.title || '—';
    if (playerArtist) playerArtist.textContent = meta.artist || '—';
    if (queueTitle) queueTitle.textContent = meta.title || '—';
    if (queueArtist) queueArtist.textContent = meta.artist || '—';
    if (queueImg && meta.artwork) queueImg.src = meta.artwork;
  }

  function updatePlayerState(state) {
    currentPlayerState = { ...currentPlayerState, ...state };

    const playBtnSvg = document.getElementById('ytm-play-icon-svg');
    if (playBtnSvg) {
      if (currentPlayerState.isPaused) {
        playBtnSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      } else {
        playBtnSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      }
    }

    const curTimeEl = document.getElementById('ytm-player-time-current');
    const remTimeEl = document.getElementById('ytm-player-time-remaining');
    const seekbar = document.getElementById('ytm-player-seekbar');

    const curSec = currentPlayerState.currentTime || 0;
    const durSec = currentPlayerState.duration || 0;
    const remSec = Math.max(0, durSec - curSec);

    if (curTimeEl) curTimeEl.textContent = formatSeconds(curSec);
    if (remTimeEl) remTimeEl.textContent = '-' + formatSeconds(remSec);

    if (seekbar && !seekbar.matches(':active')) {
      seekbar.max = durSec > 0 ? String(durSec) : '100';
      seekbar.value = String(curSec);
      const pct = durSec > 0 ? (curSec / durSec) * 100 : 0;
      seekbar.style.setProperty('--ytm-slider-fill', `${pct.toFixed(1)}%`);
    }

    const volSlider = document.getElementById('ytm-player-volume-slider');
    if (volSlider && !volSlider.matches(':active')) {
      volSlider.value = String(currentPlayerState.volume ?? 1);
      const vPct = (Number(volSlider.value) * 100).toFixed(1);
      volSlider.style.setProperty('--ytm-slider-fill', `${vPct}%`);
    }
  }

  function updateQueue(queueItems) {
    currentQueue = Array.isArray(queueItems) ? queueItems : [];
    const container = document.getElementById('ytm-queue-items-container');
    if (!container) return;

    container.innerHTML = '';
    currentQueue.forEach((item) => {
      const row = document.createElement('div');
      row.className = `ytm-queue-item-row ${item.isSelected ? 'ytm-queue-item-active' : ''}`;
      row.innerHTML = `
        <div class="ytm-queue-drag-handle" title="Drag">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 9h16v2H4zm0 4h16v2H4z"/></svg>
        </div>
        <img class="ytm-queue-thumb" src="${item.artwork || ''}" alt="" />
        <div class="ytm-queue-item-meta">
          <div class="ytm-queue-item-title">${item.title}</div>
          <div class="ytm-queue-item-artist">${item.artist}</div>
        </div>
        <button class="ytm-queue-remove-btn" title="Remove from queue">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.ytm-queue-remove-btn')) {
          e.stopPropagation();
          row.style.opacity = '0';
          setTimeout(() => row.remove(), 200);
          return;
        }
        sendPlayerCommand('PLAY_QUEUE_INDEX', item.index);
      });

      container.appendChild(row);
    });
  }

  function syncDomReferences() {
    fullStreamEl = document.getElementById('ytm-lyrics-stream') || fullStreamEl;
    tabStreamEl = document.getElementById('ytm-tab-stream') || tabStreamEl;
    fullScrollContainer = document.getElementById('ytm-lyrics-scroll-container') || fullScrollContainer;
    tabScrollContainer = document.getElementById('ytm-tab-scroll-container') || tabScrollContainer;
    fullResumeBtn = document.getElementById('ytm-resume-sync-btn') || fullResumeBtn;
    tabResumeBtn = document.getElementById('ytm-tab-resume-btn') || tabResumeBtn;
  }

  function setLyricsData(activeResult, allResultsMap) {
    initFullLyricsPage();
    mountLyricsInTab();
    syncDomReferences();

    activeSource = activeResult?.source || null;
    availableSources = allResultsMap || new Map();

    isPlainMode = Boolean(
      activeResult?.isPlain ||
      (!activeResult?.isWordSynced && (!activeResult?.lines || !activeResult.lines.some(l => (l.timeMs || 0) > 0)))
    );

    if (fullScrollContainer) fullScrollContainer.classList.toggle('ytm-plain-lyrics-mode', isPlainMode);
    if (tabScrollContainer) tabScrollContainer.classList.toggle('ytm-plain-lyrics-mode', isPlainMode);
    if (fullStreamEl) fullStreamEl.classList.toggle('ytm-plain-lyrics-stream', isPlainMode);
    if (tabStreamEl) tabStreamEl.classList.toggle('ytm-plain-lyrics-stream', isPlainMode);

    const footerSrcEl = document.getElementById('ytm-lyrics-footer-source');
    if (footerSrcEl) {
      const modeSuffix = isPlainMode ? ' (Plain)' : '';
      footerSrcEl.textContent = `Lyrics by ${activeResult?.label || activeResult?.source || 'lrc.red'}${modeSuffix}`;
    }

    updateSourceDropdowns();
    renderProviderPopup();

    if (!activeResult || !activeResult.lines || activeResult.lines.length === 0) {
      showNoLyricsState();
      return;
    }

    currentLines = activeResult.lines;
    lastActiveIdx = -1;

    renderLyricsStreamInto(fullStreamEl, fullLineElements, 'full');
    renderLyricsStreamInto(tabStreamEl, tabLineElements, 'tab');

    updateSubtextVisibility();
    if ((isRomanizeActive || isTranslateActive) && currentLines.length > 0) {
      ensureSubtextLoaded();
    }

    if (isPlainMode) {
      stopRafLoop();
      if (fullResumeBtn) fullResumeBtn.classList.remove('ytm-pill-visible');
      if (tabResumeBtn) tabResumeBtn.classList.remove('ytm-pill-visible');
      if (fullScrollContainer) fullScrollContainer.scrollTop = 0;
      if (tabScrollContainer) tabScrollContainer.scrollTop = 0;

      const previewTextEl = document.getElementById('ytm-player-lyrics-preview-text');
      if (previewTextEl && currentLines[0]) {
        previewTextEl.textContent = currentLines[0].text || '...';
      }
    } else {
      startRafLoop();
    }
  }

  function showLoadingState() {
    initFullLyricsPage();
    mountLyricsInTab();
    syncDomReferences();

    const footerSrcEl = document.getElementById('ytm-lyrics-footer-source');
    if (footerSrcEl) {
      footerSrcEl.textContent = 'Getting the lyrics';
    }
    renderProviderPopup();

    const loadingHtml = `
      <div class="ytm-loading-state">
        <div class="ytm-spinner"></div>
        <p>Finding synced lyrics...</p>
      </div>
    `;
    if (fullStreamEl) fullStreamEl.innerHTML = loadingHtml;
    if (tabStreamEl) tabStreamEl.innerHTML = loadingHtml;
  }

  function showNoLyricsState() {
    initFullLyricsPage();
    mountLyricsInTab();
    syncDomReferences();

    const footerSrcEl = document.getElementById('ytm-lyrics-footer-source');
    if (footerSrcEl) {
      footerSrcEl.textContent = 'Lyrics not found (manage providers)';
    }
    renderProviderPopup();

    const emptyHtml = `
      <div class="ytm-empty-state">
        <svg viewBox="0 0 24 24" width="44" height="44" fill="rgba(255,255,255,0.25)">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
        <h3>No Synced Lyrics Found</h3>
        <p>Searched across all 13 providers (lrc.red, BiniLyrics, BetterLyrics, Portato, PaxSenix, LyricsPlus, SimpMusic, Unison, KuGou, LRCLIB, Musixmatch, Genius, YT Music).</p>
        <button class="ytm-retry-btn">Retry Search</button>
      </div>
    `;
    if (fullStreamEl) fullStreamEl.innerHTML = emptyHtml;
    if (tabStreamEl) tabStreamEl.innerHTML = emptyHtml;

    document.querySelectorAll('.ytm-retry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showLoadingState();
        window.dispatchEvent(new CustomEvent('ytml:retry-search'));
      });
    });
  }

  function updateSourceDropdowns() {
    const fullLabelEl = document.getElementById('ytm-source-label');
    const tabLabelEl = document.getElementById('ytm-tab-source-label');

    const labelText = activeSource && availableSources.has(activeSource)
      ? (availableSources.get(activeSource).label || activeSource)
      : 'Auto';

    if (fullLabelEl) fullLabelEl.textContent = labelText;
    if (tabLabelEl) tabLabelEl.textContent = labelText;

    const populateMenu = (menuEl) => {
      if (!menuEl) return;
      menuEl.innerHTML = '';
      availableSources.forEach((res, srcName) => {
        const item = document.createElement('div');
        item.className = `ytm-dropdown-item ${srcName === activeSource ? 'ytm-dropdown-active' : ''}`;
        const badgeClass = res.isWordSynced ? 'ytm-badge-word' : (res.isPlain ? 'ytm-badge-plain' : 'ytm-badge-line');
        const badgeText = res.isWordSynced ? 'Syllable Sync' : (res.isPlain ? 'Plain' : 'Line Sync');

        item.innerHTML = `
          <span class="ytm-source-name">${res.label || srcName}</span>
          <span class="ytm-sync-badge ${badgeClass}">${badgeText}</span>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (fullSourceDropdownEl) fullSourceDropdownEl.classList.remove('ytm-dropdown-open');
          if (tabSourceDropdownEl) tabSourceDropdownEl.classList.remove('ytm-dropdown-open');
          setLyricsData(res, availableSources);
        });
        menuEl.appendChild(item);
      });
    };

    populateMenu(fullSourceDropdownEl);
    populateMenu(tabSourceDropdownEl);
  }

  function setRefreshSpinning(spinning) {
    document.querySelectorAll('.ytm-refresh-btn').forEach(btn => {
      if (spinning) {
        btn.classList.add('ytm-refreshing');
      } else {
        btn.classList.remove('ytm-refreshing');
      }
    });
  }

  window.__YTMLLyricsPage = {
    openFullLyricsPage,
    closeFullLyricsPage,
    toggleFullLyricsPage,
    openLyricsPage: openFullLyricsPage,
    closeLyricsPage: closeFullLyricsPage,
    toggleLyricsPage: toggleFullLyricsPage,
    setModalMode,
    updatePlayerState,
    updateQueue,
    mountLyricsInTab,
    updateTrackMeta,
    setLyricsData,
    showLoadingState,
    showNoLyricsState,
    setRefreshSpinning
  };
})();
