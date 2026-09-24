/*
 * 1SEC — Textes dynamiques
 * ------------------------
 * Transforme des phrases en « cartes » de texte calées sur la musique :
 * chaque mot apparaît sur un temps (ou demi-temps), le dernier mot d'une
 * phrase est mis en avant.
 *
 * planTexts(phrases, analysis, opts) → [{ start, end, lines: [{ text, emphasis }], pop, phrase, word }]
 *   phrases : ["Tu consommes plus que tu ne crées.", ...] (temps musique)
 *   opts    : { mode: 'stack' | 'word', from, to, timelineOffset, wordsPerBeat (0.5 | 1 | 2 | 'auto'),
 *               phraseGap (temps de pause entre phrases, en temps), hold (durée du dernier état, en temps),
 *               emphasisLast (bool) }
 */
(function (root, factory) {
  var api = factory();
  root.OneSecText = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function splitWords(phrase) {
    return phrase.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  }

  /** Grille de temps (beats) entre from et to, en demi-temps si besoin. */
  function grid(analysis, from, to, half) {
    var out = [], b = analysis.beats;
    for (var i = 0; i < b.length; i++) {
      if (b[i] < from - 1e-3 || b[i] > to + 1e-3) continue;
      if (half && i > 0 && (b[i - 1] + b[i]) / 2 >= from - 1e-3) out.push((b[i - 1] + b[i]) / 2);
      out.push(b[i]);
    }
    out = out.filter(function (t, i, a) { return t >= from - 1e-3 && (i === 0 || t - a[i - 1] > 1e-3); });
    if (!out.length) out.push(from);
    return out;
  }

  function planTexts(phrases, analysis, opts) {
    opts = opts || {};
    var mode = opts.mode || 'stack';
    var from = opts.from == null ? 0 : opts.from;
    var to = opts.to == null ? analysis.duration : opts.to;
    var offset = opts.timelineOffset || 0;
    var beat = 60 / analysis.bpm;
    var hold = (opts.hold == null ? 2 : opts.hold) * beat;
    var gap = (opts.phraseGap == null ? 1 : opts.phraseGap) * beat;
    var emphasisLast = opts.emphasisLast !== false;
    var list = phrases.map(splitWords).filter(function (w) { return w.length; });
    if (!list.length) return [];

    // Densité : combien de mots par temps
    var totalWords = list.reduce(function (n, w) { return n + w.length; }, 0);
    var available = (to - from) - list.length * gap - list.length * hold;
    var wpb = opts.wordsPerBeat;
    if (!wpb || wpb === 'auto') {
      var perBeatNeeded = totalWords / Math.max(1, available / beat);
      wpb = perBeatNeeded <= 0.6 ? 0.5 : perBeatNeeded <= 1.2 ? 1 : 2;
    }
    var half = wpb >= 2, everyN = wpb <= 0.5 ? 2 : 1;
    var times = grid(analysis, from, to, half);
    if (everyN > 1) times = times.filter(function (t, i) { return i % everyN === 0; });

    var cards = [], ti = 0;
    list.forEach(function (words, pi) {
      var states = [];
      words.forEach(function (w, wi) {
        if (ti >= times.length) return;
        var t = times[ti++];
        var lines;
        if (mode === 'stack') {
          lines = words.slice(0, wi + 1).map(function (x, k) { return { text: x, emphasis: emphasisLast && k === words.length - 1 && wi === words.length - 1 }; });
        } else {
          lines = [{ text: w, emphasis: emphasisLast && wi === words.length - 1 }];
        }
        states.push({ start: t, lines: lines, phrase: pi, word: wi, pop: true });
      });
      if (!states.length) return;
      for (var i = 0; i < states.length; i++) {
        var last = i === states.length - 1;
        states[i].end = last ? Math.min(to, states[i].start + hold) : states[i + 1].start;
        cards.push(states[i]);
      }
      // pause entre phrases : on saute les temps couverts par hold + gap
      var resumeAt = states[states.length - 1].end + gap;
      while (ti < times.length && times[ti] < resumeAt - 1e-3) ti++;
    });
    cards.forEach(function (c) { c.timelineStart = c.start + offset; c.timelineEnd = c.end + offset; });
    return cards;
  }

  /** Temps musique où un texte « hook » tient : du début jusqu'au premier changement marqué (max maxSec). */
  function hookWindow(analysis, maxSec) {
    var end = Math.min(maxSec || 3, analysis.duration);
    var s = analysis.sections;
    if (s && s.length > 1 && s[1].start > 1 && s[1].start < end) end = s[1].start;
    return { start: 0, end: end };
  }

  return { planTexts: planTexts, splitWords: splitWords, hookWindow: hookWindow };
});
