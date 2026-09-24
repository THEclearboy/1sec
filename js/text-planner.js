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

  // ------------------------------------------------------------ mode dynamique

  var STOP = /^(le|la|les|l'|un|une|des|du|de|d'|et|ou|à|a|au|aux|en|y|ne|n'|pas|que|qu'|qui|se|s'|ce|c'|ça|tu|te|t'|je|j'|on|il|elle|ils|nous|vous|me|m'|mon|ma|mes|ton|ta|tes|son|sa|ses|the|a|an|and|or|to|of|in|it|is|you|your|i|we|they|my|me|on|at|for|but|so|do|be)$/i;

  function rng(seed) {
    var x = (seed >>> 0) || 1;
    return function () { x = (x + 0x6D2B79F5) >>> 0; var t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** Impact d'un mot (0..1) : longueur, majuscules, ponctuation, *étoiles*, chiffres, position. */
  function wordImpact(raw, index, count) {
    var w = raw.replace(/^[*_]+|[*_]+$/g, '');
    var clean = w.replace(/[.,!?;:…»«"']/g, '');
    var score = 0.25;
    if (STOP.test(clean.toLowerCase())) score = 0.08;
    else score += Math.min(0.3, clean.length / 30);
    if (/^[*_].*[*_]$/.test(raw)) score += 0.5;
    if (clean.length > 2 && clean === clean.toUpperCase() && /[A-ZÀ-Ý]/.test(clean)) score += 0.4;
    if (/[!?]/.test(w)) score += 0.25;
    if (/\d/.test(clean)) score += 0.2;
    if (index === count - 1) score += 0.25;
    if (index === 0 && count > 2) score += 0.05;
    return Math.min(1, score);
  }

  /** Découpe une phrase en groupes de 1 à 3 mots : les mots-outils s'accrochent au mot suivant. */
  function chunk(words, random) {
    var groups = [], cur = [], target = pick();
    function pick() { var r = random(); return r < 0.25 ? 1 : r < 0.7 ? 2 : 3; }
    for (var i = 0; i < words.length; i++) {
      var w = words[i], clean = w.replace(/[.,!?;:…»«"'*_]/g, '');
      cur.push(w);
      var endsPunct = /[.!?…;:,]$/.test(w);
      var nextIsStop = i + 1 < words.length && STOP.test(words[i + 1].replace(/[.,!?;:…»«"'*_]/g, '').toLowerCase());
      var isStop = STOP.test(clean.toLowerCase());
      if (endsPunct || (cur.length >= target && !isStop && !nextIsStop) || (cur.length >= 4 && !isStop)) { groups.push(cur); cur = []; target = pick(); }
      else if (cur.length >= 4 && isStop) { var carry = cur.pop(); groups.push(cur); cur = [carry]; target = pick(); }
    }
    if (cur.length) { if (groups.length && cur.length === 1 && STOP.test(cur[0].toLowerCase())) groups[groups.length - 1].push(cur[0]); else groups.push(cur); }
    return groups;
  }

  var ZONES = [
    { x: 0.5, y: 0.30, align: 'center' }, { x: 0.5, y: 0.50, align: 'center' }, { x: 0.5, y: 0.68, align: 'center' },
    { x: 0.42, y: 0.40, align: 'left' }, { x: 0.58, y: 0.58, align: 'right' }, { x: 0.5, y: 0.42, align: 'center' }, { x: 0.5, y: 0.60, align: 'center' }
  ];

  /**
   * Mode dynamique : groupes de mots, tailles selon l'impact, positions variées, durée selon le poids.
   * opts : + variety (0..1 : déplacements / rotation), seed, sizeSpread (0..1)
   */
  function planDynamic(phrases, analysis, opts) {
    opts = opts || {};
    var from = opts.from == null ? 0 : opts.from, to = opts.to == null ? analysis.duration : opts.to;
    var offset = opts.timelineOffset || 0, beat = 60 / analysis.bpm;
    var variety = opts.variety == null ? 0.7 : opts.variety, spread = opts.sizeSpread == null ? 0.8 : opts.sizeSpread;
    var random = rng(opts.seed || 7);
    var hold = (opts.hold == null ? 2 : opts.hold) * beat, gap = (opts.phraseGap == null ? 1 : opts.phraseGap) * beat;
    var list = phrases.map(splitWords).filter(function (w) { return w.length; });
    if (!list.length) return [];
    var groupsAll = list.map(function (words) {
      var gs = chunk(words, random), out = [], idx = 0;
      gs.forEach(function (g) {
        var ws = g.map(function (w) { var imp = wordImpact(w, idx, words.length); idx++; return { text: w.replace(/^[*_]+|[*_]+$/g, ''), impact: imp }; });
        var impact = Math.max.apply(null, ws.map(function (x) { return x.impact; }));
        out.push({ words: ws, impact: impact });
      });
      return out;
    });
    var nGroups = groupsAll.reduce(function (n, g) { return n + g.length; }, 0);
    // Durée de base par groupe : on remplit la fenêtre, entre 1 et 4 temps
    var avail = (to - from) - list.length * (gap + hold);
    var perGroup = Math.max(beat, Math.min(4 * beat, avail / Math.max(1, nGroups)));
    var half = perGroup < beat * 1.5;
    var times = grid(analysis, from, to, half);
    var cards = [], ti = 0, lastZone = -1;
    groupsAll.forEach(function (groups, pi) {
      var states = [];
      groups.forEach(function (g, gi) {
        if (ti >= times.length) return;
        var t = times[ti];
        // groupes plus lourds : tiennent plus longtemps (en pas de grille)
        var beatsWanted = Math.round((perGroup / beat) * (0.7 + 0.6 * g.impact));
        var steps = Math.max(1, Math.round(beatsWanted * (half ? 2 : 1)));
        ti += steps;
        // zone : jamais la même deux fois de suite ; les plus forts au centre
        var zi;
        if (g.impact > 0.75 || variety < 0.15) zi = 1;
        else { do { zi = Math.floor(random() * ZONES.length); } while (zi === lastZone); }
        if (variety < 0.4 && zi > 2) zi = zi % 3;
        lastZone = zi;
        var z = ZONES[zi];
        var jitter = variety * 0.06;
        var lines = layoutWords(g.words, spread);
        states.push({
          start: t, words: g.words, lines: lines, impact: g.impact, phrase: pi, group: gi, pop: true,
          popStrength: 0.6 + 0.8 * g.impact,
          x: z.x + (random() - 0.5) * jitter, y: z.y + (random() - 0.5) * jitter * 1.5,
          align: z.align, rotate: (random() - 0.5) * 8 * variety * (g.impact > 0.5 ? 1 : 0.4)
        });
      });
      if (!states.length) return;
      for (var i = 0; i < states.length; i++) {
        var last = i === states.length - 1;
        states[i].end = last ? Math.min(to, Math.max(states[i].start + beat, ti < times.length ? times[ti] : states[i].start + hold)) : states[i + 1].start;
        if (last) states[i].end = Math.min(to, Math.max(states[i].end, states[i].start + hold));
        cards.push(states[i]);
      }
      var resumeAt = states[states.length - 1].end + gap;
      while (ti < times.length && times[ti] < resumeAt - 1e-3) ti++;
    });
    cards.forEach(function (c) { c.timelineStart = c.start + offset; c.timelineEnd = c.end + offset; });
    return cards;
  }

  /** Met les mots d'un groupe en lignes : le mot fort seul sur sa ligne, tailles selon l'impact. */
  function layoutWords(words, spread) {
    var lines = [], cur = [];
    words.forEach(function (w, i) {
      var size = 0.75 + (0.25 + 1.15 * spread) * w.impact; // 0.75 → ~2.1
      var big = w.impact >= 0.6;
      var item = { text: w.text, size: Math.round(size * 100) / 100, emphasis: big };
      if (big && cur.length) { lines.push(cur); cur = []; }
      cur.push(item);
      if (big) { lines.push(cur); cur = []; }
    });
    if (cur.length) lines.push(cur);
    return lines.map(function (ws) { return { words: ws }; });
  }

  return { planTexts: planTexts, planDynamic: planDynamic, splitWords: splitWords, hookWindow: hookWindow, wordImpact: wordImpact, chunk: chunk };
});
