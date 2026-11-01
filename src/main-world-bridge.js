/**
 * Main-world bridge script for YouTube Music.
 *
 * Runs in the page's MAIN execution world (world: "MAIN") to directly access
 * YouTube Music's player engine (#movie_player, navigator.mediaSession.metadata)
 * and broadcasts updates across execution worlds via window.postMessage.
 */

(() => {
  'use strict';

  let lastKey = '';

  function getMediaInfo() {
    let title = '';
    let artist = '';
    let album = '';
    let artwork = '';
    let videoId = '';
    let durationMs = 0;

    // 1. YouTube Player API (#movie_player)
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player && typeof player.getVideoData === 'function') {
        const data = player.getVideoData();
        if (data) {
          videoId = data.video_id || '';
          if (data.title) title = data.title;
          if (data.author) artist = data.author;
        }
      }
      if (player && typeof player.getDuration === 'function') {
        const d = player.getDuration();
        if (d > 0) durationMs = Math.round(d * 1000);
      }
    } catch (_) {}

    // 2. MediaSession API (high fidelity, set by YouTube Music)
    try {
      if (navigator.mediaSession && navigator.mediaSession.metadata) {
        const m = navigator.mediaSession.metadata;
        if (m.title) title = m.title;
        if (m.artist) artist = m.artist;
        if (m.album) album = m.album;
        if (m.artwork && m.artwork.length > 0) {
          artwork = m.artwork[m.artwork.length - 1].src || '';
        }
      }
    } catch (_) {}

    // 3. Fallback to DOM elements
    if (!title) {
      const tEl = document.querySelector('ytmusic-player-bar .title') ||
                  document.querySelector('.content-info-wrapper .title');
      if (tEl) title = tEl.getAttribute('title') || tEl.textContent || '';
    }

    if (!artist) {
      const bEl = document.querySelector('ytmusic-player-bar .byline') ||
                  document.querySelector('.content-info-wrapper .byline');
      if (bEl) {
        const raw = bEl.getAttribute('title') || bEl.textContent || '';
        const parts = raw.split(/[•·]/).map(p => p.trim());
        artist = parts[0] || '';
        if (!album && parts[1]) album = parts[1];
      }
    }

    if (!artwork) {
      const img = document.querySelector('ytmusic-player-bar img#img') ||
                  document.querySelector('ytmusic-player-bar img');
      if (img && img.src) artwork = img.src;
    }

    if (!videoId) {
      const params = new URLSearchParams(window.location.search);
      videoId = params.get('v') || '';
    }

    if (!durationMs) {
      const video = document.querySelector('video');
      if (video && video.duration) {
        durationMs = Math.round(video.duration * 1000);
      }
    }

    // Clean " - Topic" from YouTube artist channels
    if (artist) {
      artist = artist.replace(/\s*-\s*Topic\s*$/i, '').trim();
    }

    return {
      title: (title || '').trim(),
      artist: (artist || '').trim(),
      album: (album || '').trim(),
      artwork: (artwork || '').trim(),
      videoId: (videoId || '').trim(),
      durationMs: durationMs || 0
    };
  }

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function getVideo() {
    return document.querySelector('video');
  }

  function extractQueueItems() {
    const queueItems = [];
    const elements = document.querySelectorAll('ytmusic-player-queue-item');
    elements.forEach((el, index) => {
      const titleEl = el.querySelector('.song-title') || el.querySelector('.title');
      const bylineEl = el.querySelector('.byline');
      const imgEl = el.querySelector('img#img') || el.querySelector('img');
      const isSelected = el.hasAttribute('selected') || el.classList.contains('selected');

      const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
      const byline = bylineEl ? (bylineEl.getAttribute('title') || bylineEl.textContent || '').trim() : '';
      const artwork = imgEl ? (imgEl.src || '') : '';

      if (title) {
        queueItems.push({
          index,
          title,
          artist: byline.split(/[•·]/)[0]?.trim() || byline,
          artwork,
          isSelected
        });
      }
    });
    return queueItems;
  }

  function broadcastPlayerState() {
    const video = getVideo();
    const isPaused = video ? video.paused : true;
    const currentTime = video ? video.currentTime : 0;
    const duration = video && video.duration ? video.duration : 0;
    const volume = video ? video.volume : 1;
    const muted = video ? video.muted : false;

    window.postMessage({
      source: 'ytml-main',
      type: 'PLAYER_STATE',
      payload: {
        isPaused,
        currentTime,
        duration,
        volume: muted ? 0 : volume,
        muted
      }
    }, '*');
  }

  function broadcastQueue() {
    const queue = extractQueueItems();
    window.postMessage({
      source: 'ytml-main',
      type: 'QUEUE_UPDATE',
      payload: queue
    }, '*');
  }

  function broadcastTrack(force = false) {
    const meta = getMediaInfo();
    const key = `${meta.title}|${meta.artist}|${meta.videoId}|${Math.round(meta.durationMs / 1000)}`;

    if (!force && key === lastKey) return;
    lastKey = key;

    window.postMessage({
      source: 'ytml-main',
      type: 'TRACK_CHANGE',
      payload: meta
    }, '*');

    broadcastQueue();
    broadcastPlayerState();
  }

  // Periodic heartbeat
  setInterval(() => {
    broadcastTrack(false);
    broadcastPlayerState();
  }, 500);

  // Hook YouTube navigation events
  window.addEventListener('yt-navigate-finish', () => setTimeout(() => broadcastTrack(true), 300));
  window.addEventListener('yt-page-data-updated', () => setTimeout(() => broadcastTrack(true), 300));

  // Handle incoming commands from content script
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== 'ytml-isolated') return;

    if (e.data.type === 'REQUEST_TRACK') {
      broadcastTrack(true);
    } else if (e.data.type === 'REQUEST_QUEUE') {
      broadcastQueue();
    } else if (e.data.type === 'PLAYER_COMMAND') {
      const { command, value } = e.data.payload || {};
      const player = getPlayer();
      const video = getVideo();

      if (command === 'TOGGLE_PLAY') {
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
      } else if (command === 'NEXT') {
        const nextBtn = document.querySelector('ytmusic-player-bar .next-button') ||
                        document.querySelector('.next-button');
        if (nextBtn) nextBtn.click();
        else if (player && typeof player.nextVideo === 'function') player.nextVideo();
      } else if (command === 'PREV') {
        const prevBtn = document.querySelector('ytmusic-player-bar .previous-button') ||
                        document.querySelector('.previous-button');
        if (prevBtn) prevBtn.click();
        else if (player && typeof player.previousVideo === 'function') player.previousVideo();
      } else if (command === 'SEEK') {
        if (typeof value === 'number') {
          if (player && typeof player.seekTo === 'function') player.seekTo(value);
          else if (video) video.currentTime = value;
        }
      } else if (command === 'SET_VOLUME') {
        if (typeof value === 'number' && video) {
          video.volume = Math.max(0, Math.min(1, value));
          if (video.volume > 0 && video.muted) video.muted = false;
        }
      } else if (command === 'TOGGLE_LIKE') {
        const likeBtn = document.querySelector('ytmusic-player-bar .like-button-renderer yt-button-shape button') ||
                        document.querySelector('ytmusic-player-bar #like-button-renderer button') ||
                        document.querySelector('ytmusic-player-bar .like-button-renderer paper-icon-button');
        if (likeBtn) likeBtn.click();
      } else if (command === 'PLAY_QUEUE_INDEX') {
        const queueElements = document.querySelectorAll('ytmusic-player-queue-item');
        if (typeof value === 'number' && queueElements[value]) {
          queueElements[value].click();
        }
      }
      setTimeout(broadcastPlayerState, 50);
    }
  });

  // Initial trigger
  broadcastTrack(true);
})();
