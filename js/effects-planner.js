/*
 * 1SEC — Planificateur d'effets
 * -----------------------------
 * À partir du plan de montage (plans), de l'analyse musicale (accents,
 * sections, temps) et des réglages, produit une liste d'opérations :
 *   { type: 'punch',      start, keys: [{ t, scale }] }            zoom sec sur un accent
 *   { type: 'shake',      start, keys: [{ t, dx, dy }] }           secousse d'impact
 *   { type: 'kenburns',   start, keys: [{ t, scale }] }            zoom lent sur un plan long
 *   { type: 'pulse',      start, keys: [{ t, exposure }] }         pulsation lumière (Lumetri)
 *   { type: 'transition', start, name, duration, position }        transition en début de plan
 * `start` = début du plan sur la timeline (identifie le clip), `t` = temps
 * depuis le début du plan (secondes). Règle d'or : peu d'effets, justifiés.
 */
(function (root, factory) {
  var api = factory();
  root.OneSecEffects = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    punch: true, punchAmount: 0.08, punchMinStrength: 0.55,
    shake: true, shakeAmount: 12, shakeMinStrength: 0.8,
    kenburns: true, kenburnsAmount: 0.05, kenburnsMinBeats: 4,
    flash: true, flashFrames: 6,
    dissolve: true, dissolveFrames: 12,
    fadeInOut: true, fadeFrames: 20,
    pulse: false, pulseAmount: 0.35, pulseBeats: 8,
    maxPerMinute: 14, density: 0.6
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /**
   * @param plan      résultat de OneSecPlanner.plan (shots en temps musique + timelineStart)
   * @param analysis  OneSecAnalysis.analyze
   * @param fps
   * @param options   voir DEFAULTS
   */
  function planEffects(plan, analysis, fps, options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var shots = plan.shots, ops = [], f = 1 / fps;
    if (!shots.length) return { ops: [], summary: {} };
    var offset = shots[0].timelineStart - shots[0].start; // timeline = musique + offset
    var beat = 60 / analysis.bpm;
    var secByIdx = {};
    plan.sections.forEach(function (s) { secByIdx[s.index] = s; });
    var firstShot = shots[0], lastShot = shots[shots.length - 1];
    var maxHits = Math.max(1, Math.round((lastShot.end - firstShot.start) / 60 * o.maxPerMinute * o.density));

    function shotAt(t) {
      for (var i = 0; i < shots.length; i++) if (t >= shots[i].start - 1e-3 && t < shots[i].end - 1e-3) return shots[i];
      return null;
    }
    function tl(shot, tMusic) { return { shot: shot, t: Math.max(0, tMusic - shot.start) }; }

    // ---- Accents : punch-in / shake, du plus fort au plus faible, sans doublon par plan
    var hits = (analysis.hits || []).slice().sort(function (a, b) { return b.strength - a.strength; });
    var used = {}, nHits = 0;
    hits.forEach(function (h) {
      if (nHits >= maxHits) return;
      var shot = shotAt(h.time);
      if (!shot || used[shot.key]) return;
      var sec = secByIdx[shot.section] || {};
      var calm = /intro|calme|pause|outro/.test(sec.type || '');
      var local = tl(shot, h.time).t;
      var dur = shot.timelineEnd - shot.timelineStart;
      if (dur - local < 4 * f) return; // trop près de la fin : la coupe suivante fait l'accent
      var atCut = local < 3 * f; // l'accent tombe sur la coupe → « impact cut »
      var strongest = h.strength >= o.shakeMinStrength && !calm;
      if (o.shake && strongest && shot.speed >= 0.99) {
        var a = o.shakeAmount * (0.6 + 0.4 * h.strength);
        var t0 = atCut ? 0 : local;
        var keys = atCut ? [] : [{ t: t0 - f, dx: 0, dy: 0 }];
        keys = keys.concat([{ t: t0, dx: a, dy: -a * 0.6 }, { t: t0 + f, dx: -a * 0.8, dy: a * 0.5 }, { t: t0 + 2 * f, dx: a * 0.4, dy: a * 0.2 }, { t: t0 + 3 * f, dx: 0, dy: 0 }]);
        ops.push({ type: 'shake', start: shot.timelineStart, hit: h.time + offset, keys: keys });
        used[shot.key] = true; nHits++;
      } else if (o.punch && h.strength >= o.punchMinStrength && !calm) {
        var amt = 1 + o.punchAmount * (0.7 + 0.3 * h.strength);
        var release = Math.min(dur - f, Math.max(4 * f, beat * 0.75));
        var pk = atCut
          ? [{ t: 0, scale: amt }, { t: release, scale: 1 }]
          : [{ t: local - f, scale: 1 }, { t: local + f, scale: amt }, { t: Math.min(dur - f, local + release), scale: 1 }];
        ops.push({ type: 'punch', start: shot.timelineStart, hit: h.time + offset, keys: pk });
        used[shot.key] = true; nHits++;
      }
    });

    // ---- Zoom lent sur les plans longs (et non déjà animés)
    if (o.kenburns) {
      shots.forEach(function (s, i) {
        var beats = (s.end - s.start) / beat, dur = s.timelineEnd - s.timelineStart;
        if (beats < o.kenburnsMinBeats || used[s.key]) return;
        var dir = i % 2 ? -1 : 1; // alterne avant / arrière
        var a = o.kenburnsAmount;
        ops.push({ type: 'kenburns', start: s.timelineStart, keys: dir > 0
          ? [{ t: 0, scale: 1 }, { t: dur, scale: 1 + a }]
          : [{ t: 0, scale: 1 + a }, { t: dur, scale: 1 }] });
      });
    }

    // ---- Transitions
    var trans = {};
    function addTransition(shot, name, frames, position) {
      if (!shot || trans[shot.key]) return;
      trans[shot.key] = true;
      ops.push({ type: 'transition', start: shot.timelineStart, name: name, duration: frames / fps, position: position || 'start' });
    }
    if (o.fadeInOut) {
      addTransition(firstShot, 'dipBlack', o.fadeFrames, 'start');
      ops.push({ type: 'transition', start: lastShot.timelineStart, name: 'dipBlack', duration: o.fadeFrames / fps, position: 'end' });
    }
    if (o.flash) {
      plan.sections.forEach(function (s) {
        if (!s.drop) return;
        var shot = shotAt(s.start + 1e-3);
        if (shot && shot !== firstShot) addTransition(shot, 'dipWhite', o.flashFrames, 'start');
      });
    }
    if (o.dissolve) {
      shots.forEach(function (s, i) {
        if (i === 0) return;
        var sec = secByIdx[s.section] || {};
        var prev = shots[i - 1];
        var calm = /intro|calme|pause|outro/.test(sec.type || '');
        var longEnough = (s.end - s.start) >= beat * 2 && (prev.end - prev.start) >= beat * 2;
        if (calm && longEnough && (s.speed < 0.99 || prev.speed < 0.99 || i % 2 === 0)) addTransition(s, 'dissolve', o.dissolveFrames, 'start');
      });
    }

    // ---- Pulsation lumière sur les premiers temps du drop
    if (o.pulse) {
      plan.sections.forEach(function (s) {
        if (!s.drop) return;
        var t0 = s.start, n = 0;
        analysis.beats.forEach(function (b) {
          if (n >= o.pulseBeats || b < t0 - 1e-3 || b > s.end) return;
          var shot = shotAt(b);
          if (!shot) return;
          var local = tl(shot, b).t;
          if (shot.timelineEnd - shot.timelineStart - local < 3 * f) return;
          var op = ops.filter(function (x) { return x.type === 'pulse' && x.start === shot.timelineStart; })[0];
          if (!op) { op = { type: 'pulse', start: shot.timelineStart, keys: [] }; ops.push(op); }
          op.keys.push({ t: Math.max(0, local - f), exposure: 0 }, { t: local, exposure: o.pulseAmount * (n === 0 ? 1.4 : 1) }, { t: local + 2 * f, exposure: 0 });
          n++;
        });
      });
    }

    ops.sort(function (a, b) { return a.start - b.start; });
    var summary = {};
    ops.forEach(function (op) { var k = op.type === 'transition' ? op.name : op.type; summary[k] = (summary[k] || 0) + 1; });
    return { ops: ops, summary: summary };
  }

  var LABELS = { punch: 'punch-in', shake: 'shake', kenburns: 'zoom lent', pulse: 'pulsation', dipWhite: 'flash blanc', dipBlack: 'fondu au noir', dissolve: 'fondu enchaîné' };

  return { planEffects: planEffects, DEFAULTS: DEFAULTS, LABELS: LABELS };
});
