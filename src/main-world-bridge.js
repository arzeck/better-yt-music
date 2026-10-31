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
  }

  // Periodic heartbeat
  setInterval(() => broadcastTrack(false), 800);

  // Hook YouTube navigation events
  window.addEventListener('yt-navigate-finish', () => setTimeout(() => broadcastTrack(true), 300));
  window.addEventListener('yt-page-data-updated', () => setTimeout(() => broadcastTrack(true), 300));

  // Hook request from content script
  window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'ytml-isolated' && e.data.type === 'REQUEST_TRACK') {
      broadcastTrack(true);
    }
  });

  // Initial trigger
  broadcastTrack(true);
})();
