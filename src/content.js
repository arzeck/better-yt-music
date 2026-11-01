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
    setModalMode,
    updatePlayerState,
    updateQueue,
    mountLyricsInTab,
    updateTrackMeta,
    setLyricsData,
    showLoadingState,
    showNoLyricsState,
    setRefreshSpinning
  } = window.__YTMLLyricsPage;

  // ─── 1. Main World Bridge Listener ───

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytml-main') return;

    if (event.data.type === 'TRACK_CHANGE') {
      const meta = event.data.payload;
      if (meta && (meta.title || meta.videoId)) {
        handleIncomingTrackMeta(meta);
      }
    } else if (event.data.type === 'PLAYER_STATE') {
      window.__YTMLLyricsPage?.updatePlayerState(event.data.payload);
      window.__YTMLAppleUI?.updatePlayerState(event.data.payload);
    } else if (event.data.type === 'QUEUE_UPDATE') {
      window.__YTMLLyricsPage?.updateQueue(event.data.payload);
    }
  });

  // Request track info from bridge immediately
  window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');

  window.addEventListener('ytml:retry-search', () => {
    retryLyricsFetch();
  });

  async function retryLyricsFetch() {
    console.log('[AppleMusicLyrics] Retrying lyrics across all 13 providers...');
    if (setRefreshSpinning) setRefreshSpinning(true);
    showLoadingState();
    window.__YTMLLyricsRepo?.clearCache();
    currentTrackKey = '';

    if (currentTrackMeta && (currentTrackMeta.title || currentTrackMeta.videoId)) {
      await onSongChanged(currentTrackMeta, true);
    } else {
      window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
    }
  }

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

  async function onSongChanged(info, forceRefresh = false) {
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
    if (!forceRefresh && key === currentTrackKey) return;
    currentTrackKey = key;
    currentTrackMeta = info;

    console.log(`[AppleMusicLyrics] Track detected: "${info.title}" by "${info.artist || 'Unknown'}" (${Math.round(info.durationMs / 1000)}s)${forceRefresh ? ' [FORCE REFRESH]' : ''}`);

    // 1. Update UI metadata and canvas palette immediately
    updateTrackMeta(info);
    updateIslandMeta();
    window.__YTMLAppleUI?.updateNowPlaying(info);
    showLoadingState();
    if (setRefreshSpinning) setRefreshSpinning(true);
    ensureLyricsTabReady();

    // 2. Race across all 13 BitChord providers concurrently
    try {
      const outcome = await window.__YTMLLyricsRepo.fetchLyrics(info, (activeResult, allResults) => {
        if (currentTrackKey === key) {
          console.log(`[AppleMusicLyrics] Progressive hit from ${activeResult.source} (${activeResult.isWordSynced ? 'Word/Syllable Sync' : 'Line Sync'})`);
          setLyricsData(activeResult, allResults);
          ensureLyricsTabReady();
        }
      }, forceRefresh);

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
    } finally {
      if (setRefreshSpinning) setRefreshSpinning(false);
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

    try { ironPages.selected = targetIndex; } catch (_) {}

    const renderers = Array.from(ironPages.children);
    const lyricsContainer = document.querySelector('.ytm-custom-lyrics-tab-renderer') ||
                            document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');

    if (targetIndex === 1) {
      // User clicked LYRICS tab
      renderers.forEach((r, idx) => {
        const isLyrics = r === lyricsContainer ||
                         r.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' ||
                         r.classList.contains('ytm-custom-lyrics-tab-renderer') ||
                         idx === 1;
        if (isLyrics) {
          r.removeAttribute('hidden');
          r.style.setProperty('display', 'flex', 'important');
          r.style.setProperty('height', '100%', 'important');
          r.style.setProperty('visibility', 'visible', 'important');
        } else {
          r.setAttribute('hidden', '');
          r.style.setProperty('display', 'none', 'important');
        }
      });
      mountLyricsInTab();
    } else {
      // User clicked UP NEXT (0) or RELATED (2)
      renderers.forEach((r, idx) => {
        const isLyrics = r === lyricsContainer ||
                         r.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' ||
                         r.classList.contains('ytm-custom-lyrics-tab-renderer');
        if (isLyrics) {
          r.setAttribute('hidden', '');
          r.style.setProperty('display', 'none', 'important');
        } else {
          const isTarget = (targetIndex === 0 && (idx === 0 || r === renderers[0])) ||
                           (targetIndex === 2 && (idx === renderers.length - 1 || r === renderers[renderers.length - 1]));
          if (isTarget) {
            r.removeAttribute('hidden');
            r.style.removeProperty('display');
          } else {
            r.setAttribute('hidden', '');
            r.style.setProperty('display', 'none', 'important');
          }
        }
      });
    }
  }

  function ensureLyricsTabReady() {
    const parentTabs = document.querySelector('ytmusic-player-page tp-yt-paper-tabs') ||
                       document.querySelector('tp-yt-paper-tabs#tabs') ||
                       document.querySelector('tp-yt-paper-tabs');

    if (parentTabs) {
      let tabs = Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));

      // If YouTube Music only rendered 2 tabs (Up Next and Related), insert our Lyrics tab at index 1
      if (tabs.length === 2 && !parentTabs.querySelector('.ytm-lyrics-paper-tab')) {
        const lyricsTab = document.createElement('tp-yt-paper-tab');
        lyricsTab.className = 'style-scope ytmusic-player-page tab-header ytm-lyrics-paper-tab';
        lyricsTab.setAttribute('role', 'tab');
        lyricsTab.setAttribute('tabindex', '0');
        lyricsTab.setAttribute('aria-selected', 'false');
        lyricsTab.innerHTML = '<div class="tab-content style-scope tp-yt-paper-tab">Lyrics</div>';
        parentTabs.insertBefore(lyricsTab, tabs[1]);
        tabs = Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));
      }

      tabs.forEach((tab, index) => {
        const text = (tab.textContent || '').trim().toLowerCase();
        const isLyrics = text.includes('lyrics') || tab.getAttribute('page-type') === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' || index === 1;

        if (isLyrics) {
          tab.removeAttribute('disabled');
          tab.setAttribute('aria-disabled', 'false');
          tab.style.setProperty('pointer-events', 'auto', 'important');
          tab.style.setProperty('opacity', '1', 'important');
          tab.style.setProperty('cursor', 'pointer', 'important');
        }

        if (!tab.dataset.ytmlBound) {
          tab.dataset.ytmlBound = 'true';
          tab.addEventListener('click', () => {
            const currentTabs = Array.from(parentTabs.querySelectorAll('tp-yt-paper-tab'));
            const currentIndex = currentTabs.indexOf(tab);
            handleTabClick(tab, currentIndex >= 0 ? currentIndex : index);
          }, true);
        }
      });
    }

    mountLyricsInTab();
  }

  // ─── 5. Player Bar Lyrics & Controls Integration ───

  function injectTopBarCenterIsland() {
    let island = document.getElementById('ytm-topbar-island');
    if (island) {
      updateIslandMeta();
      return;
    }

    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return;

    const middleControls = playerBar.querySelector('.middle-controls') || playerBar.querySelector('#middle-controls') || playerBar;

    island = document.createElement('div');
    island.id = 'ytm-topbar-island';
    island.className = 'ytm-topbar-island';
    island.title = 'Open Fullscreen Player / Lyrics';
    island.innerHTML = `
      <img id="ytm-island-art" class="ytm-island-art" src="" alt="" />
      <div class="ytm-island-text">
        <div id="ytm-island-title" class="ytm-island-title">—</div>
        <div id="ytm-island-artist" class="ytm-island-artist">—</div>
      </div>
    `;

    island.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullLyricsPage('player');
    });

    middleControls.appendChild(island);
    updateIslandMeta();
  }

  function updateIslandMeta() {
    const islandArt = document.getElementById('ytm-island-art');
    const islandTitle = document.getElementById('ytm-island-title');
    const islandArtist = document.getElementById('ytm-island-artist');

    if (islandArt && currentTrackMeta.artwork) {
      islandArt.src = currentTrackMeta.artwork;
    }
    if (islandTitle) {
      islandTitle.textContent = currentTrackMeta.title || '—';
    }
    if (islandArtist) {
      islandArtist.textContent = currentTrackMeta.artist || '—';
    }
  }

  function injectToolbarLyricsButton() {
    injectTopBarCenterIsland();

    const rightControls = document.querySelector('ytmusic-player-bar .right-controls-buttons') ||
                          document.querySelector('#right-controls-buttons') ||
                          document.querySelector('ytmusic-player-bar [slot="right-controls"]');
    if (!rightControls) return;

    let lyricsBtn = document.getElementById('ytm-custom-lyrics-toggle-btn');
    if (!lyricsBtn) {
      lyricsBtn = document.createElement('button');
      lyricsBtn.id = 'ytm-custom-lyrics-toggle-btn';
      lyricsBtn.className = 'ytm-custom-lyrics-btn';
      lyricsBtn.title = 'Lyrics View (L)';
      lyricsBtn.setAttribute('aria-label', 'Lyrics');
      lyricsBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 11.5c0 .83-.67 1.5-1.5 1.5S7 14.33 7 13.5s.67-1.5 1.5-1.5c.14 0 .27.02.4.06-.05-.88-.5-1.63-1.17-2.11l.88-1.22c1.07.77 1.79 1.98 1.88 3.37.01.13.01.27.01.4zm6 0c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5c.14 0 .27.02.4.06-.05-.88-.5-1.63-1.17-2.11l.88-1.22c1.07.77 1.79 1.98 1.88 3.37.01.13.01.27.01.4z"/>
        </svg>
      `;

      lyricsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullLyricsPage('lyrics');
      });

      const togglePageBtn = rightControls.querySelector('.toggle-player-page-button') ||
                            rightControls.querySelector('#toggle-player-page-button') ||
                            rightControls.querySelector('[aria-label*="queue"]') ||
                            rightControls.querySelector('[aria-label*="Queue"]');
      if (togglePageBtn) {
        rightControls.insertBefore(lyricsBtn, togglePageBtn);
      } else {
        rightControls.insertBefore(lyricsBtn, rightControls.firstChild);
      }
    }

    let queueBtn = document.getElementById('ytm-custom-queue-toggle-btn');
    if (!queueBtn) {
      queueBtn = document.createElement('button');
      queueBtn.id = 'ytm-custom-queue-toggle-btn';
      queueBtn.className = 'ytm-custom-lyrics-btn ytm-custom-queue-btn';
      queueBtn.title = 'Queue View';
      queueBtn.setAttribute('aria-label', 'Queue');
      queueBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
        </svg>
      `;
      queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullLyricsPage('queue');
      });
      if (lyricsBtn && lyricsBtn.nextSibling) {
        rightControls.insertBefore(queueBtn, lyricsBtn.nextSibling);
      } else {
        rightControls.appendChild(queueBtn);
      }
    }

    const isPageOpen = document.getElementById('ytm-better-lyrics-page')?.classList.contains('ytm-page-open');
    if (lyricsBtn) lyricsBtn.classList.toggle('ytm-btn-active', isPageOpen);
  }

  // ─── 6. Keyboard Shortcut ('L') ───

  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      toggleLyricsPage();
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

  let observerDebounceTimer = null;
  function scheduleContentUpdate() {
    if (observerDebounceTimer) clearTimeout(observerDebounceTimer);
    observerDebounceTimer = setTimeout(() => {
      observerDebounceTimer = null;
      hookVideo();
      ensureLyricsTabReady();
      injectToolbarLyricsButton();
      window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
    }, 200);
  }

  function setupObservers() {
    hookVideo();
    injectToolbarLyricsButton();
    ensureLyricsTabReady();

    // Hook YouTube SPA navigation events instead of recursively observing document.body
    window.addEventListener('yt-navigate-finish', scheduleContentUpdate);
    window.addEventListener('yt-page-data-updated', scheduleContentUpdate);
    window.addEventListener('popstate', scheduleContentUpdate);

    const playerBar = document.querySelector(SEL.playerBar);
    if (playerBar) {
      const barObs = new MutationObserver(() => {
        injectToolbarLyricsButton();
        window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
      });

      barObs.observe(playerBar, {
        childList: true,
        subtree: true
      });
    }

    // Periodic gentle heartbeat
    setInterval(() => {
      window.postMessage({ source: 'ytml-isolated', type: 'REQUEST_TRACK' }, '*');
      hookVideo();
    }, 2000);

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

    // Check periodically until playerBar or app layout is ready (at most 10s)
    let retries = 0;
    const interval = setInterval(() => {
      retries++;
      if (document.querySelector(SEL.playerBar) || retries > 20) {
        clearInterval(interval);
        setupObservers();
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForPlayerBar);
  } else {
    waitForPlayerBar();
  }
})();
