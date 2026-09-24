/*
 * 1SEC — Étape 5 : colorimétrie (interface)
 */
(function (root) {
  'use strict';
  var C = root.OneSecColor, B = root.OneSecBridge, F = root.OneSecFrames;
  var H = null; // helpers fournis par app.js
  var refTarget = null, refImage = null;

  function S() { return H.state(); }
  function CS() {
    var s = S();
    if (!s.color) s.color = {
      track: null, rangeOnly: true, look: 'naturel', useRef: false,
      intensity: 1, match: 0.8, adjust: { warm: 0, contrast: 0, saturation: 0, exposure: 0, shadowStrength: 0, highlightStrength: 0, vignette: 0 },
      protectSkin: true, groups: [], perRush: {}, selected: null, applied: false, refName: null
    };
    // migration d'un état plus ancien
    var c = s.color;
    if (!Array.isArray(c.groups)) c.groups = [];
    if (!c.perRush) c.perRush = {};
    if (!c.adjust) c.adjust = { warm: 0, contrast: 0, saturation: 0, exposure: 0, shadowStrength: 0, highlightStrength: 0, vignette: 0 };
    return c;
  }

  function currentLook() {
    var cs = CS();
    if (cs.useRef && refTarget) return refTarget;
    return C.LOOKS[cs.look] || C.LOOKS.naturel;
  }

  function gradeFor(g) {
    var cs = CS(), f = F.get(g.id);
    if (!f || !f.stats) return null;
    var ps = cs.perRush[g.id] || {};
    var adj = Object.assign({}, cs.adjust);
    ['exposure', 'warm', 'contrast', 'saturation'].forEach(function (k) { if (ps[k]) adj[k] += ps[k]; });
    return C.gradeShot(f.stats, currentLook(), {
      matchStrength: cs.match, lookIntensity: cs.intensity * (ps.intensity == null ? 1 : ps.intensity),
      protectSkin: cs.protectSkin, adjust: adj
    });
  }

  // ------------------------------------------------------------ analyse des plans

  function analyzeShots() {
    var cs = CS();
    return H.run(F.load(trackIndex(), rangeOf(), 'Colo').then(function (r) {
      cs.groups = r.groups.map(function (g) { return { id: g.id, name: g.name, starts: g.clips.map(function (c) { return c.start; }) }; });
      cs.applied = false;
      render(); H.save();
      if (r.missing) H.toast(r.missing + ' image(s) non exportée(s) : ' + (r.errors[0] || ''), 'err');
      return r;
    }), function (r) { return r.groups.length + ' rushes (' + r.clips.length + ' plans) analysés'; });
  }
  function rangeOf() { var cs = CS(), s = S(); return cs.rangeOnly && s.music ? { start: s.music.start, end: s.music.end } : null; }

  // ------------------------------------------------------------ rendu

  function lookSwatch(look) {
    var st = look.stats;
    function tone(hue, str, base) {
      if (hue == null || !str) return base;
      var rgb = hsl(hue, 0.6, 0.5);
      return 'rgb(' + rgb.map(function (v, i) { return Math.round(base[i] * (1 - str) + v * str); }).join(',') + ')';
    }
    var dark = [30 + look.fade * 40, 30 + look.fade * 40, 30 + look.fade * 40].map(function (v) { return v + look.warm * 60; });
    var mid = [128 + look.warm * 90, 128, 128 - look.warm * 90];
    var light = [235 + look.warm * 20, 232, 228 - look.warm * 30];
    var sat = look.saturation / 0.3;
    function desat(rgb) { var l = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]; return rgb.map(function (v) { return Math.round(l + (v - l) * sat); }); }
    return [tone(look.shadowHue, look.shadowStrength, desat(dark)), 'rgb(' + desat(mid).join(',') + ')', tone(look.highlightHue, look.highlightStrength, desat(light))]
      .map(function (c) { return typeof c === 'string' ? c : 'rgb(' + c.join(',') + ')'; });
  }
  function hsl(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function renderLooks() {
    var cs = CS(), box = H.$('looks');
    box.innerHTML = '';
    var entries = C.LOOK_ORDER.map(function (k) { return { k: k, look: C.LOOKS[k] }; });
    if (refTarget) entries.unshift({ k: '__ref', look: refTarget });
    entries.forEach(function (e) {
      var on = e.k === '__ref' ? cs.useRef : (!cs.useRef && cs.look === e.k);
      var sw = H.el('div', { class: 'sw' }, lookSwatch(e.look).map(function (c) { return H.el('i', { style: 'background:' + c }); }));
      box.appendChild(H.el('button', { class: 'look' + (on ? ' on' : ''), onclick: function () {
        if (e.k === '__ref') cs.useRef = true; else { cs.useRef = false; cs.look = e.k; }
        cs.applied = false; render(); H.save();
      } }, [sw, H.el('b', { text: e.look.label }), H.el('small', { text: e.look.desc })]));
    });
    H.$('ref-info').textContent = cs.refName ? (refTarget ? 'Référence : ' + cs.refName : 'Référence « ' + cs.refName + ' » à recharger') : '';
  }

  function renderFine() {
    var cs = CS(), a = cs.adjust;
    H.$('g-intensity').value = cs.intensity; H.$('g-intensity-v').textContent = Math.round(cs.intensity * 100) + ' %';
    H.$('g-match').value = cs.match;
    H.$('g-warm').value = a.warm; H.$('g-contrast').value = a.contrast; H.$('g-saturation').value = a.saturation;
    H.$('g-exposure').value = a.exposure; H.$('g-shadow').value = a.shadowStrength; H.$('g-highlight').value = a.highlightStrength; H.$('g-vignette').value = a.vignette;
    H.$('g-skin').checked = cs.protectSkin;
    var s = S(), sel = H.$('grade-track');
    sel.innerHTML = '';
    var tracks = (s.music && s.music.videoTracks) || [{ index: 0 }, { index: 1 }, { index: 2 }];
    tracks.forEach(function (t) { sel.appendChild(H.el('option', { value: t.index, text: 'V' + (t.index + 1) })); });
    sel.value = cs.track == null ? (s.build.videoTrack || 0) : cs.track;
    H.$('grade-range-only').checked = cs.rangeOnly;
    H.$('grade-range-only').disabled = !s.music;
    var nShots = cs.groups.reduce(function (n, g) { return n + g.starts.length; }, 0);
    H.$('grade-analyzed').textContent = cs.groups.length ? cs.groups.length + ' rushes · ' + nShots + ' plans' + (F.has() ? '' : ' (images à ré-analyser)') : '';
    H.$('btn-grade-apply').disabled = !cs.groups.length || !F.has();
  }

  var thumbTimer = null;
  function renderShots() {
    var cs = CS(), box = H.$('grade-shots');
    box.innerHTML = '';
    if (!cs.groups.length) { box.appendChild(H.el('p', { class: 'help small', text: 'Analysez les plans de la piste pour voir les aperçus (une image par rush).' })); return; }
    cs.groups.forEach(function (g) {
      var k = g.id, f = F.get(k), ps = cs.perRush[k] || {};
      var before = H.el('canvas'), after = H.el('canvas');
      var card = H.el('div', { class: 'gshot' + (cs.selected === k ? ' on' : '') + (ps.skip ? ' off' : ''), onclick: function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        cs.selected = cs.selected === k ? null : k; renderShots();
        B.call('OneSec_setPlayhead', { time: g.starts[0] + 0.1 }).catch(function () {});
      } });
      var gr = f && f.stats && !ps.skip ? gradeFor(g) : null;
      var capText = !f || f.error ? 'pas d\'image' + (f && f.error ? ' : ' + f.error : '') : (gr ? 'expo ' + (gr.params.exposure >= 0 ? '+' : '') + gr.params.exposure + ' · temp ' + gr.params.temperature + (gr.protectSkin ? ' · peau' : '') : 'ignoré');
      card.appendChild(H.el('div', { class: 'ba' }, [before, after]));
      card.appendChild(H.el('div', { class: 'cap' }, [H.el('b', { text: g.name, title: g.name }), H.el('span', { text: g.starts.length + ' plan' + (g.starts.length > 1 ? 's' : '') + ' · ' + capText, title: capText })]));
      function slider(label, prop, min, max, step, def) {
        var inp = H.el('input', { type: 'range', min: min, max: max, step: step, value: ps[prop] == null ? def : ps[prop], oninput: function (e) {
          cs.perRush[k] = Object.assign(cs.perRush[k] || {}, {}); cs.perRush[k][prop] = +e.target.value; cs.applied = false;
          scheduleThumb(g, after); H.save();
        } });
        return H.el('label', {}, [H.el('span', { text: label, style: 'width:62px' }), inp]);
      }
      card.appendChild(H.el('div', { class: 'tweak' }, [
        slider('Look', 'intensity', 0, 1.5, 0.05, 1),
        slider('Exposition', 'exposure', -1, 1, 0.05, 0),
        slider('Chaleur', 'warm', -2, 2, 0.1, 0),
        slider('Contraste', 'contrast', -1, 1, 0.1, 0),
        slider('Saturation', 'saturation', -1, 1, 0.1, 0),
        H.el('div', { class: 'row', style: 'margin:2px 0' }, [
          H.el('button', { class: 'small', text: ps.skip ? 'Inclure ce rush' : 'Ne pas étalonner', onclick: function () { cs.perRush[k] = Object.assign(cs.perRush[k] || {}, { skip: !ps.skip }); cs.applied = false; renderShots(); H.save(); } }),
          H.el('button', { class: 'small ghost', text: 'Réinitialiser', onclick: function () { delete cs.perRush[k]; renderShots(); H.save(); } })
        ])
      ]));
      box.appendChild(card);
      if (f && f.small) { drawThumb(before, f, null); drawThumb(after, f, gr); }
    });
  }

  /** Miniature de la zone utile (sans bandes noires), avec ou sans colo. */
  function drawThumb(cv, f, grade) {
    var small = f.small, b = f.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var w = 150, h = Math.max(40, Math.round(w * bh / bw));
    cv.width = w; cv.height = h;
    var tmp = document.createElement('canvas'); tmp.width = small.width; tmp.height = small.height;
    var data = new ImageData(new Uint8ClampedArray(small.data), small.width, small.height);
    if (grade) C.previewGrade(data, grade, b);
    tmp.getContext('2d').putImageData(data, 0, 0);
    cv.getContext('2d').drawImage(tmp, b.x0, b.y0, bw, bh, 0, 0, w, h);
  }
  function scheduleThumb(g, cv) {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(function () { var f = F.get(g.id); if (f && f.small) drawThumb(cv, f, gradeFor(g)); }, 60);
  }
  var allTimer = null;
  function scheduleAll() { clearTimeout(allTimer); allTimer = setTimeout(renderShots, 120); }

  function render() {
    if (!H) return;
    renderLooks(); renderFine(); renderShots();
  }

  // ------------------------------------------------------------ application

  function apply() {
    var cs = CS();
    var grades = [];
    cs.groups.forEach(function (g) {
      var ps = cs.perRush[g.id] || {};
      if (ps.skip) return;
      var gr = gradeFor(g);
      if (gr) g.starts.forEach(function (st) { grades.push({ start: st, params: gr.params }); });
    });
    if (!grades.length) return H.toast('Aucun plan à étalonner.', 'err');
    H.busy(true, 'Application sur ' + grades.length + ' clips…');
    H.run(B.call('OneSec_applyGrades', { videoTrack: trackIndex(), grades: grades }).then(function (r) {
      H.busy(false);
      cs.applied = true; H.save();
      var failed = Object.keys(r.failedParams || {});
      var rep = H.$('grade-report');
      rep.classList.remove('hidden');
      rep.innerHTML = '<div class="ok">✔ Lumetri réglé sur ' + r.applied + ' clip(s)</div>' +
        (r.noLumetri ? '<div class="err">✖ ' + r.noLumetri + ' clip(s) : impossible d\'ajouter Lumetri Color.</div>' : '') +
        (r.missing ? '<div class="warn">⚠ ' + r.missing + ' clip(s) introuvable(s) (piste modifiée ?). Ré-analysez.</div>' : '') +
        (failed.length ? '<div class="warn">⚠ Paramètres non trouvés : ' + failed.join(', ') + '. Lancez « Diagnostic Lumetri » et envoyez-moi la liste pour adapter les noms.</div>' : '') +
        '<div class="muted">Teintes ombres / lumières : à régler dans les roues Lumetri si vous voulez les pousser plus loin (non pilotables par script).</div>';
      render();
      return r;
    }), 'Colo appliquée');
  }

  function trackIndex() { var cs = CS(), s = S(); return Number(cs.track == null ? (s.build.videoTrack || 0) : cs.track); }

  function loadReference(file) {
    var cs = CS();
    B.loadImage(file).then(function (img) {
      var cv = document.createElement('canvas');
      var scale = Math.min(1, 400 / img.width);
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      var data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      refTarget = C.targetFromReference(data);
      refImage = data;
      cs.refName = file.name; cs.useRef = true; cs.applied = false;
      try { localStorage.setItem('onesec.ref', JSON.stringify(refTarget)); } catch (e) {}
      render(); H.save();
      H.toast('Référence analysée : chaleur ' + (refTarget.warm > 0.03 ? 'chaude' : refTarget.warm < -0.03 ? 'froide' : 'neutre') + ', contraste ' + Math.round(refTarget.contrast * 100) + ' %', 'ok');
    }).catch(function (e) { H.toast(e.message, 'err'); });
  }

  // ------------------------------------------------------------ événements

  function bind() {
    H.$('btn-grade-analyze').addEventListener('click', analyzeShots);
    H.$('grade-track').addEventListener('change', function (e) { CS().track = +e.target.value; CS().groups = []; render(); H.save(); });
    H.$('grade-range-only').addEventListener('change', function (e) { CS().rangeOnly = e.target.checked; H.save(); });
    H.$('ref-image').addEventListener('change', function (e) { if (e.target.files[0]) loadReference(e.target.files[0]); });
    function fine(id, set, evt) {
      H.$(id).addEventListener(evt || 'input', function (e) { set(e.target, CS()); CS().applied = false; renderFine(); scheduleAll(); H.save(); });
    }
    fine('g-intensity', function (t, cs) { cs.intensity = +t.value; });
    fine('g-match', function (t, cs) { cs.match = +t.value; });
    fine('g-warm', function (t, cs) { cs.adjust.warm = +t.value; });
    fine('g-contrast', function (t, cs) { cs.adjust.contrast = +t.value; });
    fine('g-saturation', function (t, cs) { cs.adjust.saturation = +t.value; });
    fine('g-exposure', function (t, cs) { cs.adjust.exposure = +t.value; });
    fine('g-shadow', function (t, cs) { cs.adjust.shadowStrength = +t.value; });
    fine('g-highlight', function (t, cs) { cs.adjust.highlightStrength = +t.value; });
    fine('g-vignette', function (t, cs) { cs.adjust.vignette = +t.value; });
    fine('g-skin', function (t, cs) { cs.protectSkin = t.checked; }, 'change');
    H.$('btn-grade-reset').addEventListener('click', function () {
      var cs = CS(); cs.adjust = { warm: 0, contrast: 0, saturation: 0, exposure: 0, shadowStrength: 0, highlightStrength: 0, vignette: 0 }; cs.intensity = 1; cs.match = 0.8;
      render(); H.save();
    });
    H.$('btn-grade-apply').addEventListener('click', apply);
    H.$('btn-grade-remove').addEventListener('click', function () {
      var s = S(), cs = CS();
      var range = cs.rangeOnly && s.music ? { start: s.music.start, end: s.music.end } : null;
      if (!confirm('Retirer l\'effet Lumetri Color de tous les clips de la piste V' + (trackIndex() + 1) + (range ? ' dans la zone de la musique' : '') + ' ?')) return;
      H.run(B.call('OneSec_removeGrades', { videoTrack: trackIndex(), range: range }).then(function (r) { cs.applied = false; render(); H.save(); return r; }), function (r) { return r.removed + ' effet(s) retiré(s).'; });
    });
    H.$('btn-grade-diag').addEventListener('click', function () {
      H.run(B.call('OneSec_listLumetriParams', { videoTrack: trackIndex(), clipIndex: 0 }).then(function (list) {
        var rep = H.$('grade-report');
        rep.classList.remove('hidden');
        rep.innerHTML = '<b>Paramètres Lumetri vus par le script :</b><pre class="log">' + list.map(function (p) { return p.index + '\t' + H.esc(p.name) + '\t' + H.esc(JSON.stringify(p.value)); }).join('\n') + '</pre>';
      }));
    });
  }

  function init(helpers) {
    H = helpers;
    try { var r = localStorage.getItem('onesec.ref'); if (r) refTarget = JSON.parse(r); } catch (e) {}
    bind();
  }

  root.OneSecColorUI = { init: init, render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
