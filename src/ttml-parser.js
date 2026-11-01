/**
 * Apple Music TTML parser for word-timed and syllable-timed lyrics.
 *
 * Faithfully ported from BitChord's TtmlLyrics.kt.
 * Uses native browser DOMParser for fast, robust XML processing.
 *
 * Key features:
 *   - Parses Apple Music TTML documents with <ttm:agent> metadata
 *   - Merges sub-word syllable spans ("e" + "nough" -> "enough")
 *   - Separates background vocal answering lines (<span ttm:role="x-bg">)
 *   - Computes duet line alignments (Start = left, End = right)
 *   - Inserts instrumental gaps for long pauses
 */

(() => {
  'use strict';

  const { createLyricWord, createLyricLine, computeLineAlignments, withInstrumentalGaps } = window.__YTMLModels;

/**
 * Parses a TTML clock string (e.g., "27.395", "01:05.20", "27395ms", "27.395s") to milliseconds.
 */
function parseTtmlTime(val) {
  if (!val) return null;
  const raw = String(val).trim();
  if (!raw) return null;

  if (raw.endsWith('ms')) {
    const num = parseFloat(raw.slice(0, -2));
    return isNaN(num) ? null : Math.round(num);
  }

  const clean = raw.replace(/s$/i, '');
  const parts = clean.split(':');

  let seconds = null;
  if (parts.length === 1) {
    seconds = parseFloat(parts[0]);
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (!isNaN(m) && !isNaN(s)) seconds = m * 60 + s;
  } else if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) seconds = h * 3600 + m * 60 + s;
  }

  return (seconds != null && !isNaN(seconds)) ? Math.round(seconds * 1000) : null;
}

/**
 * Helper to get an attribute by either qualified or local name.
 */
function getAttr(element, name) {
  if (!element || !element.getAttribute) return '';
  const val = element.getAttribute(name);
  if (val) return val;
  const local = name.includes(':') ? name.split(':')[1] : name;
  return element.getAttribute(local) || '';
}

/**
 * Glues syllable pieces back into whole words with combined start/end timestamps.
 */
function mergePiecesIntoWords(pieces) {
  const words = [];
  let currentText = '';
  let startMs = 0;
  let endMs = 0;
  let hasTimed = false;

  function flush() {
    const text = currentText.trim();
    if (text.length > 0 && hasTimed) {
      words.push(createLyricWord(startMs, endMs, text));
    }
    currentText = '';
    hasTimed = false;
  }

  for (const piece of pieces) {
    if (piece.type === 'text') {
      if (piece.text.trim() === '') {
        flush();
      } else if (hasTimed) {
        currentText += piece.text;
      }
    } else if (piece.type === 'timed') {
      if (!piece.text || piece.text.trim() === '') continue;

      if (/^\s/.test(piece.text)) flush();

      if (currentText === '') startMs = piece.start;
      currentText += piece.text.trim();
      endMs = piece.end;
      hasTimed = true;

      if (/\s$/.test(piece.text)) flush();
    }
  }

  flush();
  return words;
}

/**
 * Recursively flattens DOM nodes into text and timed pieces,
 * separating lead vocals from background vocals (<span ttm:role="x-bg">).
 */
function collectPieces(node, leadOut, bgOut, romanOut = [], transOut = []) {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) { // Element
      const role = getAttr(child, 'ttm:role') || getAttr(child, 'role');
      if (role === 'x-translation') {
        transOut.push(child.textContent || '');
        continue;
      }
      if (role === 'x-roman') {
        romanOut.push(child.textContent || '');
        continue;
      }

      const isBg = role === 'x-bg';
      const targetList = isBg ? bgOut : leadOut;

      const begin = parseTtmlTime(getAttr(child, 'begin'));
      const end = parseTtmlTime(getAttr(child, 'end'));

      // Check if child itself has any timed descendant
      const hasTimedChild = Array.from(child.children).some(c =>
        getAttr(c, 'begin') || c.querySelector('[begin]')
      );

      if (begin != null && end != null && !hasTimedChild) {
        targetList.push({ type: 'timed', text: child.textContent || '', start: begin, end });
      } else {
        collectPieces(child, targetList, bgOut, romanOut, transOut);
      }
    } else if (child.nodeType === 3) { // Text node
      const txt = child.nodeValue || '';
      if (txt.length > 0) {
        leadOut.push({ type: 'text', text: txt });
      }
    }
  }
}

/**
 * Parses Apple Music TTML string into an array of LyricLine objects.
 * Ported from BitChord TtmlLyrics.kt.
 *
 * @param {string} ttmlText
 * @returns {LyricLine[]}
 */
