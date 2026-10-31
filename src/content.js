/**
 * YouTube Music Content Script Orchestrator.
 *
 * Integrates YouTube Music playback with the Apple Music Lyrics Experience:
 *   - Receives high-fidelity track data from main-world bridge (#movie_player, navigator.mediaSession)
 *   - Multi-source concurrent racing across all 13 BitChord providers
 *   - Native YouTube Music lyrics tab replacement with Apple Music aesthetic
 *   - Duet column alignment, background vocals, word/syllable lift, and breathing gaps
 *   - Bidirectional tab switching (Up Next, Lyrics, Related)
 *   - Full-screen Apple Music modal view with fluid animated mesh canvas backdrop
 *   - Interactive click-to-seek directly on lyric rows
 *   - Keyboard shortcut ('L') and toolbar button toggle
 */

(() => {
  'use strict';

  console.log('[AppleMusicLyrics] Content script initialized.');

  const SEL = {
    playerBar: 'ytmusic-player-bar',
    rightControls: 'ytmusic-player-bar .right-controls-buttons',
    video: 'video'
  };

  let currentTrackKey = '';
  let currentTrackMeta = { title: '', artist: '', durationMs: 0, videoId: '', artwork: '' };

  const {
    openFullLyricsPage,
    closeFullLyricsPage,
    toggleFullLyricsPage,
    openLyricsPage,
    closeLyricsPage,
    toggleLyricsPage,
    mountLyricsInTab,
    updateTrackMeta,
    setLyricsData,
    showLoadingState,
    showNoLyricsState
  } = window.__YTMLLyricsPage;

  // ─── 1. Main World Bridge Listener ───

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.source === 'ytml-main' && event.data.type === 'TRACK_CHANGE') {
      const meta = event.data.payload;
      if (meta && (meta.title || meta.videoId)) {
        handleIncomingTrackMeta(meta);
      }
    }
  });

  // Request track info from bridge immediately
  window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');

  window.addEventListener('ytml:retry-search', () => {
    currentTrackKey = '';
    window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
  });

  function handleIncomingTrackMeta(meta) {
    if (!meta.title && !meta.videoId) return;

    // Direct fallback if artist missing
    let artist = meta.artist || '';
    let title = meta.title || '';

    if (!title || !artist) {
      const dom = extractDomFallback();
      if (!title && dom.title) title = dom.title;
      if (!artist && dom.artist) artist = dom.artist;
      if (!meta.artwork && dom.artwork) meta.artwork = dom.artwork;
    }

    const durationMs = meta.durationMs || (document.querySelector('video')?.duration ? Math.round(document.querySelector('video').duration * 1000) : 0);
    const videoId = meta.videoId || (new URLSearchParams(window.location.search).get('v') || '');

    onSongChanged({
      title,
      artist,
      album: meta.album || '',
      artwork: meta.artwork || '',
      videoId,
      durationMs
    });
  }

  // ─── 2. DOM Fallback Extractor ───

  function extractDomFallback() {
    const titleSelectors = [
      'ytmusic-player-bar .title',
      'ytmusic-player-bar yt-formatted-string.title',
      'ytmusic-player-bar .content-info-wrapper .title',
      'ytmusic-player-bar .middle-controls .title',
      '#player-page .title',
      'ytmusic-player-page .title'
    ];

    let title = '';
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const text = el?.getAttribute('title') || el?.innerText || el?.textContent || '';
      if (text.trim()) {
        title = text.trim();
        break;
      }
    }

    const artistSelectors = [
      'ytmusic-player-bar .byline',
      'ytmusic-player-bar yt-formatted-string.byline',
      'ytmusic-player-bar .subtitle',
      'ytmusic-player-bar .byline a',
      'ytmusic-player-bar .subtitle a',
      '#player-page .byline',
      'ytmusic-player-page .byline'
    ];

    let artist = '';
    for (const sel of artistSelectors) {
      const el = document.querySelector(sel);
      const text = el?.getAttribute('title') || el?.innerText || el?.textContent || '';
      if (text.trim()) {
        const parts = text.split(/[•·]/).map(p => p.trim());
        artist = parts[0] || '';
        break;
      }
    }

    let artwork = '';
    const imgEl = document.querySelector('ytmusic-player-bar img#img') || document.querySelector('ytmusic-player-bar img');
    if (imgEl?.src) {
      artwork = imgEl.src.replace(/=w\d+-h\d+/, '=w600-h600').replace(/=s\d+/, '=s600');
    }

    return { title, artist, artwork };
  }

  // ─── 3. Song Changed Handler ───

  async function onSongChanged(info) {
    if (!info || !info.title) {
      const dom = extractDomFallback();
      if (!dom.title) return;
      info = {
        title: dom.title,
        artist: dom.artist,
        album: '',
        artwork: dom.artwork,
        videoId: new URLSearchParams(window.location.search).get('v') || '',
        durationMs: document.querySelector('video')?.duration ? Math.round(document.querySelector('video').duration * 1000) : 0
      };
    }

    const key = `${info.title}|${info.artist}|${info.videoId}|${Math.round(info.durationMs / 1000)}`;
    if (key === currentTrackKey) return;
    currentTrackKey = key;
    currentTrackMeta = info;

    console.log(`[AppleMusicLyrics] Track detected: "${info.title}" by "${info.artist || 'Unknown'}" (${Math.round(info.durationMs / 1000)}s)`);

    // 1. Update UI metadata and canvas palette immediately
    updateTrackMeta(info);
    showLoadingState();
    ensureLyricsTabReady();

    // 2. Race across all 13 BitChord providers concurrently
    try {
      const outcome = await window.__YTMLLyricsRepo.fetchLyrics(info, (activeResult, allResults) => {
        if (currentTrackKey === key) {
          console.log(`[AppleMusicLyrics] Progressive hit from ${activeResult.source} (${activeResult.isWordSynced ? 'Word/Syllable Sync' : 'Line Sync'})`);
          setLyricsData(activeResult, allResults);
          ensureLyricsTabReady();
        }
      });

      if (currentTrackKey === key) {
        if (outcome && outcome.activeResult) {
          console.log(`[AppleMusicLyrics] Winning lyrics provider: ${outcome.activeResult.source} (${outcome.activeResult.lines.length} lines, wordSynced: ${outcome.activeResult.isWordSynced})`);
          setLyricsData(outcome.activeResult, outcome.allResults);
        } else {
          console.warn(`[AppleMusicLyrics] No lyrics found across any provider for "${info.title}"`);
          showNoLyricsState();
        }
        ensureLyricsTabReady();
      }
    } catch (err) {
      console.error('[AppleMusicLyrics] Fetch error:', err);
      if (currentTrackKey === key) {
        showNoLyricsState();
      }
    }
  }

  // ─── 4. Default Tab Controller (Up Next / Lyrics / Related) ───

  function handleTabClick(clickedTab, targetIndex) {
    const parentTabs = clickedTab.closest('tp-yt-paper-tabs');
    if (parentTabs) {
      try { parentTabs.selected = targetIndex; } catch (_) {}
    }

    const ironPages = document.querySelector('ytmusic-player-page #tab-renderer') ||
                      document.querySelector('#tab-renderer');
    if (!ironPages) return;

    const renderers = Array.from(ironPages.children);

    if (targetIndex === 1) {
      // User clicked LYRICS tab
      renderers.forEach((r, idx) => {
        const isLyrics = r.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' ||
                         r.classList.contains('ytm-custom-lyrics-tab-renderer') ||
                         idx === 1;
        if (isLyrics) {
          r.removeAttribute('hidden');
          r.style.setProperty('display', 'flex', 'important');
        } else {
          r.setAttribute('hidden', '');
          r.style.setProperty('display', 'none', 'important');
        }
      });
      mountLyricsInTab();
    } else {
      // User clicked UP NEXT (0) or RELATED (2)
      renderers.forEach((r, idx) => {
        const isLyrics = r.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' ||
                         r.classList.contains('ytm-custom-lyrics-tab-renderer') ||
                         idx === 1;
        if (isLyrics) {
          r.setAttribute('hidden', '');
          r.style.setProperty('display', 'none', 'important');
        } else if (idx === targetIndex) {
          r.removeAttribute('hidden');
          r.style.removeProperty('display');
        } else {
          r.setAttribute('hidden', '');
          r.style.setProperty('display', 'none', 'important');
        }
      });
    }
  }

  function ensureLyricsTabReady() {
    const parentTabs = document.querySelector('ytmusic-player-page tp-yt-paper-tabs') ||
                       document.querySelector('tp-yt-paper-tabs#tabs') ||
                       document.querySelector('tp-yt-paper-tabs');

    if (parentTabs) {
      const tabs = Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));
      tabs.forEach((tab, index) => {
        const text = (tab.textContent || '').trim().toLowerCase();
        const isLyrics = text.includes('lyrics') || tab.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' || index === 1;

        if (isLyrics) {
          if (tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true') {
            tab.removeAttribute('disabled');
            tab.setAttribute('aria-disabled', 'false');
            tab.style.setProperty('pointer-events', 'auto', 'important');
            tab.style.setProperty('opacity', '1', 'important');
            tab.style.setProperty('cursor', 'pointer', 'important');
          }
        }

        if (!tab.dataset.ytmlBound) {
          tab.dataset.ytmlBound = 'true';
          tab.addEventListener('click', () => {
            handleTabClick(tab, index);
          }, true);
        }
      });
    }

    mountLyricsInTab();
  }

  // ─── 5. Player Bar Lyrics Toggle Button ───

  function injectToolbarLyricsButton() {
    if (document.getElementById('ytm-custom-lyrics-toggle-btn')) return;

    const rightControls = document.querySelector(SEL.rightControls);
    if (!rightControls) return;

    const btn = document.createElement('button');
    btn.id = 'ytm-custom-lyrics-toggle-btn';
    btn.className = 'ytm-custom-lyrics-btn';
    btn.title = 'Apple Music Lyrics (L)';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
      </svg>
    `;

    btn.addEventListener('click', () => {
      toggleFullLyricsPage();
      btn.classList.toggle('ytm-btn-active');
    });

    rightControls.insertBefore(btn, rightControls.firstChild);
  }

  // ─── 6. Keyboard Shortcut ('L') ───

  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      toggleFullLyricsPage();
      const btn = document.getElementById('ytm-custom-lyrics-toggle-btn');
      if (btn) btn.classList.toggle('ytm-btn-active');
    }
  });

  // ─── 7. Extension Popup Communication ───

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_TRACK_INFO') {
      sendResponse({
        title: currentTrackMeta.title,
        artist: currentTrackMeta.artist,
        lyricsActive: true
      });
    } else if (msg.type === 'TOGGLE_LYRICS') {
      toggleFullLyricsPage();
      sendResponse({ success: true });
    } else if (msg.type === 'SET_PAGE_OPEN') {
      if (msg.open) openFullLyricsPage();
      else closeFullLyricsPage();
      sendResponse({ success: true });
    }
    return true;
  });

  // ─── 8. Lifecycle & Video Observers ───

  function hookVideo() {
    const video = document.querySelector('video');
    if (video && !video.dataset.ytmlBound) {
      video.dataset.ytmlBound = 'true';
      const trigger = () => window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
      video.addEventListener('durationchange', trigger);
      video.addEventListener('play', trigger);
      video.addEventListener('playing', trigger);
    }
  }

  function setupObservers() {
    const playerBar = document.querySelector(SEL.playerBar);
    if (!playerBar) return;

    const barObs = new MutationObserver(() => {
      injectToolbarLyricsButton();
      window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
    });

    barObs.observe(playerBar, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const pageObs = new MutationObserver(() => {
      ensureLyricsTabReady();
      injectToolbarLyricsButton();
      hookVideo();
    });

    pageObs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['page-type', 'selected', 'hidden', 'aria-hidden']
    });

    hookVideo();
    injectToolbarLyricsButton();
    ensureLyricsTabReady();

    // Heartbeat every 1.5s
    setInterval(() => {
      window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
      ensureLyricsTabReady();
      injectToolbarLyricsButton();
      hookVideo();
    }, 1500);

    // Initial check
    window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');

    chrome.storage.local.get(['lyricsPageOpen'], res => {
      if (res.lyricsPageOpen) {
        openFullLyricsPage();
        const btn = document.getElementById('ytm-custom-lyrics-toggle-btn');
        if (btn) btn.classList.add('ytm-btn-active');
      }
    });
  }

  function waitForPlayerBar() {
    if (document.querySelector(SEL.playerBar)) {
      setupObservers();
      return;
    }

    const domObs = new MutationObserver((_, obs) => {
      if (document.querySelector(SEL.playerBar)) {
        obs.disconnect();
        setupObservers();
      }
    });
    domObs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForPlayerBar);
  } else {
    waitForPlayerBar();
  }
})();
