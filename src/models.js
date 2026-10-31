/**
 * Data structures and post-processing algorithms for synced lyrics.
 *
 * Faithfully ported from BitChord:
 *   - LyricWord: { startMs, endMs, text }
 *   - LyricAlignment: 'Start' | 'End'
 *   - LyricLine: { timeMs, text, words, sungUntilMs, background, alignment, timingSource }
 *   - withBackgroundVocals(): splits trailing bracket "(vocal)" into a secondary line underneath
 *   - lineAlignments(): alternates duet voices between Left and Right columns
 *   - withInstrumentalGaps(): inserts blank gap lines with breathing dots for pauses >= 4000ms
 */

(() => {
  'use strict';

  const MIN_GAP_MS = 4000;
  const RISE_MS = 200;

/** Smooth easing: cubic hermite t*t*(3 - 2*t). */
function smoothHermite(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Creates a LyricWord object.
 */
function createLyricWord(startMs, endMs, text) {
  return { startMs, endMs, text };
}

/**
 * Creates a LyricLine object with timing methods.
 */
function createLyricLine({
  timeMs = 0,
  text = '',
  words = [],
  sungUntilMs = null,
  background = null,
  alignment = 'Start',
  timingSource = null
} = {}) {
  const line = {
    timeMs: Math.round(timeMs),
    text: text.trim(),
    words: words || [],
    sungUntilMs: sungUntilMs != null ? Math.round(sungUntilMs) : null,
    background: background || null,
    alignment: alignment || 'Start',
    timingSource: timingSource || null,

    get isGap() {
      return this.text.length === 0;
    },

    get isWordSynced() {
      return this.words.length > 0;
    },

    get hasKnownEnd() {
      return this.words.length > 0 || this.sungUntilMs != null;
    },

    get endMs() {
      const lead = this.words.length > 0
        ? this.words[this.words.length - 1].endMs
        : (this.sungUntilMs ?? this.timeMs);
      const bg = this.background ? this.background.endMs : lead;
      return Math.max(lead, bg);
    },

    /**
     * How far (0..1) the word at [index] has lifted off the floor at [positionMs].
     * Words held longer reach 1.0 and rest there; quick syllables only lift partially.
     */
    wordLift(index, positionMs) {
      const word = this.words[index];
      if (!word) return 0;
      const rising = Math.max(0, Math.min(1, (positionMs - word.startMs) / RISE_MS));
      const falling = Math.max(0, Math.min(1, 1 - (positionMs - word.endMs) / RISE_MS));
      return smoothHermite(Math.min(rising, falling));
    },

    /**
     * Fractional character index into [text] revealed by the karaoke sweep at [positionMs].
     */
    revealedChars(positionMs) {
      if (this.timingSource) {
        if (!this.timingSource.text) return 0;
        const ratio = this.timingSource.revealedChars(positionMs) / this.timingSource.text.length;
        return Math.max(0, Math.min(1, ratio)) * this.text.length;
      }

      if (this.words.length === 0) {
        return positionMs >= this.timeMs ? this.text.length : 0;
      }

      let offset = 0;
      for (let i = 0; i < this.words.length; i++) {
        const word = this.words[i];
        let start = this.text.indexOf(word.text, offset);
        if (start < 0) start = offset;
        const end = start + word.text.length;
        offset = end;

        if (positionMs < word.startMs) return start;
        if (positionMs <= word.endMs) {
          const dur = Math.max(1, word.endMs - word.startMs);
          const prog = (positionMs - word.startMs) / dur;
          return start + smoothHermite(prog) * (end - start);
        }
      }
      return this.text.length;
    }
  };

  return line;
}

/**
 * Splits trailing bracketed backing vocals "(backing vocals)" out of the lead line
 * and attaches them as line.background so they draw underneath and highlight on their own.
 * Ported from BitChord BackgroundVocals.kt.
 */
function withBackgroundVocals(lines) {
  return lines.map(line => {
    if (line.background || line.isGap) return line;

    const text = line.text;
    if (!text.endsWith(')')) return line;

    // Walk back to find the opening bracket of the trailing group
    let depth = 0;
    let openIdx = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === ')') depth++;
      else if (text[i] === '(') {
        depth--;
        if (depth === 0) {
          if (i > 0) openIdx = i;
          break;
        }
      }
    }

    if (openIdx <= 0) return line;

    const leadText = text.substring(0, openIdx).trim();
    const backingText = text.substring(openIdx).trim();
    if (!leadText || !/[a-zA-Z0-9]/.test(backingText)) return line;

    if (line.words.length === 0) {
      // Line-synced
      return createLyricLine({
        ...line,
        text: leadText,
        background: createLyricLine({
          timeMs: line.timeMs,
          text: backingText,
          sungUntilMs: line.sungUntilMs
        })
      });
    }

    // Word-synced: find which word starts at or after openIdx
    let at = 0;
    let splitIdx = -1;
    for (let i = 0; i < line.words.length; i++) {
      if (at >= openIdx) {
        splitIdx = i;
        break;
      }
      at += line.words[i].text.length + 1;
    }

    if (splitIdx <= 0) return line;

    const leadWords = line.words.slice(0, splitIdx);
    const backingWords = line.words.slice(splitIdx);

    return createLyricLine({
      ...line,
      text: leadText,
      words: leadWords,
      background: createLyricLine({
        timeMs: backingWords[0]?.startMs || line.timeMs,
        text: backingText,
        words: backingWords
      })
    });
  });
}

/**
 * Inserts empty lines for instrumental breaks >= 4000ms.
 * Ported from BitChord LyricGaps.kt.
 */
function withInstrumentalGaps(lines) {
  if (!lines || lines.length === 0) return [];
  const out = [];

  // Intro gap
  if (lines[0].timeMs >= MIN_GAP_MS) {
    out.push(createLyricLine({ timeMs: 0, text: '' }));
  }

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    out.push(current);

    const next = lines[i + 1];
    if (!next) continue;

    if (!current.hasKnownEnd) continue;
    const silence = next.timeMs - current.endMs;
    if (silence >= MIN_GAP_MS && current.endMs > current.timeMs) {
      out.push(createLyricLine({ timeMs: current.endMs, text: '' }));
    }
  }

  return out;
}

/**
 * Duet voice alternation algorithm.
 * Alternates singers between 'Start' (Left) and 'End' (Right).
 * Ported from BitChord LyricAlignments.kt.
 */
function computeLineAlignments(singers, agentTypes = {}) {
  let left = true;
  let lastVoice = null;
  let rightward = 0;
  let placed = 0;

  const sides = singers.map(singer => {
    if (!singer) return 'Start';

    const type = agentTypes[singer] || (
      singer === 'v1000' ? 'group' :
      singer === 'v2000' ? 'other' : 'person'
    );
    placed++;

    if (type === 'group') return 'Start';

    if (lastVoice == null) {
      left = type !== 'other';
    } else if (singer !== lastVoice) {
      left = !left;
    }
    lastVoice = singer;

    if (!left) rightward++;
    return left ? 'Start' : 'End';
  });

  if (placed === 0 || (rightward / placed) < 0.85) return sides;

  // Flip if mostly rightward
  return sides.map(s => s === 'Start' ? 'End' : 'Start');
}

  window.__YTMLModels = {
    createLyricWord,
    createLyricLine,
    withBackgroundVocals,
    withInstrumentalGaps,
    computeLineAlignments,
    smoothHermite,
    RISE_MS,
    MIN_GAP_MS
  };
})();

