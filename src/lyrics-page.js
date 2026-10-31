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

  let isFullPageOpen = false;

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

  // ─── 1. Full Page DOM Initialization ──────────────────────────────────────────

  function initFullLyricsPage() {
    if (document.getElementById(FULL_PAGE_ID)) return;

    const page = document.createElement('div');
    page.id = FULL_PAGE_ID;
    page.className = 'ytm-apple-lyrics-page';

    page.innerHTML = `
      <canvas id="ytm-lyrics-mesh-canvas" class="ytm-mesh-canvas"></canvas>
      <div class="ytm-lyrics-scrim"></div>

      <div class="ytm-lyrics-header">
        <div class="ytm-header-left">
          <button id="ytm-lyrics-close-btn" class="ytm-icon-btn" title="Close Lyrics (Esc)">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
          <span class="ytm-badge-title">Lyrics</span>
        </div>

        <div class="ytm-header-right">
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
        <div class="ytm-lyrics-left-pane">
          <div class="ytm-art-wrapper">
            <img id="ytm-lyrics-art" src="" alt="Album Artwork" class="ytm-lyrics-art-img" />
            <div class="ytm-art-glow" id="ytm-art-glow"></div>
          </div>
          <div class="ytm-track-meta">
            <h1 id="ytm-lyrics-title" class="ytm-track-title">—</h1>
            <h2 id="ytm-lyrics-artist" class="ytm-track-artist">—</h2>
            <p id="ytm-lyrics-album" class="ytm-track-album"></p>
          </div>
        </div>

        <div class="ytm-lyrics-right-pane" id="ytm-lyrics-scroll-container">
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

  function bindFullPageEvents() {
    document.getElementById('ytm-lyrics-close-btn').addEventListener('click', closeFullLyricsPage);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isFullPageOpen) closeFullLyricsPage();
    });

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

    document.addEventListener('click', () => {
      if (fullSourceDropdownEl) fullSourceDropdownEl.classList.remove('ytm-dropdown-open');
      if (tabSourceDropdownEl) tabSourceDropdownEl.classList.remove('ytm-dropdown-open');
    });
  }

  // ─── 2. Default YouTube Music Lyrics Tab Integration ─────────────────────────

  function getTabTarget() {
    let target = document.querySelector('ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');
    if (target) return target;

    const shelf = document.querySelector('ytmusic-description-shelf-renderer');
    if (shelf) {
      target = shelf.closest('ytmusic-tab-renderer') || shelf.parentElement;
      if (target) return target;
    }

    const customRenderer = document.querySelector('.ytm-custom-lyrics-tab-renderer');
    if (customRenderer) return customRenderer;

    const tabRendererContainer = document.querySelector('ytmusic-player-page #tab-renderer') ||
                                 document.querySelector('#tab-renderer');
    if (tabRendererContainer) {
      target = tabRendererContainer.querySelector('[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]');
      if (target) return target;

      const renderers = tabRendererContainer.children;
      if (renderers.length >= 2) {
        return renderers[1];
      }
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
        if (currentLines.length > 0 && tabStreamEl && tabLineElements.length === 0) {
          renderLyricsStreamInto(tabStreamEl, tabLineElements, 'tab');
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

    const srcBtn = document.getElementById('ytm-tab-source-btn');
    srcBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tabSourceDropdownEl.classList.toggle('ytm-dropdown-open');
    });

    document.getElementById('ytm-tab-offset-minus').addEventListener('click', () => adjustOffset(-200));
    document.getElementById('ytm-tab-offset-plus').addEventListener('click', () => adjustOffset(200));
    document.getElementById('ytm-tab-offset-reset').addEventListener('click', () => resetOffset());

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
  }

  // ─── 3. Lyrics Rendering & DOM Construction ──────────────────────────────────

  function renderLyricsStreamInto(streamEl, lineElementsArr, mode) {
    if (!streamEl) return;
    streamEl.innerHTML = '';
    lineElementsArr.length = 0;

    const topSpacer = document.createElement('div');
    topSpacer.className = 'ytm-stream-spacer';
    streamEl.appendChild(topSpacer);

    currentLines.forEach((line, idx) => {
      const lineRow = document.createElement('div');
      lineRow.className = `ytm-lyric-row ytm-align-${line.alignment.toLowerCase()} ${mode === 'tab' ? 'ytm-tab-row' : ''}`;
      lineRow.dataset.index = idx;
      lineRow.dataset.timeMs = line.timeMs;

      if (line.isGap) {
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

        // Interactive Click to Seek
        lineRow.addEventListener('click', () => {
          seekToTimestamp(line.timeMs);
        });
      }

      streamEl.appendChild(lineRow);
      lineElementsArr.push(lineRow);
    });

    const botSpacer = document.createElement('div');
    botSpacer.className = 'ytm-stream-spacer';
    streamEl.appendChild(botSpacer);
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
    rafId = requestAnimationFrame(tick);
    if (currentLines.length === 0) return;

    const video = document.querySelector('video');
    if (!video) return;

    const posMs = (video.currentTime * 1000) + timingOffsetMs + LOOKAHEAD_MS;
    updateHighlight(posMs);
  }

  function updateHighlight(posMs) {
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
        // Word completed — settled white at normal size
        span.style.opacity   = '1';
        span.style.transform = 'scale(1)';
        span.style.filter    = 'none';
        charSpans.forEach(cs => {
          cs.style.setProperty('--ytm-char-fill', '1');
        });
      } else if (isCurrent) {
        const duration = Math.max(1, word.endMs - word.startMs);
        const elapsed  = posMs - word.startMs;
        const progress = Math.min(1, elapsed / duration); // 0 → 1

        // Active word size increase: gently swells up while being sung with a soft bloom aura
        const swell = Math.sin(progress * Math.PI); // smooth 0 -> 1 -> 0 arc
        const scale = 1.0 + swell * 0.055; // up to ~1.055x subtle size increase

        span.style.opacity   = '1';
        span.style.transform = `scale(${scale.toFixed(3)})`;
        span.style.filter    = 'drop-shadow(0 0 12px rgba(255, 255, 255, 0.45))';

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
        span.style.transform = 'scale(1)';
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

    // Dynamic progressive blur: increases continuously the farther the lyrics are from active line
    // dist 1 (immediate neighbors): gentle camera blur ~2.5px
    // dist 2: noticeable blur ~5.5px
    // dist 3: deep atmospheric blur ~9.5px
    // dist 4: ~14.5px
    // dist 5+: heavy depth-of-field melt up to ~24px
    const blur = dist === 1 ? 2.5
               : dist === 2 ? 5.5
               : dist === 3 ? 9.5
               : dist === 4 ? 14.5
               : Math.min(24.0, 14.5 + (dist - 4) * 3.5);

    // Opacity falls off smoothly with distance
    const opacity = dist === 1 ? 0.65
                  : dist === 2 ? 0.42
                  : dist === 3 ? 0.28
                  : dist === 4 ? 0.18
                  : Math.max(0.08, 0.18 - (dist - 4) * 0.03);

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

  function openFullLyricsPage() {
    initFullLyricsPage();
    isFullPageOpen = true;
    fullPageEl.classList.add('ytm-page-open');
    document.body.classList.add('ytm-lyrics-open');
    meshBackdrop.start();
    startRafLoop();
    chrome.storage.local.set({ lyricsPageOpen: true });
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

  function toggleFullLyricsPage() {
    if (isFullPageOpen) closeFullLyricsPage();
    else openFullLyricsPage();
  }

  function updateTrackMeta(meta) {
    initFullLyricsPage();
    mountLyricsInTab();

    const artImg = document.getElementById('ytm-lyrics-art');
    const titleEl = document.getElementById('ytm-lyrics-title');
    const artistEl = document.getElementById('ytm-lyrics-artist');
    const albumEl = document.getElementById('ytm-lyrics-album');

    if (meta.artwork && artImg) {
      artImg.src = meta.artwork;
      meshBackdrop.sampleFromImage(artImg);
    }
    if (titleEl) titleEl.textContent = meta.title || '—';
    if (artistEl) artistEl.textContent = meta.artist || '—';
    if (albumEl) albumEl.textContent = meta.album || '';
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

    updateSourceDropdowns();

    if (!activeResult || !activeResult.lines || activeResult.lines.length === 0) {
      showNoLyricsState();
      return;
    }

    currentLines = activeResult.lines;
    lastActiveIdx = -1;

    renderLyricsStreamInto(fullStreamEl, fullLineElements, 'full');
    renderLyricsStreamInto(tabStreamEl, tabLineElements, 'tab');

    startRafLoop();
  }

  function showLoadingState() {
    initFullLyricsPage();
    mountLyricsInTab();
    syncDomReferences();

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

  window.__YTMLLyricsPage = {
    openFullLyricsPage,
    closeFullLyricsPage,
    toggleFullLyricsPage,
    openLyricsPage: openFullLyricsPage,
    closeLyricsPage: closeFullLyricsPage,
    toggleLyricsPage: toggleFullLyricsPage,
    mountLyricsInTab,
    updateTrackMeta,
    setLyricsData,
    showLoadingState,
    showNoLyricsState
  };
})();
