/*
 * 1SEC — Analyse musicale
 * -----------------------
 * Tempo, temps (beats), mesures, courbe d'énergie, sections (calme / montée /
 * intense / drop…) et moments forts (accents) à partir d'un signal audio PCM.
 *
 * Module pur (aucune dépendance) : utilisable dans le panneau CEP, dans un
 * navigateur ou dans Node (tests).
 */
(function (root, factory) {
  var api = factory();
  root.OneSecAnalysis = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TARGET_SR = 22050;
  var FFT_SIZE = 1024;
  var HOP = 256;
  var CURVE_RATE = 10; // échantillons / seconde pour les courbes exposées

  // ---------------------------------------------------------------- utilitaires

  function mean(a, from, to) {
    from = from || 0; to = to == null ? a.length : to;
    if (to <= from) return 0;
    var s = 0;
    for (var i = from; i < to; i++) s += a[i];
    return s / (to - from);
  }

  function std(a) {
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / Math.max(1, a.length));
  }

  function percentile(a, p) {
    var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; });
    if (!b.length) return 0;
    var idx = Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))));
    return b[idx];
  }

  function movingAverage(a, win) {
    var n = a.length, out = new Float32Array(n);
    var half = Math.max(0, Math.floor(win / 2));
    var s = 0, lo = 0, hi = -1;
    for (var i = 0; i < n; i++) {
      var wantLo = Math.max(0, i - half), wantHi = Math.min(n - 1, i + half);
      while (hi < wantHi) { hi++; s += a[hi]; }
      while (lo < wantLo) { s -= a[lo]; lo++; }
      out[i] = s / (hi - lo + 1);
    }
    return out;
  }

  function normalizeRobust(a, pLo, pHi) {
    var lo = percentile(a, pLo == null ? 0.05 : pLo);
    var hi = percentile(a, pHi == null ? 0.95 : pHi);
    var d = hi - lo || 1;
    var out = new Float32Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = Math.min(1, Math.max(0, (a[i] - lo) / d));
    return out;
  }

  /** Ré-échantillonne une courbe (taux srcRate) vers CURVE_RATE par moyennage. */
  function resampleCurve(a, srcRate, dstRate, duration) {
    var n = Math.max(1, Math.ceil(duration * dstRate));
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var from = Math.floor(i / dstRate * srcRate);
      var to = Math.max(from + 1, Math.floor((i + 1) / dstRate * srcRate));
      out[i] = mean(a, Math.min(from, a.length - 1), Math.min(to, a.length));
    }
    return out;
  }

  function curveAt(curve, t) {
    var i = Math.floor(t * curve.rate);
    if (i < 0) i = 0;
    if (i >= curve.values.length) i = curve.values.length - 1;
    return curve.values[i];
  }

  function curveMean(curve, t0, t1) {
    var a = Math.max(0, Math.floor(t0 * curve.rate));
    var b = Math.min(curve.values.length, Math.max(a + 1, Math.ceil(t1 * curve.rate)));
    return mean(curve.values, a, b);
  }

  // ------------------------------------------------------------ pré-traitement

  function toMono(channels) {
    if (channels.length === 1) return channels[0];
    var n = channels[0].length, out = new Float32Array(n), c = channels.length;
    for (var ch = 0; ch < c; ch++) {
      var d = channels[ch];
      for (var i = 0; i < n; i++) out[i] += d[i] / c;
    }
    return out;
  }

  function downsample(x, sr, target) {
    var factor = Math.max(1, Math.floor(sr / target));
    if (factor === 1) return { data: x, sr: sr };
    var n = Math.floor(x.length / factor), out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0, o = i * factor;
      for (var k = 0; k < factor; k++) s += x[o + k];
      out[i] = s / factor;
    }
    return { data: out, sr: sr / factor };
  }

  // FFT radix-2 itérative, en place.
  function fft(re, im) {
    var n = re.length, i, j, k;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var a = i + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // ------------------------------------------------------------ descripteurs

  function computeFeatures(x, sr) {
    var nFrames = Math.max(0, Math.floor((x.length - FFT_SIZE) / HOP) + 1);
    var nb = FFT_SIZE / 2 + 1;
    var win = new Float32Array(FFT_SIZE);
    for (var w = 0; w < FFT_SIZE; w++) win[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / (FFT_SIZE - 1));
    var lowBin = Math.max(1, Math.round(150 * FFT_SIZE / sr));
    var highBin = Math.round(4000 * FFT_SIZE / sr);

    var rms = new Float32Array(nFrames);
    var flux = new Float32Array(nFrames);
    var lowFlux = new Float32Array(nFrames);
    var lowEnergy = new Float32Array(nFrames);
    var highEnergy = new Float32Array(nFrames);

    var re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
    var prev = new Float32Array(nb), cur = new Float32Array(nb);

    for (var f = 0; f < nFrames; f++) {
      var off = f * HOP, e = 0;
      for (var i = 0; i < FFT_SIZE; i++) {
        var v = x[off + i];
        e += v * v;
        re[i] = v * win[i]; im[i] = 0;
      }
      rms[f] = Math.sqrt(e / FFT_SIZE);
      fft(re, im);
      var fl = 0, lf = 0, le = 0, he = 0;
      for (var b = 0; b < nb; b++) {
        var mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]) / (FFT_SIZE / 2);
        var lm = Math.log(1 + 1000 * mag);
        cur[b] = lm;
        var d = lm - prev[b];
        if (d > 0) { fl += d; if (b <= lowBin) lf += d; }
        if (b <= lowBin) le += mag * mag;
        else if (b >= highBin) he += mag * mag;
      }
      flux[f] = f === 0 ? 0 : fl;
      lowFlux[f] = f === 0 ? 0 : lf;
      lowEnergy[f] = Math.sqrt(le);
      highEnergy[f] = Math.sqrt(he);
      var t = prev; prev = cur; cur = t;
    }
    return {
      frameRate: sr / HOP,
      timeOffset: FFT_SIZE / 2 / sr,
      nFrames: nFrames,
      rms: rms, flux: flux, lowFlux: lowFlux, lowEnergy: lowEnergy, highEnergy: highEnergy
    };
  }

  function onsetEnvelope(flux, frameRate) {
    // Retire la tendance locale (~0.5 s) puis redresse : garde les attaques.
    var local = movingAverage(flux, Math.round(frameRate * 0.5));
    var out = new Float32Array(flux.length);
    for (var i = 0; i < flux.length; i++) out[i] = Math.max(0, flux[i] - local[i]);
    var s = std(out) || 1;
    for (i = 0; i < out.length; i++) out[i] /= s;
    return out;
  }

  // ------------------------------------------------------------------ tempo

  function autocorr(env, lag) {
    var s = 0, n = env.length - lag;
    for (var i = 0; i < n; i++) s += env[i] * env[i + lag];
    return n > 0 ? s / n : 0;
  }

  function estimateTempo(env, frameRate, opts) {
    opts = opts || {};
    var minBpm = opts.minBpm || 60, maxBpm = opts.maxBpm || 200;
    var prior = opts.preferBpm || 120;
    var minLag = Math.floor(60 * frameRate / maxBpm);
    var maxLag = Math.ceil(60 * frameRate / minBpm);
    var ac = [];
    for (var l = 0; l <= maxLag * 2 + 2; l++) ac[l] = autocorr(env, l);
    var scores = [];
    for (l = minLag; l <= maxLag; l++) {
      var bpm = 60 * frameRate / l;
      var w = Math.exp(-0.5 * Math.pow(Math.log(bpm / prior) / Math.LN2 / 0.9, 2));
      var s = ac[l] + 0.5 * ac[2 * l] + 0.25 * (ac[Math.round(l / 2)] || 0);
      scores.push({ lag: l, score: s * w, raw: s });
    }
    var best = null;
    for (var i = 1; i < scores.length - 1; i++) {
      if (scores[i].score >= scores[i - 1].score && scores[i].score >= scores[i + 1].score) {
        if (!best || scores[i].score > best.score) best = scores[i];
      }
    }
    if (!best) best = scores[0];
    // Interpolation parabolique autour du pic pour un lag fractionnaire.
    var y0 = ac[best.lag - 1], y1 = ac[best.lag], y2 = ac[best.lag + 1];
    var denom = y0 - 2 * y1 + y2;
    var lag = best.lag + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / denom)) : 0);
    var cands = scores.slice().sort(function (a, b) { return b.score - a.score; })
      .slice(0, 5).map(function (c) { return Math.round(600 * frameRate / c.lag) / 10; });
    return { bpm: 60 * frameRate / lag, period: lag, candidates: cands };
  }

  // ---------------------------------------------------------- suivi des temps

  /** Programmation dynamique (Ellis 2007). Retourne des indices de trames. */
  function trackBeats(env, period, tightness) {
    tightness = tightness || 100;
    var n = env.length;
    // Lissage gaussien (écart-type = période / 32)
    var sigma = Math.max(1, period / 32), rad = Math.ceil(sigma * 3), ker = [], ks = 0, k;
    for (k = -rad; k <= rad; k++) { var g = Math.exp(-0.5 * (k / sigma) * (k / sigma)); ker.push(g); ks += g; }
    var local = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (k = -rad; k <= rad; k++) { var j = i + k; if (j >= 0 && j < n) s += env[j] * ker[k + rad]; }
      local[i] = s / ks;
    }
    var cum = new Float32Array(n), back = new Int32Array(n);
    var lo = Math.round(period / 2), hi = Math.round(period * 2);
    for (i = 0; i < n; i++) {
      var best = -Infinity, bi = -1;
      for (var p = i - hi; p <= i - lo; p++) {
        if (p < 0) continue;
        var lr = Math.log((i - p) / period);
        var sc = cum[p] - tightness * lr * lr;
        if (sc > best) { best = sc; bi = p; }
      }
      cum[i] = local[i] + (bi >= 0 ? best : 0);
      back[i] = bi;
    }
    // Dernier temps : dernier maximum local de cum au-dessus de la moitié de la médiane des maxima.
    var maxima = [];
    for (i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(i);
    if (!maxima.length) return [];
    var med = percentile(maxima.map(function (m) { return cum[m]; }), 0.5);
    var last = maxima[maxima.length - 1];
    for (i = maxima.length - 1; i >= 0; i--) { if (cum[maxima[i]] >= 0.5 * med) { last = maxima[i]; break; } }
    var beats = [];
    for (var b = last; b >= 0; b = back[b]) { beats.push(b); if (back[b] < 0) break; }
    beats.reverse();
    return beats;
  }

  /** Régularise la grille : comble les trous, prolonge jusqu'au début / à la fin. */
  function regularizeBeats(times, period, duration) {
    if (!times.length) {
      var out0 = [];
      for (var t0 = 0; t0 < duration; t0 += period) out0.push(t0);
      return out0;
    }
    var out = [], i;
    var t = times[0];
    var pre = [];
    while (t - period > -period * 0.25) { t -= period; if (t >= 0) pre.unshift(t); }
    out = pre;
    for (i = 0; i < times.length; i++) {
      if (out.length) {
        var gap = times[i] - out[out.length - 1];
        var steps = Math.round(gap / period);
        if (steps >= 2) {
          for (var s = 1; s < steps; s++) out.push(out[out.length - 1] + gap / steps * 1);
          // corrige la dérive : répartit uniformément
          var base = times[i] - gap;
          for (s = 1; s < steps; s++) out[out.length - steps + s] = base + gap * s / steps;
        } else if (gap < period * 0.4) {
          continue;
        }
      }
      out.push(times[i]);
    }
    t = out[out.length - 1];
    while (t + period < duration - period * 0.1) { t += period; out.push(t); }
    return out;
  }

  function refineBpm(beats) {
    if (beats.length < 8) return null;
    // Régression linéaire temps = a * index + b
    var n = beats.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sx += i; sy += beats[i]; sxx += i * i; sxy += i * beats[i]; }
    var a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return a > 0 ? 60 / a : null;
  }

  function pickDownbeatPhase(beats, feats) {
    var bestPhase = 0, best = -Infinity;
    for (var ph = 0; ph < 4; ph++) {
      var s = 0, c = 0;
      for (var i = ph; i < beats.length; i += 4) {
        var f = Math.round((beats[i] - feats.timeOffset) * feats.frameRate);
        var v = 0;
        for (var k = -2; k <= 2; k++) { var j = f + k; if (j >= 0 && j < feats.nFrames) v = Math.max(v, feats.lowFlux[j]); }
        s += v; c++;
      }
      s = c ? s / c : 0;
      if (s > best) { best = s; bestPhase = ph; }
    }
    return bestPhase;
  }

  function downbeatsFrom(beats, phase) {
    var out = [];
    for (var i = phase; i < beats.length; i += 4) out.push(beats[i]);
    return out;
  }

  // ------------------------------------------------------------ sections

  var SECTION_LABELS = {
    intro: 'Intro', calme: 'Calme', montee: 'Montée', intense: 'Intense',
    drop: 'Drop', pause: 'Pause', outro: 'Outro'
  };

  /**
   * Découpe la musique en sections à partir des courbes d'énergie.
   * sensitivity : 0 (peu de sections) → 1 (beaucoup de sections).
   */
  function computeSections(analysis, opts) {
    opts = opts || {};
    var sensitivity = opts.sensitivity == null ? 0.5 : opts.sensitivity;
    var dur = analysis.duration;
    var bars = analysis.downbeats.slice();
    if (bars.length < 2) return [{ start: 0, end: dur, energy: curveMean(analysis.curves.intensity, 0, dur), type: 'intense', label: SECTION_LABELS.intense, drop: false }];

    // Caractéristiques par mesure
    var feats = [];
    for (var b = 0; b < bars.length; b++) {
      var t0 = bars[b], t1 = b + 1 < bars.length ? bars[b + 1] : dur;
      feats.push([
        curveMean(analysis.curves.intensity, t0, t1),
        curveMean(analysis.curves.low, t0, t1),
        curveMean(analysis.curves.density, t0, t1),
        curveMean(analysis.curves.high, t0, t1)
      ]);
    }
    var weights = [1.4, 1.0, 0.8, 0.6];
    var w = bars.length > 24 ? 4 : 2;
    var novelty = [];
    for (b = 0; b < bars.length; b++) {
      if (b < 2 || b > bars.length - 2) { novelty.push(0); continue; }
      var d = 0;
      for (var k = 0; k < 4; k++) {
        var ml = 0, mr = 0, cl = 0, cr = 0;
        for (var i = Math.max(0, b - w); i < b; i++) { ml += feats[i][k]; cl++; }
        for (i = b; i < Math.min(bars.length, b + w); i++) { mr += feats[i][k]; cr++; }
        d += weights[k] * Math.abs(ml / cl - mr / cr);
      }
      // Légère préférence pour les phrases de 4 mesures
      if (b % 4 === 0) d *= 1.15;
      novelty.push(d);
    }
    var nm = mean(novelty), ns = std(novelty);
    var thr = nm + (1.2 - 1.4 * sensitivity) * ns;
    var minBars = Math.round(12 - 8 * sensitivity); // 12 → 4 mesures
    var minSec = opts.minSectionSeconds || 4;
    var cands = [];
    for (b = 1; b < novelty.length - 1; b++) {
      if (novelty[b] >= novelty[b - 1] && novelty[b] >= novelty[b + 1] && novelty[b] > thr) cands.push(b);
    }
    cands.sort(function (x, y) { return novelty[y] - novelty[x]; });
    var accepted = [];
    cands.forEach(function (c) {
      if (bars[c] < minSec || dur - bars[c] < minSec) return;
      for (var a = 0; a < accepted.length; a++) if (Math.abs(accepted[a] - c) < minBars) return;
      accepted.push(c);
    });
    accepted.sort(function (x, y) { return x - y; });

    var bounds = [0].concat(accepted.map(function (c) { return bars[c]; })).concat([dur]);
    var sections = [];
    for (i = 0; i < bounds.length - 1; i++) {
      var s0 = bounds[i], s1 = bounds[i + 1];
      var q = (s1 - s0) / 4;
      sections.push({
        index: i,
        start: s0, end: s1,
        energy: curveMean(analysis.curves.intensity, s0, s1),
        startEnergy: curveMean(analysis.curves.intensity, s0, s0 + q),
        endEnergy: curveMean(analysis.curves.intensity, s1 - q, s1)
      });
    }
    labelSections(sections);
    return sections;
  }

  function labelSections(sections) {
    var n = sections.length;
    var energies = sections.map(function (s) { return s.energy; });
    var eMax = Math.max.apply(null, energies), eMin = Math.min.apply(null, energies);
    var span = Math.max(0.15, eMax - eMin);
    sections.forEach(function (s, i) {
      var rel = (s.energy - eMin) / span; // énergie relative au morceau
      s.relEnergy = rel;
      var prev = sections[i - 1], next = sections[i + 1];
      var rising = s.endEnergy - s.startEnergy > 0.15;
      var type;
      if (rel >= 0.62) type = 'intense';
      else if (rel >= 0.35) type = rising && next && next.energy > s.energy + 0.1 ? 'montee' : 'intense';
      else type = rising && next && next.energy > s.energy + 0.15 ? 'montee' : 'calme';
      if (rel >= 0.35 && rel < 0.62 && !(rising && next && next.energy > s.energy + 0.1)) type = 'moyen';
      if (i === 0 && rel < 0.5 && type !== 'montee') type = 'intro';
      if (i === n - 1 && n > 2 && rel < 0.5) type = 'outro';
      if (prev && rel < 0.3 && prev.relEnergy > 0.6 && next && next.energy > s.energy + 0.2) type = 'pause';
      s.drop = !!(prev && rel >= 0.6 && s.startEnergy - prev.endEnergy > 0.18);
      if (s.drop) type = 'drop';
      s.type = type;
      s.label = SECTION_LABELS[type] || 'Normal';
    });
    return sections;
  }
  SECTION_LABELS.moyen = 'Normal';

  // ------------------------------------------------------------ moments forts

  function computeHits(analysis, onsetCurve, opts) {
    opts = opts || {};
    var maxPerMinute = opts.maxPerMinute || 12;
    var v = onsetCurve.values, rate = onsetCurve.rate, n = v.length;
    var win = Math.round(rate * 3);
    var loc = movingAverage(v, win);
    // écart-type local
    var sq = new Float32Array(n);
    for (var i = 0; i < n; i++) sq[i] = (v[i] - loc[i]) * (v[i] - loc[i]);
    var locStd = movingAverage(sq, win);
    var cands = [];
    for (i = 1; i < n - 1; i++) {
      if (v[i] < v[i - 1] || v[i] < v[i + 1]) continue;
      var z = (v[i] - loc[i]) / (Math.sqrt(locStd[i]) + 1e-6);
      if (z < 2.2) continue;
      var t = i / rate;
      var strength = z * (0.4 + curveAt(analysis.curves.intensity, t));
      cands.push({ time: t, strength: strength });
    }
    cands.sort(function (a, b) { return b.strength - a.strength; });
    var maxHits = Math.max(2, Math.round(analysis.duration / 60 * maxPerMinute));
    var minGap = 60 / analysis.bpm * 1.5;
    var hits = [];
    for (i = 0; i < cands.length && hits.length < maxHits; i++) {
      var c = cands[i], ok = true;
      for (var j = 0; j < hits.length; j++) if (Math.abs(hits[j].time - c.time) < minGap) { ok = false; break; }
      if (ok) hits.push(c);
    }
    // Recalage sur le temps le plus proche s'il est à moins de 80 ms
    hits.forEach(function (h) {
      var nb = nearest(analysis.beats, h.time);
      if (nb != null && Math.abs(nb - h.time) < 0.08) h.time = nb;
    });
    var maxS = hits.reduce(function (m, h) { return Math.max(m, h.strength); }, 1e-6);
    hits.forEach(function (h) { h.strength = Math.round(h.strength / maxS * 100) / 100; });
    hits.sort(function (a, b) { return a.time - b.time; });
    return hits;
  }

  function nearest(arr, t) {
    var lo = 0, hi = arr.length - 1;
    if (hi < 0) return null;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid; else hi = mid; }
    return Math.abs(arr[lo] - t) <= Math.abs(arr[hi] - t) ? arr[lo] : arr[hi];
  }

  // ------------------------------------------------------------ API principale

  /**
   * Analyse complète.
   * @param {Float32Array[]} channels  PCM (un tableau par canal)
   * @param {number} sampleRate
   * @param {object} [opts] { preferBpm, sensitivity, onProgress }
   */
  function analyze(channels, sampleRate, opts) {
    opts = opts || {};
    var mono = toMono(channels);
    var duration = mono.length / sampleRate;
    var ds = downsample(mono, sampleRate, TARGET_SR);
    var feats = computeFeatures(ds.data, ds.sr);
    // Enveloppe d'attaques : spectre complet + graves renforcés (kick / caisse
    // claire) pour ne pas se caler sur les charleston à contretemps.
    var envFull = onsetEnvelope(feats.flux, feats.frameRate);
    var envLow = onsetEnvelope(feats.lowFlux, feats.frameRate);
    var env = new Float32Array(envFull.length);
    for (var e0 = 0; e0 < env.length; e0++) env[e0] = 0.5 * envFull[e0] + envLow[e0];

    var tempo = estimateTempo(env, feats.frameRate, opts);
    var beatFrames = trackBeats(env, tempo.period, opts.tightness);
    var rawBeats = beatFrames.map(function (f) { return f / feats.frameRate + feats.timeOffset; });
    var period = 60 / tempo.bpm;
    var refined = refineBpm(rawBeats);
    if (refined && Math.abs(refined - tempo.bpm) / tempo.bpm < 0.06) period = 60 / refined;
    var beats = regularizeBeats(rawBeats, period, duration);
    var bpm = refineBpm(beats) || 60 / period;

    // Courbes (10 Hz)
    var fr = feats.frameRate;
    var rmsDb = new Float32Array(feats.nFrames), lowDb = new Float32Array(feats.nFrames), highDb = new Float32Array(feats.nFrames);
    for (var i = 0; i < feats.nFrames; i++) {
      rmsDb[i] = 20 * Math.log(feats.rms[i] + 1e-5) / Math.LN10;
      lowDb[i] = 20 * Math.log(feats.lowEnergy[i] + 1e-5) / Math.LN10;
      highDb[i] = 20 * Math.log(feats.highEnergy[i] + 1e-5) / Math.LN10;
    }
    var loud = normalizeRobust(movingAverage(rmsDb, Math.round(fr * 1.0)));
    var low = normalizeRobust(movingAverage(lowDb, Math.round(fr * 1.0)));
    var high = normalizeRobust(movingAverage(highDb, Math.round(fr * 1.0)));
    var dens = normalizeRobust(movingAverage(env, Math.round(fr * 2.0)));
    var inten = new Float32Array(feats.nFrames);
    for (i = 0; i < feats.nFrames; i++) inten[i] = 0.5 * loud[i] + 0.2 * low[i] + 0.3 * dens[i];
    inten = normalizeRobust(movingAverage(inten, Math.round(fr * 1.5)), 0.02, 0.98);

    function curve(a) { return { rate: CURVE_RATE, values: Array.prototype.slice.call(resampleCurve(a, fr, CURVE_RATE, duration)) }; }

    // Forme d'onde (pics) pour l'affichage : 50 valeurs / s
    var wfRate = 50, wfN = Math.ceil(duration * wfRate), peaks = new Array(wfN);
    var spp = sampleRate / wfRate;
    for (i = 0; i < wfN; i++) {
      var m = 0, a0 = Math.floor(i * spp), a1 = Math.min(mono.length, Math.floor((i + 1) * spp));
      for (var s = a0; s < a1; s += 4) { var av = Math.abs(mono[s]); if (av > m) m = av; }
      peaks[i] = Math.round(m * 1000) / 1000;
    }

    var analysis = {
      version: 1,
      duration: duration,
      bpm: Math.round(bpm * 10) / 10,
      bpmCandidates: tempo.candidates,
      beats: beats,
      downbeatPhase: 0,
      downbeats: [],
      curves: {
        intensity: curve(inten),
        low: curve(low),
        high: curve(high),
        density: curve(dens),
        onset: curve(env)
      },
      waveform: { rate: wfRate, peaks: peaks },
      sections: [],
      hits: []
    };
    analysis.downbeatPhase = pickDownbeatPhase(beats, feats);
    analysis.downbeats = downbeatsFrom(beats, analysis.downbeatPhase);
    analysis.sections = computeSections(analysis, { sensitivity: opts.sensitivity });
    analysis.hits = computeHits(analysis, analysis.curves.onset, opts);
    return analysis;
  }

  /** Change la sensibilité du découpage sans ré-analyser l'audio. */
  function resegment(analysis, sensitivity) {
    analysis.sections = computeSections(analysis, { sensitivity: sensitivity });
    return analysis;
  }

  /** Décale le premier temps de la mesure (0..3). */
  function setDownbeatPhase(analysis, phase) {
    analysis.downbeatPhase = ((phase % 4) + 4) % 4;
    analysis.downbeats = downbeatsFrom(analysis.beats, analysis.downbeatPhase);
    return analysis;
  }

  /** Double (factor 2) ou divise par deux (factor 0.5) le tempo détecté. */
  function scaleTempo(analysis, factor, sensitivity) {
    var b = analysis.beats, out = [], i;
    if (factor === 2) {
      for (i = 0; i < b.length; i++) {
        out.push(b[i]);
        if (i + 1 < b.length) out.push((b[i] + b[i + 1]) / 2);
      }
      analysis.bpm = Math.round(analysis.bpm * 20) / 10;
    } else if (factor === 0.5) {
      for (i = 0; i < b.length; i += 2) out.push(b[i]);
      analysis.bpm = Math.round(analysis.bpm * 5) / 10;
    } else return analysis;
    analysis.beats = out;
    setDownbeatPhase(analysis, 0);
    resegment(analysis, sensitivity);
    analysis.hits = computeHits(analysis, analysis.curves.onset, {});
    return analysis;
  }

  return {
    analyze: analyze,
    resegment: resegment,
    setDownbeatPhase: setDownbeatPhase,
    scaleTempo: scaleTempo,
    curveAt: curveAt,
    curveMean: curveMean,
    SECTION_LABELS: SECTION_LABELS,
    _internal: { fft: fft, estimateTempo: estimateTempo, trackBeats: trackBeats, onsetEnvelope: onsetEnvelope, computeFeatures: computeFeatures, regularizeBeats: regularizeBeats }
  };
});
