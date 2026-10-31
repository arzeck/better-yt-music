/**
 * Extension popup script.
 * Toggles the Apple Music lyrics page on YouTube Music and displays active track info.
 */

'use strict';

const lyricsToggle = document.getElementById('lyricsToggle');
const trackName = document.getElementById('trackName');
const trackArtist = document.getElementById('trackArtist');

// Restore saved state
chrome.storage.local.get(['lyricsPageOpen'], res => {
  lyricsToggle.checked = !!res.lyricsPageOpen;
});

lyricsToggle.addEventListener('change', () => {
  const isOpen = lyricsToggle.checked;
  chrome.storage.local.set({ lyricsPageOpen: isOpen });

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (tab?.url?.includes('music.youtube.com')) {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_PAGE_OPEN', open: isOpen }).catch(() => {});
    }
  });
});

// Query active YouTube Music tab for track metadata
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs[0];
  if (!tab?.url?.includes('music.youtube.com')) {
    trackArtist.textContent = 'Open YouTube Music to use';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'GET_TRACK_INFO' }, response => {
    if (chrome.runtime.lastError || !response) return;

    if (response.title) {
      trackName.textContent = response.title;
      trackArtist.textContent = response.artist || '—';
    }
  });
});
