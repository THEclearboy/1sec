/*
 * 1SEC — Planificateur de montage
 * -------------------------------
 * Transforme (analyse musicale + moments des rushes + réglages par section)
 * en une liste de plans calés sur les temps de la musique.
 *
 * Principes « pas robotique » :
 *  - le rythme de coupe dépend de l'énergie de chaque section (lent ↔ rapide) ;
 *  - variations humaines : longueurs de plans mélangées, paires de coupes rapides,
 *    coupes sur les accents forts de la musique ;
 *  - accélération progressive dans les montées, plan « héros » sur les drops ;
 *  - ralentis dans les passages calmes ;
 *  - les plans verrouillés par l'utilisateur sont conservés tels quels.
 *
 * Module pur, testable dans Node.
 */
(function (root, factory) {
  var api = factory();
  root.OneSecPlanner = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Longueur de base d'un plan, en temps (beats)
  var PACES = {
    tres_lent: { label: 'Très lent', beats: 8 },
    lent: { label: 'Lent', beats: 4 },
    normal: { label: 'Normal', beats: 2 },
    rapide: { label: 'Rapide', beats: 1 },
    tres_rapide: { label: 'Très rapide', beats: 0.5 }
  };
  var PACE_ORDER = ['tres_lent', 'lent', 'normal', 'rapide', 'tres_rapide'];
  var SPEEDS = [1, 0.75, 0.5, 0.4, 0.33, 0.25];

  // Couleurs de marqueurs Premiere (index setColorByIndex)
  var MARKER_COLORS = { vert: 0, rouge: 1, violet: 2, orange: 3, jaune: 4, blanc: 5, bleu: 6, cyan: 7 };
  var SECTION_MARKER_COLOR = {
    intro: MARKER_COLORS.cyan, calme: MARKER_COLORS.bleu, pause: MARKER_COLORS.bleu,
    moyen: MARKER_COLORS.vert, montee: MARKER_COLORS.jaune, intense: MARKER_COLORS.orange,
    drop: MARKER_COLORS.rouge, outro: MARKER_COLORS.cyan
  };

  function rngFrom(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      // mulberry32
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function autoPace(section) {
    var e = section.relEnergy == null ? section.energy : section.relEnergy;
    switch (section.type) {
      case 'intro': case 'outro': return e < 0.2 ? 'tres_lent' : 'lent';
      case 'calme': case 'pause': return e < 0.15 ? 'tres_lent' : 'lent';
      case 'montee': return 'normal';
      case 'drop': return 'rapide';
      case 'intense': return e > 0.85 ? 'rapide' : 'normal';
      default: return e > 0.6 ? 'normal' : 'lent';
    }
  }

  function autoSpeed(section) {
    switch (section.type) {
      case 'intro': case 'calme': case 'pause': case 'outro': return 0.5;
      default: return 1;
    }
  }

  function resolveSection(section, setting) {
    setting = setting || {};
    var pace = setting.pace && setting.pace !== 'auto' ? setting.pace : autoPace(section);
    var speed = setting.speed && setting.speed !== 'auto' ? Number(setting.speed) : autoSpeed(section);
    return { pace: pace, speed: speed, paceAuto: !setting.pace || setting.pace === 'auto', speedAuto: !setting.speed || setting.speed === 'auto' };
  }

  // ------------------------------------------------------------ grille

  /** Grille en demi-temps : positions possibles de coupe dans [start, end]. */
  function buildGrid(beats, start, end) {
    var g = [start];
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      if (i > 0) {
        var mid = (beats[i - 1] + b) / 2;
        if (mid > start + 1e-3 && mid < end - 1e-3) g.push(mid);
      }
      if (b > start + 1e-3 && b < end - 1e-3) g.push(b);
    }
    g.push(end);
    g.sort(function (a, b2) { return a - b2; });
    return g;
  }

  function nearestIndex(grid, t) {
    var best = 0;
    for (var i = 1; i < grid.length; i++) if (Math.abs(grid[i] - t) < Math.abs(grid[best] - t)) best = i;
    return best;
  }

  function isDownbeat(t, downbeats) {
    for (var i = 0; i < downbeats.length; i++) if (Math.abs(downbeats[i] - t) < 0.02) return true;
    return false;
  }

  // --------------------------------------------------- découpage d'une zone

  /**
   * Découpe l'intervalle [grid[i0], grid[i1]] (indices de demi-temps) en plans.
   * Retourne une liste de { start, end, halfBeats, tag }.
   */
  function cutSpan(ctx, i0, i1, sec, res, opts) {
    var grid = ctx.grid, rng = ctx.rng, v = opts.variation;
    var halfBeatSec = 30 / ctx.bpm;
    var baseHalf = Math.max(1, Math.round(PACES[res.pace].beats * 2));
    // Pas de demi-temps si trop court à l'écran
    var minHalf = Math.max(1, Math.ceil(opts.minShot / halfBeatSec - 1e-6));
    if (baseHalf < minHalf) baseHalf = minHalf;
    var total = i1 - i0;
    var cuts = [];
    var pos = i0;
    var isBuild = sec.type === 'montee' && opts.accelerateBuilds;
    if (isBuild && sec.buildLo == null) {
      // bornes d'énergie de la montée (10e et 90e centiles sur la section)
      var es = [];
      for (var q = i0; q < i1; q++) es.push(ctx.energyAt(grid[q], grid[q + 1]));
      es.sort(function (x, y) { return x - y; });
      sec.buildLo = es[Math.floor(es.length * 0.1)] || 0;
      sec.buildHi = es[Math.floor(es.length * 0.9)] || 1;
    }

    // Plan « héros » au drop
    if (sec.drop && opts.dropImpact !== 'aucun' && i0 === ctx.sectionStartIdx) {
      var heroHalf = Math.min(total, Math.max(minHalf, sec.heroHalf || 8));
      if (heroHalf >= minHalf && total - heroHalf >= minHalf || heroHalf === total) {
        cuts.push({ i0: pos, i1: pos + heroHalf, tag: 'hero' });
        pos += heroHalf;
      }
    }

    var pendingPair = 0;
    while (pos < i1) {
      var remaining = i1 - pos;
      var len;
      if (isBuild) {
        // Accélération qui suit la montée d'énergie réelle (pas la position) :
        // plans longs tant que la musique reste calme, puis de plus en plus courts.
        var eNow = ctx.energyAt(grid[pos], grid[Math.min(i1, pos + baseHalf)]);
        var progress = clamp((eNow - sec.buildLo) / Math.max(0.08, sec.buildHi - sec.buildLo), 0, 1);
        var f = progress < 0.3 ? 2 : progress < 0.6 ? 1 : progress < 0.85 ? 0.5 : 0.25;
        len = Math.max(minHalf, Math.round(baseHalf * f));
      } else if (pendingPair > 0) {
        len = pendingPair; pendingPair = 0;
      } else {
        var r = rng();
        var pLong = 0.12 + 0.28 * v, pShort = 0.08 + 0.3 * v;
        if (r < pShort && baseHalf / 2 >= minHalf) {
          len = Math.round(baseHalf / 2);
          pendingPair = len; // deux plans courts d'affilée = effet « double coupe »
        } else if (r < pShort + pLong) {
          len = baseHalf * 2;
        } else {
          len = baseHalf;
        }
        // Les plans longs démarrent/finissent de préférence sur une mesure
        if (len >= 8) {
          var end = pos + len;
          for (var k = 0; k <= 2; k++) {
            if (end - k > pos + minHalf && isDownbeat(grid[end - k], ctx.downbeats)) { len -= k; break; }
            if (end + k <= i1 && isDownbeat(grid[end + k], ctx.downbeats)) { len += k; break; }
          }
        }
        // Coupe sur un accent fort de la musique s'il tombe dans le plan
        if (opts.cutOnHits && len >= 3) {
          for (var h = 0; h < ctx.hits.length; h++) {
            var hit = ctx.hits[h];
            if (hit.strength < 0.45) continue;
            var hi = nearestIndex(grid, hit.time);
            if (Math.abs(grid[hi] - hit.time) > 0.06) continue;
            if (hi > pos + minHalf && hi < pos + len && hi <= i1) { len = hi - pos; break; }
          }
        }
      }
      if (len > remaining) len = remaining;
      // Évite un reste trop court en fin de zone : on l'absorbe
      if (remaining - len > 0 && remaining - len < minHalf) len = remaining;
      if (len <= 0) break;
      cuts.push({ i0: pos, i1: pos + len, tag: isBuild ? 'build' : null });
      pos += len;
    }
    return cuts.map(function (c) {
      return { start: grid[c.i0], end: grid[c.i1], halfBeats: c.i1 - c.i0, tag: c.tag };
    });
  }

  // --------------------------------------------------- attribution des rushes

  function momentWindow(m, tail) {
    var out = Math.min(m.peak + tail, m.clipEnd == null ? m.peak + tail : m.clipEnd);
    var hardIn = m.clipStart || 0;
    var prefIn = m.rangeStart != null ? m.rangeStart : Math.max(hardIn, m.peak - (m.defaultLength || 3));
    return { out: out, hardIn: hardIn, prefIn: prefIn };
  }

  function scoreMoment(ctx, m, shot, need) {
    var w = momentWindow(m, ctx.opts.tail);
    var uses = ctx.uses[m.id] || 0;
    var out = w.out - uses * Math.max(need, 0.5); // réutilisation : on remonte dans le rush
    if (out - need < w.hardIn - 1e-6) {
      if (uses > 0) out = w.out; else return null;
    }
    if (out - need < w.hardIn - 1e-6) return null;
    var score = 0;
    var prefLen = w.out - w.prefIn;
    if (need > prefLen) score -= 0.6 * Math.min(1, (need - prefLen) / need);
    // Les moments « top » vont sur les plans importants
    score += (m.rating || 0) * (shot.importance - 0.45) * 2.2;
    score -= uses * 1.6;
    if (ctx.lastClipId != null && m.clipId === ctx.lastClipId) score -= 1.2;
    if (ctx.opts.order === 'chrono' && ctx.momentCount > 1) {
      var expected = shot.progress;
      score -= Math.abs(m.order / (ctx.momentCount - 1) - expected) * 3;
    }
    score += (ctx.rng() - 0.5) * 0.6 * ctx.opts.variation;
    return { score: score, sourceOut: out, sourceIn: out - need };
  }

  function assign(ctx, shot) {
    var best = null, bestM = null;
    var dur = shot.end - shot.start;
    var need = dur * shot.speed;
    ctx.moments.forEach(function (m) {
      var s = scoreMoment(ctx, m, shot, need);
      if (s && (!best || s.score > best.score)) { best = s; bestM = m; }
    });
    if (!bestM) {
      // Aucun moment assez long : on prend le plus long et on ralentit pour tenir.
      var longest = null, lLen = -1;
      ctx.moments.forEach(function (m) {
        var w = momentWindow(m, ctx.opts.tail), l = w.out - w.hardIn;
        if (l > lLen) { lLen = l; longest = m; }
      });
      if (!longest) return false;
      var w = momentWindow(longest, ctx.opts.tail);
      var sp = clamp(lLen / dur, 0.1, shot.speed);
      shot.speed = Math.floor(sp * 100) / 100;
      shot.warning = 'Rush trop court : ralenti forcé à ' + Math.round(shot.speed * 100) + '%';
      bestM = longest;
      best = { sourceOut: w.out, sourceIn: w.out - dur * shot.speed };
    }
    shot.momentId = bestM.id;
    shot.clipId = bestM.clipId;
    shot.clipName = bestM.clipName;
    shot.sourceIn = Math.max(0, best.sourceIn);
    shot.sourceOut = best.sourceOut;
    ctx.uses[bestM.id] = (ctx.uses[bestM.id] || 0) + 1;
    if (ctx.uses[bestM.id] > 1) shot.reused = true;
    ctx.lastClipId = bestM.clipId;
    return true;
  }

  function applyMoment(ctx, shot, momentId) {
    var m = null;
    for (var i = 0; i < ctx.allMoments.length; i++) if (ctx.allMoments[i].id === momentId) m = ctx.allMoments[i];
    if (!m) return false;
    var w = momentWindow(m, ctx.opts.tail);
    var dur = shot.end - shot.start, need = dur * shot.speed;
    if (w.out - need < w.hardIn - 1e-6) {
      shot.speed = Math.max(0.1, Math.floor((w.out - w.hardIn) / dur * 100) / 100);
      need = dur * shot.speed;
      shot.warning = 'Rush trop court : ralenti forcé à ' + Math.round(shot.speed * 100) + '%';
    }
    shot.momentId = m.id; shot.clipId = m.clipId; shot.clipName = m.clipName;
    shot.sourceOut = w.out; shot.sourceIn = Math.max(0, w.out - need);
    ctx.uses[m.id] = (ctx.uses[m.id] || 0) + 1;
    ctx.lastClipId = m.clipId;
    return true;
  }

  // ------------------------------------------------------------ plan complet

  /**
   * @param {object} input
   *   analysis          résultat de OneSecAnalysis.analyze
   *   range             { start, end } en secondes « musique » (portion utilisée)
   *   timelineOffset    temps timeline = temps musique + timelineOffset
   *   fps               images/s de la séquence (quantification)
   *   sectionSettings   { [index]: { pace, speed } }
   *   moments           [{ id, clipId, clipName, peak, rangeStart?, clipStart, clipEnd, rating, enabled, order }]
   *   overrides         { [shotKey]: { momentId?, speed?, locked? } }   (shotKey = début en ms)
   *   options           { seed, variation, accelerateBuilds, dropImpact, cutOnHits, tail, order, minShot }
   */
  function plan(input) {
    var a = input.analysis;
    var range = input.range || { start: 0, end: a.duration };
    var opts = Object.assign({
      seed: 1, variation: 0.5, accelerateBuilds: true, dropImpact: 'ralenti',
      cutOnHits: true, tail: 0.08, order: 'mix', minShot: 0.3
    }, input.options || {});
    var fps = input.fps || 25;
    var offset = input.timelineOffset || 0;
    var overrides = input.overrides || {};
    var settings = input.sectionSettings || {};

    var allMoments = (input.moments || []).map(function (m, i) {
      return Object.assign({ order: i, rating: 0, clipStart: 0 }, m);
    });
    var moments = allMoments.filter(function (m) { return m.enabled !== false; });
    moments.forEach(function (m, i) { m.order = i; });

    var ctx = {
      bpm: a.bpm, rng: rngFrom(opts.seed), opts: opts, downbeats: a.downbeats,
      hits: a.hits || [], moments: moments, allMoments: allMoments, momentCount: moments.length,
      uses: {}, lastClipId: null,
      energyAt: function (t0, t1) {
        var c = a.curves && a.curves.intensity;
        if (!c) return 0.5;
        var i0 = Math.max(0, Math.floor(t0 * c.rate)), i1 = Math.min(c.values.length, Math.max(i0 + 1, Math.ceil(t1 * c.rate)));
        var s = 0;
        for (var i = i0; i < i1; i++) s += c.values[i];
        return i1 > i0 ? s / (i1 - i0) : 0;
      }
    };
    ctx.grid = buildGrid(a.beats, range.start, range.end);
    var grid = ctx.grid;

    // Sections limitées à la portion utilisée, bornes recalées sur la grille
    var sections = [];
    a.sections.forEach(function (s, idx) {
      var s0 = Math.max(s.start, range.start), s1 = Math.min(s.end, range.end);
      if (s1 - s0 < 0.05) return;
      var res = resolveSection(s, settings[idx]);
      sections.push(Object.assign({}, s, { index: idx, start: s0, end: s1, resolved: res }));
    });
    sections.forEach(function (s, i) {
      s.i0 = i === 0 ? 0 : sections[i - 1].i1;
      s.i1 = i === sections.length - 1 ? grid.length - 1 : Math.max(s.i0 + 1, nearestIndex(grid, s.end));
    });

    // Plans verrouillés = contraintes fixes
    var locked = [];
    Object.keys(overrides).forEach(function (k) {
      var o = overrides[k];
      if (o && o.locked && o.start != null && o.end != null) locked.push(o);
    });
    locked.sort(function (x, y) { return x.start - y.start; });

    var shots = [];
    sections.forEach(function (s) {
      ctx.sectionStartIdx = s.i0;
      // Zones libres de la section (hors plans verrouillés)
      var spans = [], cur = s.i0;
      locked.forEach(function (l) {
        var li0 = nearestIndex(grid, l.start), li1 = nearestIndex(grid, l.end);
        if (li1 <= s.i0 || li0 >= s.i1) return;
        if (li0 > cur) spans.push([cur, Math.min(li0, s.i1)]);
        cur = Math.max(cur, li1);
      });
      if (cur < s.i1) spans.push([cur, s.i1]);
      spans.forEach(function (sp) {
        cutSpan(ctx, sp[0], sp[1], s, s.resolved, opts).forEach(function (c) {
          var speed = s.resolved.speed;
          var importance = 0.25 + 0.6 * (s.relEnergy == null ? s.energy : s.relEnergy);
          if (c.tag === 'hero') {
            importance = 1.2;
            if (opts.dropImpact === 'ralenti') speed = Math.min(speed, 0.5);
          }
          if (c.tag === 'build') importance += 0.1;
          shots.push({
            start: c.start, end: c.end, halfBeats: c.halfBeats, beats: c.halfBeats / 2,
            section: s.index, sectionType: s.type, speed: speed, tag: c.tag, importance: importance
          });
        });
      });
    });
    locked.forEach(function (l) {
      shots.push({
        start: l.start, end: l.end, beats: null, section: sectionIndexAt(a.sections, l.start),
        speed: l.speed || 1, locked: true, importance: 1, lockedMoment: l.momentId
      });
    });
    shots.sort(function (x, y) { return x.start - y.start; });
    shots.forEach(function (s, i) {
      s.progress = shots.length > 1 ? i / (shots.length - 1) : 0;
      s.key = shotKey(s.start);
      // Hook : les premiers plans montrent le meilleur (on accroche avant de raconter)
      if (opts.hookSeconds && s.start < range.start + opts.hookSeconds) { s.importance = Math.max(s.importance, 1.15); s.hook = true; }
    });

    // Réglages par plan (vitesse / rush) des plans non verrouillés
    shots.forEach(function (s) {
      var o = overrides[s.key];
      if (!o || s.locked) return;
      if (o.speed) s.speed = Number(o.speed);
      if (o.momentId) s.forcedMoment = o.momentId;
    });

    var warnings = [];
    if (!moments.length) warnings.push('Aucun moment de rush : ajoutez des marqueurs sur vos rushes (étape 2).');

    // Attribution : d'abord les plans importants, puis dans l'ordre chronologique
    if (moments.length) {
      shots.forEach(function (s) {
        var mid = s.lockedMoment || s.forcedMoment;
        if (mid) applyMoment(ctx, s, mid);
      });
      var order = shots.filter(function (s) { return !s.momentId; });
      var important = order.filter(function (s) { return s.importance >= 1; });
      var rest = order.filter(function (s) { return s.importance < 1; });
      important.forEach(function (s) { ctx.lastClipId = null; assign(ctx, s); });
      rest.forEach(function (s, i) {
        var prev = shots[shots.indexOf(s) - 1];
        ctx.lastClipId = prev ? prev.clipId : null;
        assign(ctx, s);
      });
    }

    // Conversion timeline + quantification à l'image
    shots.forEach(function (s, i) {
      s.index = i;
      s.timelineStart = Math.round((s.start + offset) * fps) / fps;
      s.timelineEnd = Math.round((s.end + offset) * fps) / fps;
      s.speed = Math.round(s.speed * 100) / 100;
      if (s.warning) warnings.push('Plan ' + (i + 1) + ' : ' + s.warning);
    });
    shots = shots.filter(function (s) { return s.timelineEnd - s.timelineStart >= 1 / fps - 1e-6; });

    var slow = shots.filter(function (s) { return s.speed < 0.99; }).length;
    var reused = shots.filter(function (s) { return s.reused; }).length;
    if (moments.length && reused) warnings.push(reused + ' plan(s) réutilisent un moment déjà utilisé : ajoutez des marqueurs pour plus de variété.');

    return {
      shots: shots,
      sections: sections.map(function (s) {
        return { index: s.index, start: s.start, end: s.end, type: s.type, label: s.label, energy: s.energy, drop: s.drop, pace: s.resolved.pace, speed: s.resolved.speed, paceAuto: s.resolved.paceAuto, speedAuto: s.resolved.speedAuto };
      }),
      stats: {
        shots: shots.length, slowMotion: slow, reused: reused,
        avgShot: shots.length ? (range.end - range.start) / shots.length : 0
      },
      warnings: warnings
    };
  }

  function sectionIndexAt(sections, t) {
    for (var i = 0; i < sections.length; i++) if (t >= sections[i].start - 1e-3 && t < sections[i].end) return i;
    return sections.length - 1;
  }

  function shotKey(t) { return 't' + Math.round(t * 1000); }

  // ------------------------------------------------------------ marqueurs musique

  /**
   * Liste de marqueurs à poser sur la séquence.
   * opts : { sections, hits, bars, beats }
   */
  function musicMarkers(analysis, range, offset, opts) {
    opts = opts || {};
    range = range || { start: 0, end: analysis.duration };
    offset = offset || 0;
    var out = [];
    function inRange(t) { return t >= range.start - 1e-3 && t < range.end; }
    if (opts.sections !== false) {
      analysis.sections.forEach(function (s, i) {
        var s0 = Math.max(s.start, range.start), s1 = Math.min(s.end, range.end);
        if (s1 - s0 < 0.05) return;
        out.push({
          time: s0 + offset, duration: s1 - s0,
          name: (s.drop ? 'DROP · ' : '') + 'Section ' + (i + 1) + ' · ' + s.label,
          comment: 'section:' + i + ' énergie:' + Math.round(s.energy * 100) + '%',
          color: SECTION_MARKER_COLOR[s.type] != null ? SECTION_MARKER_COLOR[s.type] : MARKER_COLORS.vert,
          kind: 'section'
        });
      });
    }
    if (opts.hits !== false) {
      (analysis.hits || []).forEach(function (h) {
        if (!inRange(h.time)) return;
        out.push({ time: h.time + offset, duration: 0, name: 'Moment fort', comment: 'hit force:' + Math.round(h.strength * 100) + '%', color: MARKER_COLORS.violet, kind: 'hit' });
      });
    }
    if (opts.bars) {
      analysis.downbeats.forEach(function (t, i) {
        if (!inRange(t)) return;
        out.push({ time: t + offset, duration: 0, name: 'Mesure ' + (i + 1), comment: 'bar', color: MARKER_COLORS.blanc, kind: 'bar' });
      });
    }
    if (opts.beats) {
      analysis.beats.forEach(function (t) {
        if (!inRange(t) || isDownbeat(t, analysis.downbeats) && opts.bars) return;
        out.push({ time: t + offset, duration: 0, name: '', comment: 'beat', color: MARKER_COLORS.vert, kind: 'beat' });
      });
    }
    out.sort(function (x, y) { return x.time - y.time; });
    return out;
  }

  // ------------------------------------------------------------ moments des rushes

  /**
   * Convertit les marqueurs posés sur les rushes en « moments ».
   * - marqueur simple  : fin du moment fort (le plan se termine dessus)
   * - marqueur à durée : moment précis [début, fin]
   * - nom contenant « top », « * » ou « ! », ou marqueur rouge : moment top
   * - nom contenant « x » seul ou « skip » : ignoré
   */
  function momentsFromClips(clips, opts) {
    opts = opts || {};
    var defLen = opts.defaultLength || 3;
    var out = [];
    clips.forEach(function (c) {
      var ms = (c.markers || []).slice().sort(function (a, b) { return a.start - b.start; });
      ms.forEach(function (mk, i) {
        var name = (mk.name || '') + ' ' + (mk.comments || '');
        if (/\bskip\b|^\s*x\s*$/i.test(mk.name || '')) return;
        var hasDur = mk.end != null && mk.end - mk.start > 0.1;
        var peak = hasDur ? mk.end : mk.start;
        var prevEnd = i > 0 ? (ms[i - 1].end != null && ms[i - 1].end > ms[i - 1].start ? ms[i - 1].end : ms[i - 1].start) : c.inPoint || 0;
        var top = /top|\*|!/i.test(name) || mk.colorIndex === MARKER_COLORS.rouge;
        out.push({
          id: c.nodeId + '@' + Math.round(peak * 1000),
          clipId: c.nodeId,
          clipName: c.name,
          label: (mk.name || '').trim(),
          peak: peak,
          rangeStart: hasDur ? mk.start : Math.max(prevEnd, peak - defLen),
          defaultLength: defLen,
          clipStart: c.inPoint || 0,
          clipEnd: c.outPoint != null ? c.outPoint : c.duration,
          rating: top ? 1 : 0,
          enabled: true
        });
      });
    });
    return out;
  }

  return {
    plan: plan,
    musicMarkers: musicMarkers,
    momentsFromClips: momentsFromClips,
    resolveSection: resolveSection,
    shotKey: shotKey,
    PACES: PACES,
    PACE_ORDER: PACE_ORDER,
    SPEEDS: SPEEDS,
    MARKER_COLORS: MARKER_COLORS
  };
});
