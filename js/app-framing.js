/*
 * 1SEC — Format / cadrage (étape 4)
 * Adapte des rushes 16:9 (ou 4:3) au format de la séquence (ex. 9:16 vertical).
 */
(function (root) {
  'use strict';
  var C = root.OneSecColor, B = root.OneSecBridge, F = root.OneSecFrames;
  var H = null;

  function S() { return H.state(); }
  function FS() {
    var s = S();
    if (!s.framing) s.framing = { mode: 'subject', track: null, rangeOnly: true, groups: [], seq: null, perRush: {}, selected: null };
    return s.framing;
  }
  function track() { var fs = FS(), s = S(); return Number(fs.track == null ? (s.build.videoTrack || 0) : fs.track); }
  function range() { var fs = FS(), s = S(); return fs.rangeOnly && s.music ? { start: s.music.start, end: s.music.end } : null; }
  

  function analyze() {
    var fs = FS();
    return H.run(F.load(track(), range(), 'Cadrage').then(function (r) {
      fs.seq = r.seq;
      fs.groups = r.groups.map(function (g) { return { id: g.id, name: g.name, media: g.media, starts: g.clips.map(function (c) { return c.start; }) }; });
      render(); H.save();
      if (r.missing) H.toast(r.missing + ' image(s) non exportée(s) : ' + (r.errors[0] || ''), 'err');
      return r;
    }), function (r) { return r.groups.length + ' rushes (' + r.clips.length + ' plans) analysés'; });
  }

  function framingFor(g) {
    var fs = FS(), f = F.get(g.id), ps = fs.perRush[g.id] || {};
    var m = g.media || {};
    if (!m.width || !fs.seq || !fs.seq.width) return null;
    var subject = fs.mode === 'subject' && f && f.subject && f.subject.confidence > 0.15 ? f.subject : { x: 0.5, y: 0.5 };
    return C.fitFraming(m.width * (m.par || 1), m.height, fs.seq.width, fs.seq.height, subject, { x: ps.x || 0, y: ps.y || 0 });
  }

  function apply() {
    var fs = FS();
    if (!fs.groups.length) return H.toast('Analysez d\'abord les plans.', 'err');
    var items = [], noDims = 0;
    fs.groups.forEach(function (g) {
      var fr = fs.mode === 'auto' ? null : framingFor(g);
      if (fs.mode !== 'auto' && !fr) { noDims += g.starts.length; return; }
      g.starts.forEach(function (st) {
        items.push(fs.mode === 'auto' ? { start: st, mode: 'auto' } : { start: st, mode: 'fixed', scale: fr.scale, x: fr.x, y: fr.y });
      });
    });
    if (!items.length) return H.toast('Dimensions des rushes inconnues : impossible de cadrer.', 'err');
    H.busy(true, 'Cadrage de ' + items.length + ' clips…');
    H.run(B.call('OneSec_applyFraming', { videoTrack: track(), items: items }).then(function (r) {
      H.busy(false);
      var rep = H.$('fr-report');
      rep.classList.remove('hidden');
      rep.innerHTML = '<div class="ok">✔ ' + (r.fixed + r.auto) + ' clip(s) cadré(s)' + (r.auto ? ' — ' + r.auto + ' en recadrage automatique Adobe (l\'analyse tourne dans Premiere)' : '') + '</div>' +
        (r.autoFailed ? '<div class="warn">⚠ Recadrage automatique indisponible sur ' + r.autoFailed + ' clip(s) : cadrage fixe appliqué à la place.</div>' : '') +
        (r.propFailed ? '<div class="err">✖ ' + r.propFailed + ' clip(s) : Échelle / Position non réglables.</div>' : '') +
        (noDims ? '<div class="warn">⚠ ' + noDims + ' clip(s) sans dimensions connues, ignoré(s).</div>' : '') +
        (r.missing ? '<div class="warn">⚠ ' + r.missing + ' clip(s) introuvable(s) : ré-analysez.</div>' : '');
      return r;
    }), 'Format adapté');
  }

  function renderShots() {
    var fs = FS(), box = H.$('fr-shots');
    box.innerHTML = '';
    fs.groups.forEach(function (g) {
      var f = F.get(g.id), k = g.id, ps = fs.perRush[k] || {};
      var cv = H.el('canvas');
      var card = H.el('div', { class: 'gshot frshot' + (fs.selected === k ? ' on' : ''), onclick: function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        fs.selected = fs.selected === k ? null : k; renderShots();
        B.call('OneSec_setPlayhead', { time: g.starts[0] + 0.1 }).catch(function () {});
      } });
      var fr = framingFor(g);
      var cap = !f || f.error ? 'pas d\'image' + (f && f.error ? ' : ' + f.error : '') : fr ? (g.media.width + '×' + g.media.height + ' → ' + fr.scale + ' %') : 'dimensions inconnues';
      card.appendChild(cv);
      card.appendChild(H.el('div', { class: 'cap' }, [H.el('b', { text: g.name, title: g.name }), H.el('span', { text: g.starts.length + ' plan' + (g.starts.length > 1 ? 's' : '') + ' · ' + cap, title: cap })]));
      function slider(label, prop) {
        return H.el('label', {}, [H.el('span', { text: label }), H.el('input', { type: 'range', min: -1, max: 1, step: 0.05, value: ps[prop] || 0, oninput: function (e) {
          fs.perRush[k] = Object.assign(fs.perRush[k] || {}, {}); fs.perRush[k][prop] = +e.target.value; draw(cv, g); H.save();
        } })]);
      }
      card.appendChild(H.el('div', { class: 'tweak' }, [slider('Gauche ↔ droite', 'x'), slider('Haut ↔ bas', 'y'),
        H.el('button', { class: 'small ghost', text: 'Recentrer sur le sujet', onclick: function () { delete fs.perRush[k]; renderShots(); H.save(); } })]));
      box.appendChild(card);
      draw(cv, g);
    });
  }

  /** Miniature avec la zone utile du média et le cadre visible après cadrage. */
  function draw(cv, g) {
    var f = F.get(g.id), fs = FS();
    var w = 150, h = 84;
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    if (!f || !f.small) return;
    var b = f.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var tmp = document.createElement('canvas'); tmp.width = f.small.width; tmp.height = f.small.height;
    tmp.getContext('2d').putImageData(f.small, 0, 0);
    var sc = Math.min(w / bw, h / bh), dw = bw * sc, dh = bh * sc, ox = (w - dw) / 2, oy = (h - dh) / 2;
    g.drawImage(tmp, b.x0, b.y0, bw, bh, ox, oy, dw, dh);
    var fr = framingFor(g);
    if (fr && fs.mode !== 'auto') {
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(ox, oy, fr.crop.x0 * dw, dh);
      g.fillRect(ox + fr.crop.x1 * dw, oy, (1 - fr.crop.x1) * dw, dh);
      g.fillRect(ox + fr.crop.x0 * dw, oy, (fr.crop.x1 - fr.crop.x0) * dw, fr.crop.y0 * dh);
      g.fillRect(ox + fr.crop.x0 * dw, oy + fr.crop.y1 * dh, (fr.crop.x1 - fr.crop.x0) * dw, (1 - fr.crop.y1) * dh);
      g.strokeStyle = '#4aa3ff'; g.lineWidth = 1.5;
      g.strokeRect(ox + fr.crop.x0 * dw + 0.5, oy + fr.crop.y0 * dh + 0.5, (fr.crop.x1 - fr.crop.x0) * dw - 1, (fr.crop.y1 - fr.crop.y0) * dh - 1);
    }
    if (f.subject && fs.mode === 'subject') {
      g.fillStyle = '#ffcc33'; g.beginPath(); g.arc(ox + f.subject.x * dw, oy + f.subject.y * dh, 3, 0, Math.PI * 2); g.fill();
    }
  }

  function render() {
    if (!H) return;
    var fs = FS(), s = S();
    H.$('fr-mode').value = fs.mode;
    var sel = H.$('fr-track'); sel.innerHTML = '';
    ((s.music && s.music.videoTracks) || [{ index: 0 }, { index: 1 }, { index: 2 }]).forEach(function (t) { sel.appendChild(H.el('option', { value: t.index, text: 'V' + (t.index + 1) })); });
    sel.value = track();
    H.$('fr-range-only').checked = fs.rangeOnly; H.$('fr-range-only').disabled = !s.music;
    H.$('fr-seq').textContent = fs.seq && fs.seq.width ? fs.seq.width + '×' + fs.seq.height + (fs.seq.height > fs.seq.width ? ' (vertical)' : ' (horizontal)') : 'analysez les plans';
    H.$('btn-fr-apply').disabled = !fs.groups.length;
    renderShots();
  }

  function bind() {
    H.$('fr-mode').addEventListener('change', function (e) { FS().mode = e.target.value; render(); H.save(); });
    H.$('fr-track').addEventListener('change', function (e) { FS().track = +e.target.value; FS().groups = []; render(); H.save(); });
    H.$('fr-range-only').addEventListener('change', function (e) { FS().rangeOnly = e.target.checked; H.save(); });
    H.$('btn-fr-analyze').addEventListener('click', analyze);
    H.$('btn-fr-apply').addEventListener('click', function () {
      if (!FS().groups.length) analyze().then(apply); else apply();
    });
    H.$('btn-fr-reset').addEventListener('click', function () {
      H.run(B.call('OneSec_resetFraming', { videoTrack: track(), range: range() }), function (r) { return r.reset + ' clip(s) remis à 100 % centré.'; });
    });
  }

  root.OneSecFramingUI = { init: function (h) { H = h; bind(); }, render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
