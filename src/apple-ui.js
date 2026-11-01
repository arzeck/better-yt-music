/**
 * Apple Music Complete UI & UX Redesign for YouTube Music.
 *
 * Implements:
 *   1. Dedicated Apple Music Top Player Bar (Navigation, Playback Controls,
 *      Center Now Playing Capsule with Integrated Progress Bar, Volume, Lyrics, Queue, Avatar)
 *   2. Dedicated Apple Music Left Sidebar (Search Capsule, Home, Explore, Library,
 *      History, Downloads, Local Music, Dynamic User Playlists, Settings)
 *   3. Redesigned Homepage Canvas (Apple SF Pro typography, "Recents" 3-column grid,
 *      "Albums & singles" square card carousels, "Quick picks", and clean dark aesthetic)
 */

(() => {
  'use strict';

  console.log('[AppleUI] Initializing Apple Music UI & UX redesign...');

  let topbarEl = null;
  let sidebarEl = null;
  let currentTrack = { title: '', artist: '', artwork: '', videoId: '', durationMs: 0 };
  let currentState = { isPaused: true, currentTime: 0, duration: 0, volume: 1, muted: false };

  function sendPlayerCommand(command, value) {
    window.postMessage({
      source: 'ytml-isolated',
      type: 'PLAYER_COMMAND',
      payload: { command, value }
    }, '*');
  }

  // ─── 1. Build & Inject Top Bar ───────────────────────────────────────────────

  function createTopBar() {
    if (document.getElementById('ytm-apple-topbar')) return;

    const header = document.createElement('header');
    header.id = 'ytm-apple-topbar';
    header.className = 'ytm-apple-topbar';

    header.innerHTML = `
      <!-- Left: Brand Logo, Nav Arrows & Playback Transport -->
      <div class="ytm-topbar-left">
        <div class="ytm-topbar-logo" title="YouTube Music (Apple Music Redesign)">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
        </div>

        <button id="ytm-topbar-btn-back" class="ytm-topbar-icon-btn" title="Back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <button id="ytm-topbar-btn-forward" class="ytm-topbar-icon-btn" title="Forward">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>

        <button id="ytm-topbar-btn-shuffle" class="ytm-topbar-icon-btn" title="Shuffle">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button id="ytm-topbar-btn-prev" class="ytm-topbar-icon-btn" title="Previous Track">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button id="ytm-topbar-btn-play" class="ytm-topbar-icon-btn ytm-btn-play-round" title="Play / Pause">
          <svg id="ytm-topbar-play-icon" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </button>
        <button id="ytm-topbar-btn-next" class="ytm-topbar-icon-btn" title="Next Track">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
        <button id="ytm-topbar-btn-repeat" class="ytm-topbar-icon-btn" title="Repeat">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
        </button>
      </div>

      <!-- Center: Now Playing Capsule with Integrated Progress Bar -->
      <div class="ytm-topbar-center">
        <div id="ytm-topbar-capsule" class="ytm-topbar-capsule" title="Click to view full player & lyrics">
          <div class="ytm-capsule-content">
            <img id="ytm-capsule-thumb" class="ytm-capsule-thumb" src="" alt="" />
            <div class="ytm-capsule-info">
              <div id="ytm-capsule-title" class="ytm-capsule-title">—</div>
              <div id="ytm-capsule-artist" class="ytm-capsule-artist">—</div>
            </div>
          </div>
          <div class="ytm-capsule-progress-track" id="ytm-capsule-progress-track" title="Click to seek">
            <div class="ytm-capsule-progress-fill" id="ytm-capsule-progress-fill" style="width: 0%;"></div>
          </div>
        </div>
      </div>

      <!-- Right: Volume, Headphone, Lyrics, Queue, Avatar -->
      <div class="ytm-topbar-right">
        <div class="ytm-volume-block">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" class="ytm-vol-icon"><path d="M7 9v6h4l5 5V4L11 9H7z"/></svg>
          <div class="ytm-topbar-slider-wrapper">
            <input type="range" id="ytm-topbar-vol" min="0" max="1" step="0.01" value="1" class="ytm-apple-topbar-slider" />
          </div>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="ytm-vol-icon"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
        </div>

        <button id="ytm-topbar-btn-output" class="ytm-topbar-icon-btn" title="Audio Output: System default">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>
        </button>

        <button id="ytm-topbar-btn-lyrics" class="ytm-topbar-icon-btn" title="Full Screen Lyrics (L)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h4l3 3 3-3h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 11.5c0 .83-.67 1.5-1.5 1.5S7 14.33 7 13.5s.67-1.5 1.5-1.5c.14 0 .27.02.4.06-.05-.88-.5-1.63-1.17-2.11l.88-1.22c1.07.77 1.79 1.98 1.88 3.37.01.13.01.27.01.4zm6 0c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5c.14 0 .27.02.4.06-.05-.88-.5-1.63-1.17-2.11l.88-1.22c1.07.77 1.79 1.98 1.88 3.37.01.13.01.27.01.4z"/>
          </svg>
        </button>

        <button id="ytm-topbar-btn-queue" class="ytm-topbar-icon-btn" title="Queue View">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
          </svg>
        </button>

        <div id="ytm-topbar-avatar" class="ytm-topbar-avatar" title="Account">
          <img id="ytm-topbar-avatar-img" class="ytm-avatar-img" src="" alt="" />
        </div>
      </div>
    `;

    document.body.prepend(header);
    topbarEl = header;
    bindTopBarEvents();
  }

  function bindTopBarEvents() {
    // Nav back & forward
    document.getElementById('ytm-topbar-btn-back')?.addEventListener('click', () => window.history.back());
    document.getElementById('ytm-topbar-btn-forward')?.addEventListener('click', () => window.history.forward());

    // Playback transport
    document.getElementById('ytm-topbar-btn-play')?.addEventListener('click', () => sendPlayerCommand('TOGGLE_PLAY'));
    document.getElementById('ytm-topbar-btn-prev')?.addEventListener('click', () => sendPlayerCommand('PREV'));
    document.getElementById('ytm-topbar-btn-next')?.addEventListener('click', () => sendPlayerCommand('NEXT'));

    document.getElementById('ytm-topbar-btn-shuffle')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.classList.toggle('ytm-active');
      const nativeShuffle = document.querySelector('ytmusic-player-bar .shuffle') ||
                            document.querySelector('ytmusic-player-bar [aria-label*="Shuffle"]') ||
                            document.querySelector('ytmusic-player-bar [aria-label*="shuffle"]');
      if (nativeShuffle) nativeShuffle.click();
    });

    document.getElementById('ytm-topbar-btn-repeat')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.classList.toggle('ytm-active');
      const nativeRepeat = document.querySelector('ytmusic-player-bar .repeat') ||
                           document.querySelector('ytmusic-player-bar [aria-label*="Repeat"]') ||
                           document.querySelector('ytmusic-player-bar [aria-label*="repeat"]');
      if (nativeRepeat) nativeRepeat.click();
    });

    // Center capsule opens full modal
    document.getElementById('ytm-topbar-capsule')?.addEventListener('click', (e) => {
      // Don't open if clicked directly on progress track
      if (e.target.closest('#ytm-capsule-progress-track')) return;
      window.__YTMLLyricsPage?.openFullLyricsPage('player');
    });

    // Integrated progress bar seek
    const progressTrack = document.getElementById('ytm-capsule-progress-track');
    if (progressTrack) {
      progressTrack.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = progressTrack.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        const duration = currentState.duration || 0;
        if (duration > 0) {
          sendPlayerCommand('SEEK', pct * duration);
        }
      });
    }

    // Volume slider
    const volSlider = document.getElementById('ytm-topbar-vol');
    if (volSlider) {
      volSlider.addEventListener('input', () => {
        const val = Number(volSlider.value);
        sendPlayerCommand('SET_VOLUME', val);
        volSlider.style.setProperty('--ytm-slider-fill', `${(val * 100).toFixed(1)}%`);
      });
    }

    // Full modal buttons
    document.getElementById('ytm-topbar-btn-lyrics')?.addEventListener('click', () => {
      window.__YTMLLyricsPage?.toggleFullLyricsPage('lyrics');
    });

    document.getElementById('ytm-topbar-btn-queue')?.addEventListener('click', () => {
      window.__YTMLLyricsPage?.toggleFullLyricsPage('queue');
    });

    // Avatar clicks YouTube native account menu
    document.getElementById('ytm-topbar-avatar')?.addEventListener('click', () => {
      const nativeAvatarBtn = document.querySelector('ytmusic-nav-bar #avatar-btn') ||
                              document.querySelector('ytmusic-nav-bar .avatar-button') ||
                              document.querySelector('#avatar-btn');
      if (nativeAvatarBtn) nativeAvatarBtn.click();
    });
  }

  // ─── 2. Build & Inject Sidebar ──────────────────────────────────────────────

  function createSidebar() {
    if (document.getElementById('ytm-apple-sidebar')) return;

    const aside = document.createElement('aside');
    aside.id = 'ytm-apple-sidebar';
    aside.className = 'ytm-apple-sidebar';

    aside.innerHTML = `
      <!-- Top Search Box Capsule -->
      <div class="ytm-sidebar-search-box">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" id="ytm-apple-search-input" placeholder="Search" />
      </div>

      <div class="ytm-sidebar-scroll">
        <!-- Primary Navigation -->
        <nav class="ytm-sidebar-nav">
          <a href="/" class="ytm-sidebar-item ytm-active" id="ytm-sidebar-home" data-route="/">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
            <span>Home</span>
          </a>
          <a href="/explore" class="ytm-sidebar-item" id="ytm-sidebar-explore" data-route="/explore">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z"/></svg>
            <span>Explore</span>
          </a>
          <a href="/library" class="ytm-sidebar-item" id="ytm-sidebar-library" data-route="/library">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
            <span>Library</span>
          </a>
          <a href="/search" class="ytm-sidebar-item" id="ytm-sidebar-search" data-route="/search">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <span>Search</span>
          </a>
        </nav>

        <div class="ytm-sidebar-divider"></div>

        <!-- Secondary Navigation -->
        <nav class="ytm-sidebar-nav">
          <a href="/history" class="ytm-sidebar-item" id="ytm-sidebar-history" data-route="/history">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
            <span>History</span>
          </a>
          <a href="/library/downloads" class="ytm-sidebar-item" id="ytm-sidebar-downloads" data-route="/library/downloads">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Downloads</span>
          </a>
          <a href="/library/local" class="ytm-sidebar-item" id="ytm-sidebar-local" data-route="/library/local">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            <span>Local Music</span>
          </a>
        </nav>

        <div class="ytm-sidebar-divider"></div>

        <!-- Playlists List -->
        <div class="ytm-sidebar-playlists" id="ytm-sidebar-playlists">
          <!-- Dynamically populated from user's playlists -->
        </div>
      </div>

      <!-- Settings at bottom -->
      <div class="ytm-sidebar-footer">
        <a href="/settings" class="ytm-sidebar-item" id="ytm-sidebar-settings" data-route="/settings">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          <span>Settings</span>
        </a>
      </div>
    `;

    document.body.prepend(aside);
    sidebarEl = aside;
    bindSidebarEvents();
    syncUserPlaylists();
  }

  function bindSidebarEvents() {
    // Search input
    const searchInput = document.getElementById('ytm-apple-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query) {
            window.location.href = `/search?q=${encodeURIComponent(query)}`;
          }
        }
      });
    }

    // Navigation item click handling (native YouTube SPA navigation)
    document.querySelectorAll('.ytm-sidebar-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const route = item.getAttribute('data-route');
        if (!route) return;

        e.preventDefault();
        updateActiveSidebarRoute(route);

        if (route === '/search') {
          searchInput?.focus();
          return;
        }

        // Try triggering native YouTube link if available
        const nativeLink = document.querySelector(`ytmusic-guide-entry-renderer a[href*="${route}"]`) ||
                           document.querySelector(`ytmusic-nav-bar a[href*="${route}"]`);
        if (nativeLink) {
          nativeLink.click();
        } else {
          window.location.href = route;
        }
      });
    });
  }

  function updateActiveSidebarRoute(currentPath) {
    document.querySelectorAll('.ytm-sidebar-item').forEach(item => {
      const route = item.getAttribute('data-route');
      const isActive = route === '/'
        ? (currentPath === '/' || currentPath === '')
        : (currentPath && currentPath.startsWith(route));
      item.classList.toggle('ytm-active', Boolean(isActive));
    });
  }

  function syncUserPlaylists() {
    const container = document.getElementById('ytm-sidebar-playlists');
    if (!container) return;

    // Read user's playlists from native guide
    const nativeEntries = document.querySelectorAll('ytmusic-guide-section-renderer ytmusic-guide-entry-renderer, #sections ytmusic-guide-entry-renderer');
    const playlists = [];

    nativeEntries.forEach(entry => {
      const titleEl = entry.querySelector('.title') || entry.querySelector('formatted-string');
      const linkEl = entry.querySelector('a');
      const title = titleEl ? titleEl.textContent.trim() : '';
      const href = linkEl ? linkEl.getAttribute('href') : '';

      // Filter out standard nav items
      const lower = title.toLowerCase();
      if (!title || lower === 'home' || lower === 'explore' || lower === 'library' || lower === 'upgrade') return;

      playlists.push({ title, href });
    });

    if (playlists.length === 0) {
      // If we already have rendered playlists or defaults, never re-render
      if (container.children.length > 0) return;

      // Fallback defaults if guide hasn't rendered yet
      const defaults = [
        'Liked Music', 'New Episodes', 'Drive', 'Late Night',
        'chatpate gaane', 'Blend', 'sleeping song', 'Chill Playlist',
        'Anime Opening', 'Funk', 'edits', 'Couch', 'Random songs'
      ];
      container.innerHTML = defaults.map(p => `
        <div class="ytm-playlist-item" title="${p}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
          <span class="ytm-playlist-title">${p}</span>
        </div>
      `).join('');
      return;
    }

    // Only update container DOM if the playlist list has actually changed
    const cacheKey = playlists.map(p => `${p.title}:${p.href}`).join('|');
    if (container.dataset.lastPlaylistsKey === cacheKey) return;
    container.dataset.lastPlaylistsKey = cacheKey;

    container.innerHTML = playlists.map(p => `
      <a href="${p.href || '#'}" class="ytm-playlist-item" title="${p.title}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
        <span class="ytm-playlist-title">${p.title}</span>
      </a>
    `).join('');
  }

  // ─── 3. State & Track Updates ───────────────────────────────────────────────

  function updateNowPlaying(meta) {
    currentTrack = { ...currentTrack, ...meta };

    const thumbEl = document.getElementById('ytm-capsule-thumb');
    const titleEl = document.getElementById('ytm-capsule-title');
    const artistEl = document.getElementById('ytm-capsule-artist');

    if (thumbEl && meta.artwork) thumbEl.src = meta.artwork;
    if (titleEl) titleEl.textContent = meta.title || '—';
    if (artistEl) artistEl.textContent = meta.artist || '—';

    // Also update native user avatar in topbar if available
    const nativeAvatar = document.querySelector('ytmusic-nav-bar img#img') ||
                         document.querySelector('#avatar-btn img');
    const topAvatar = document.getElementById('ytm-topbar-avatar-img');
    if (nativeAvatar && topAvatar && nativeAvatar.src) {
      topAvatar.src = nativeAvatar.src;
    }
  }

  function updatePlayerState(state) {
    currentState = { ...currentState, ...state };

    // Play / Pause Icon
    const playSvg = document.getElementById('ytm-topbar-play-icon');
    if (playSvg) {
      if (currentState.isPaused) {
        playSvg.innerHTML = '<path d="M8 5v14l11-7z"/>';
      } else {
        playSvg.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      }
    }

    // Integrated Capsule Progress Bar
    const progressFill = document.getElementById('ytm-capsule-progress-fill');
    if (progressFill) {
      const cur = currentState.currentTime || 0;
      const dur = currentState.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      progressFill.style.width = `${pct.toFixed(2)}%`;
    }

    // Volume Slider
    const volSlider = document.getElementById('ytm-topbar-vol');
    if (volSlider && !volSlider.matches(':active')) {
      volSlider.value = String(currentState.volume ?? 1);
      volSlider.style.setProperty('--ytm-slider-fill', `${(Number(volSlider.value) * 100).toFixed(1)}%`);
    }
  }

  // ─── 4. Transform Homepage Browse Shelves ────────────────────────────────────

  function enhanceHomepage() {
    // Only on browse / home page
    const browsePage = document.querySelector('ytmusic-browse-response');
    if (!browsePage) return;

    // Check all shelves
    const shelves = browsePage.querySelectorAll('ytmusic-carousel-shelf-renderer, ytmusic-shelf-renderer');
    if (shelves.length === 0) return;

    let foundFirstSongShelf = false;

    shelves.forEach((shelf) => {
      const titleEl = shelf.querySelector('.title.ytmusic-carousel-shelf-basic-header-renderer') ||
                      shelf.querySelector('.title') ||
                      shelf.querySelector('h2');
      const titleText = (titleEl?.textContent || '').trim().toLowerCase();

      const hasSongRows = Boolean(shelf.querySelector('ytmusic-responsive-list-item-renderer'));
      const hasCards = Boolean(shelf.querySelector('ytmusic-two-row-item-renderer'));

      // If this shelf contains songs, style as the 4-row Recents grid!
      if (hasSongRows && (!foundFirstSongShelf || titleText.includes('listen again') || titleText.includes('recents'))) {
        foundFirstSongShelf = true;
        shelf.classList.add('ytm-recents-shelf');
        shelf.classList.add('ytm-song-shelf');
        shelf.dataset.ytmlEnhanced = 'true';

        if (titleEl && !titleEl.dataset.ytmlRenamed) {
          titleEl.textContent = 'Recents';
          titleEl.dataset.ytmlRenamed = 'true';
        }

        // Inject 4-square grid button in header if not already present
        const header = shelf.querySelector('ytmusic-carousel-shelf-basic-header-renderer') || titleEl?.parentElement;
        if (header && !header.querySelector('.ytm-recents-grid-icon')) {
          const gridIcon = document.createElement('div');
          gridIcon.className = 'ytm-recents-grid-icon';
          gridIcon.title = 'Grid View';
          gridIcon.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z"/>
            </svg>
          `;
          header.appendChild(gridIcon);
        }

        const itemsContainer = shelf.querySelector('#items') || shelf.querySelector('.carousel-items');
        if (itemsContainer) {
          itemsContainer.classList.add('ytm-recents-grid');
          itemsContainer.classList.remove('ytm-card-carousel');
        }
      } else if (hasCards || titleText.includes('album') || titleText.includes('single') || titleText.includes('quick pick')) {
        // Shelf contains square cards -> ALWAYS a single clean horizontal carousel
        shelf.classList.add('ytm-card-shelf');
        shelf.dataset.ytmlEnhanced = 'true';

        if (titleText.includes('album') || titleText.includes('single') || titleText.includes('recommended albums')) {
          shelf.classList.add('ytm-albums-shelf');
          if (titleEl && !titleEl.dataset.ytmlRenamed) {
            titleEl.textContent = 'Albums & singles';
            titleEl.dataset.ytmlRenamed = 'true';
          }
        } else if (titleText.includes('quick pick') || titleText.includes('picks')) {
          shelf.classList.add('ytm-quick-picks-shelf');
          if (titleEl && !titleEl.dataset.ytmlRenamed) {
            titleEl.textContent = 'Quick picks';
            titleEl.dataset.ytmlRenamed = 'true';
          }
        } else if (!foundFirstSongShelf && !titleEl?.dataset.ytmlRenamed) {
          shelf.classList.add('ytm-albums-shelf');
        }

        const itemsContainer = shelf.querySelector('#items') || shelf.querySelector('.carousel-items');
        if (itemsContainer) {
          itemsContainer.classList.add('ytm-card-carousel');
          itemsContainer.classList.remove('ytm-recents-grid');
        }
      }
    });
  }

  // ─── 5. Shell Lifecycle Initialization ──────────────────────────────────────

  function suppressDefaultYTPlayerPage() {
    const app = document.querySelector('ytmusic-app');
    if (app && app.getAttribute('player-ui-state') === 'FULLSCREEN') {
      const closeBtn = document.querySelector('ytmusic-player-page #close-button') ||
                       document.querySelector('ytmusic-player-page [aria-label*="Close"]') ||
                       document.querySelector('.toggle-player-page-button');
      if (closeBtn) {
        closeBtn.click();
      } else {
        try {
          app.setAttribute('player-ui-state', 'PLAYER_BAR_ONLY');
          const playerPage = document.querySelector('ytmusic-player-page');
          if (playerPage) {
            playerPage.removeAttribute('player-page-open');
            playerPage.removeAttribute('is-open');
          }
        } catch (_) {}
      }
    }
  }

  function initAppleShell() {
    createTopBar();
    createSidebar();
    updateActiveSidebarRoute(window.location.pathname);
    enhanceHomepage();
    suppressDefaultYTPlayerPage();
  }

  // Efficient, non-blocking lifecycle listeners
  let updateDebounceTimer = null;
  function scheduleShellUpdate(delay = 200) {
    if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
    updateDebounceTimer = setTimeout(() => {
      updateDebounceTimer = null;
      initAppleShell();
      syncUserPlaylists();
      enhanceHomepage();
      suppressDefaultYTPlayerPage();
    }, delay);
  }

  function setupShellObservers() {
    initAppleShell();
    syncUserPlaylists();
    suppressDefaultYTPlayerPage();

    // Hook YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', () => scheduleShellUpdate(150));
    window.addEventListener('yt-page-data-updated', () => scheduleShellUpdate(200));
    window.addEventListener('popstate', () => scheduleShellUpdate(100));

    // Observe immediate changes to ytmusic-app (route changes, player-ui-state changes)
    const app = document.querySelector('ytmusic-app');
    if (app) {
      const appObs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'player-ui-state') {
            suppressDefaultYTPlayerPage();
          } else if (m.type === 'childList') {
            scheduleShellUpdate(300);
          }
        }
      });
      appObs.observe(app, { childList: true, attributes: true, attributeFilter: ['player-ui-state'] });
    }

    // Periodic gentle refresh for newly loaded browse shelves or guide playlists
    setInterval(() => {
      syncUserPlaylists();
      enhanceHomepage();
      suppressDefaultYTPlayerPage();
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupShellObservers);
  } else {
    setupShellObservers();
  }

  window.__YTMLAppleUI = {
    initAppleShell,
    updateNowPlaying,
    updatePlayerState,
    enhanceHomepage
  };
})();