function parseTtmlLyrics(ttmlText) {
  if (!ttmlText || typeof ttmlText !== 'string') return [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlText, 'text/xml');

    // Check for parse error
    if (doc.querySelector('parsererror')) {
      return [];
    }

    // 1. Agent declarations (voices)
    const agentTypes = {};
    const agentElements = doc.querySelectorAll('agent, ttm\\:agent');
    agentElements.forEach(el => {
      const id = getAttr(el, 'xml:id') || getAttr(el, 'id');
      const type = getAttr(el, 'type');
      if (id && type) agentTypes[id] = type;
    });

    // 2. Paragraphs (lines)
    const paragraphs = doc.querySelectorAll('p');
    if (!paragraphs.length) return [];

    const rawSung = [];

    paragraphs.forEach(p => {
      const pBegin = parseTtmlTime(getAttr(p, 'begin'));
      const pEnd = parseTtmlTime(getAttr(p, 'end'));
      const agent = getAttr(p, 'ttm:agent') || getAttr(p, 'agent') || null;

      const leadPieces = [];
      const bgPieces = [];
      const romanPieces = [];
      const transPieces = [];
      collectPieces(p, leadPieces, bgPieces, romanPieces, transPieces);

      const leadWords = mergePiecesIntoWords(leadPieces);
      const bgWords = mergePiecesIntoWords(bgPieces);
      const romanText = romanPieces.join(' ').trim();
      const transText = transPieces.join(' ').trim();

      let bgLine = null;
      if (bgWords.length > 0) {
        bgLine = createLyricLine({
          timeMs: bgWords[0].startMs,
          text: bgWords.map(w => w.text).join(' '),
          words: bgWords
        });
      }

      if (leadWords.length === 0) {
        // Line-synced paragraph
        const text = (p.textContent || '').trim();
        if (!text || pBegin == null) return;

        rawSung.push({
          line: createLyricLine({
            timeMs: pBegin,
            text,
            sungUntilMs: pEnd && pEnd > pBegin ? pEnd : null,
            background: bgLine,
            roman: romanText,
            translation: transText
          }),
          agent
        });
      } else {
        // Word-synced paragraph
        const startTime = pBegin != null ? Math.min(pBegin, leadWords[0].startMs) : leadWords[0].startMs;
        const text = leadWords.map(w => w.text).join(' ');

        rawSung.push({
          line: createLyricLine({
            timeMs: startTime,
            text,
            words: leadWords,
            sungUntilMs: pEnd,
            background: bgLine,
            roman: romanText,
            translation: transText
          }),
          agent
        });
      }
    });

    // Sort by timestamp
    rawSung.sort((a, b) => a.line.timeMs - b.line.timeMs);

    // 3. Duet alignments
    const singers = rawSung.map(r => r.agent);
    const alignments = computeLineAlignments(singers, agentTypes);

    const alignedLines = rawSung.map((item, idx) => {
      return createLyricLine({
        ...item.line,
        alignment: alignments[idx] || 'Start'
      });
    });

    // 4. Instrumental gaps
    return withInstrumentalGaps(alignedLines);
  } catch (err) {
    console.warn('[YTMusicBetterLyrics] Error parsing TTML:', err);
    return [];
  }
}

/**
 * Serializes lyric lines to standard Apple Music TTML.
 * Ported from BitChord's ttml.ts.
 */
function writeTtml(lines, language = 'en') {
  const escape = (text) =>
    (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const clock = (ms) => (Math.max(0, ms) / 1000).toFixed(3);

  function spansOf(words) {
    return words
      .map((word) => {
        return `<span begin="${clock(word.startMs)}" end="${clock(word.endMs)}">${escape(word.text)}</span>`;
      })
      .join(' ');
  }

  const sung = (lines || []).filter((l) => !l.isGap);
  const timed = sung.some((l) => l.timeMs > 0 || l.words.length);
  const wordTimed = sung.some((l) => l.words.length);
  const duet = sung.some((l) => l.alignment === 'End');

  const paragraphs = sung.map((l, index) => {
    const agent = duet ? ` ttm:agent="${l.alignment === 'End' ? 'v2' : 'v1'}"` : '';
    if (!timed) return `<p${agent}>${escape(l.text)}</p>`;
    const next = sung[index + 1]?.timeMs;
    if (l.words.length) {
      const lastEnd = Math.max(l.words[l.words.length - 1].endMs, l.background?.words?.[l.background.words.length - 1]?.endMs || 0);
      const background = l.background?.words?.length
        ? ` <span ttm:role="x-bg">${spansOf(l.background.words)}</span>`
        : '';
      return `<p begin="${clock(l.timeMs)}" end="${clock(lastEnd)}"${agent}>${spansOf(l.words)}${background}</p>`;
    }
    const text = l.background ? `${l.text} ${l.background.text}` : l.text;
    const end = l.sungUntilMs || next || (l.timeMs + 5000);
    return `<p begin="${clock(l.timeMs)}" end="${clock(Math.max(end, l.timeMs))}"${agent}>${escape(text)}</p>`;
  });

  const agents = duet ? '<ttm:agent type="person" xml:id="v1"/><ttm:agent type="other" xml:id="v2"/>' : '';
  return (
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" ` +
    `xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="${escape(language)}" ` +
    `itunes:timing="${wordTimed ? 'Word' : timed ? 'Line' : 'None'}">` +
    `<head><metadata>${agents}</metadata></head><body><div>${paragraphs.join('')}</div></body></tt>`
  );
}

  window.__YTMLTtml = { parseTtmlLyrics, parseTtmlTime, writeTtml };
})();

