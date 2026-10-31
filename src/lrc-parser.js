/**
 * Enhanced LRC & Standard LRC parser.
 *
 * Ported from BitChord:
 *   - EnhancedLrc.kt: Enhanced A2 LRC with word tags <mm:ss.xx>word
 *   - KaraokeLrc: QQ/NetEase millisecond ranges [start, dur](start, dur)word
 *   - LrcLib.kt: standard line-synced [mm:ss.xx]
 *
 * Integrates background vocals extraction and instrumental gaps.
 */

(() => {
  'use strict';

  const { createLyricWord, createLyricLine, withBackgroundVocals, withInstrumentalGaps } = window.__YTMLModels;

const LINE_RE = /^\[(\d{1,3}):(\d{2})[.:](\d{2,3})](.*)$/;
const WORD_RE = /<(\d{1,3}):(\d{2})[.:](\d{2,3})>([^<]*)/g;
const META_RE = /^\[(?:ti|ar|al|by|offset|length|re|ve):/i;

// Karaoke LRC regex (QQ/NetEase)
const KARAOKE_LINE = /^\[(\d{1,8}),(\d{1,8})](.*)$/;
const KARAOKE_WORD = /\((\d{1,8}),(\d{1,8})(?:,\d{1,8})?\)([^()]*)/g;

function stamp(min, sec, frac) {
  const fracMs = frac.length === 3 ? parseInt(frac, 10) : parseInt(frac, 10) * 10;
  return parseInt(min, 10) * 60000 + parseInt(sec, 10) * 1000 + fracMs;
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Parses Enhanced LRC (Musixmatch rich sync, SimpMusic rich sync).
 */
function parseEnhancedLrc(lrc) {
  const rows = [];
  const lines = lrc.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || META_RE.test(line)) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const lineMs = stamp(m[1], m[2], m[3]);
    const content = m[4];

    const wordMatches = [];
    let wm;
    WORD_RE.lastIndex = 0;
    while ((wm = WORD_RE.exec(content)) !== null) {
      wordMatches.push({ startMs: stamp(wm[1], wm[2], wm[3]), rawText: wm[4] });
    }

    const plain = decodeEntities(content.replace(/<[^>]+>/g, '').trim());
    rows.push({ timeMs: lineMs, wordMatches, plain });
  }

  if (!rows.some(r => r.wordMatches.length > 0)) return [];

  const parsedLines = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextLineMs = i + 1 < rows.length ? rows[i + 1].timeMs : null;

    if (row.wordMatches.length === 0) {
      parsedLines.push(createLyricLine({ timeMs: row.timeMs, text: row.plain, words: [] }));
      continue;
    }

    const words = row.wordMatches.map((w, j) => {
      const nextStart = j + 1 < row.wordMatches.length
        ? row.wordMatches[j + 1].startMs
        : (nextLineMs ?? (w.startMs + 2000));
      return createLyricWord(w.startMs, nextStart, decodeEntities(w.rawText.trim()));
    }).filter(w => w.text !== '');

    parsedLines.push(createLyricLine({
      timeMs: row.timeMs,
      text: row.plain,
      words
    }));
  }

  return withInstrumentalGaps(withBackgroundVocals(parsedLines));
}

/**
 * Parses Karaoke LRC (QQ Music / NetEase format: [startMs, durMs](startMs, durMs)text).
 */
function parseKaraokeLrc(raw) {
  const lines = raw.split('\n');
  const rows = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = KARAOKE_LINE.exec(line);
    if (!match) continue;

    const lineStart = parseInt(match[1], 10);
    const lineDuration = parseInt(match[2], 10);
    const body = match[3];

    const words = [];
    let wm;
    KARAOKE_WORD.lastIndex = 0;
    while ((wm = KARAOKE_WORD.exec(body)) !== null) {
      const wStart = parseInt(wm[1], 10);
      const wDur = parseInt(wm[2], 10);
      const text = decodeEntities(wm[3].trim());
      if (text) words.push(createLyricWord(wStart, wStart + wDur, text));
    }

    if (words.length === 0) continue;
    const cleanText = decodeEntities(body.replace(/\(\d+,\d+(?:,\d+)?\)/g, '')).trim();

    rows.push(createLyricLine({
      timeMs: Math.min(lineStart, words[0].startMs),
      text: cleanText,
      words,
      sungUntilMs: lineDuration > 0 ? (lineStart + lineDuration) : null
    }));
  }

  if (rows.length === 0) return [];
  rows.sort((a, b) => a.timeMs - b.timeMs);
  return withInstrumentalGaps(withBackgroundVocals(rows));
}

/**
 * Parses standard line-synced LRC [mm:ss.xx] text.
 */
function parseStandardLrc(lrc) {
  const rows = [];
  const lines = lrc.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || META_RE.test(line)) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const timeMs = stamp(m[1], m[2], m[3]);
    const text = decodeEntities(m[4].replace(/<[^>]+>/g, '').trim());
    if (text) {
      rows.push(createLyricLine({ timeMs, text, words: [] }));
    }
  }

  rows.sort((a, b) => a.timeMs - b.timeMs);
  return withInstrumentalGaps(withBackgroundVocals(rows));
}

/**
 * Parses arbitrary LRC string (Enhanced, Karaoke, or Standard).
 */
function parseAnyLrc(lrc) {
  if (!lrc || typeof lrc !== 'string') return [];

  // Check Karaoke LRC
  if (lrc.includes('](') && KARAOKE_LINE.test(lrc.trim())) {
    const karaoke = parseKaraokeLrc(lrc);
    if (karaoke.length > 0) return karaoke;
  }

  // Check Enhanced LRC
  const enhanced = parseEnhancedLrc(lrc);
  if (enhanced.length > 0) return enhanced;

  // Fallback to Standard LRC
  const std = parseStandardLrc(lrc);
  if (std.length > 0) return std;

  // Fallback to plain lines if unsynced
  return parsePlainLines(lrc);
}

function parsePlainLines(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => decodeEntities(l.trim())).filter(Boolean);
  return lines.map(t => createLyricLine({ timeMs: 0, text: t, words: [] }));
}

  window.__YTMLLrc = { parseAnyLrc, parseEnhancedLrc, parseStandardLrc, parseKaraokeLrc, parsePlainLines, decodeEntities };
})();

