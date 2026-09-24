/*
 * 1SEC — Étape 7 : textes dynamiques (interface)
 */
(function (root) {
  'use strict';
  var T = root.OneSecText, R = root.OneSecTextRender, B = root.OneSecBridge, Boot = root.OneSecBoot;
  var H = null, cards = [];

  function S() { return H.state(); }
  function TS() {
    var s = S();
    if (!s.text) s.text = { hook: false, hookText: '', hookSec: 3, phrases: '', where: 'intro', mode: 'dynamic', wpb: 'auto', hold: 2, variety: 0.7, spread: 0.8, seed: 7,
      style: 'impact', font: '', size: 0.085, emph: 1.5, y: 0.5, track: null, applied: false };
    return s.text;
  }
  function seqSize() { var s = S(), f = root.OneSecFrames && root.OneSecFrames.seqInfo(); if (f && f.width) return f; var v = s.music && s.music.videoTracks; return { width: 1080, height: 1920 }; }
  function trackIndex() { var ts = TS(), s = S(); if (ts.track != null) return Number(ts.track); var b = s.lastBuild ? s.lastBuild.videoTrack : Number(s.build.videoTrack || 0); return b + 1; }

  function compute() {
    var s = S(), ts = TS();
    cards = [];
    if (!s.analysis) return;
    var an = s.analysis, range = H.musicRange(), off = H.timelineOffset();
    var drop = an.sections.filter(function (x) { return x.drop; })[0];
    var from = range.start, to = range.end;
    if (ts.where === 'intro') to = drop ? drop.start : Math.min(range.end, range.start + 15);
    if (ts.where === 'drop') from = drop ? drop.start : range.start;
    var opts = { mode: ts.mode, wordsPerBeat: ts.wpb === 'auto' ? 'auto' : +ts.wpb, hold: ts.hold, timelineOffset: off, variety: ts.variety, sizeSpread: ts.spread, seed: ts.seed };
    var planFn = function (ph, o) { return ts.mode === 'dynamic' ? T.planDynamic(ph, an, o) : T.planTexts(ph, an, o); };
    if (ts.hook && ts.hookText.trim()) {
      var hw = T.hookWindow(an, ts.hookSec);
      cards = cards.concat(planFn([ts.hookText], Object.assign({}, opts, { from: range.start + hw.start, to: range.start + hw.end, hold: 3, wordsPerBeat: 'auto' })).map(function (c) { c.hook = true; return c; }));
      if (from < range.start + hw.end) from = range.start + hw.end + 60 / an.bpm;
    }
    var phrases = ts.phrases.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (phrases.length && to > from) cards = cards.concat(planFn(phrases, Object.assign({}, opts, { from: from, to: to })));
  }

  function styleOf() { var ts = TS(); return { preset: ts.style, fontFamily: ts.font || null, size: ts.size, emphasisScale: ts.emph, y: ts.y }; }

  var previewIdx = 0;
  function renderPreview() {
    var cv = H.$('tx-preview'), sz = seqSize();
    if (cards.length) { previewIdx = previewIdx % cards.length; var c0 = cards[previewIdx]; var pw0 = 270, ph0 = Math.round(pw0 * sz.height / sz.width); var k0 = R.renderCard(c0, styleOf(), pw0, ph0); cv.width = pw0; cv.height = ph0; cv.getContext('2d').drawImage(k0, 0, 0); H.$('tx-preview-cap').textContent = 'aperçu ' + (previewIdx + 1) + '/' + cards.length + ' · ' + H.fmt(c0.start) + ' — cliquez pour le suivant'; return; }
    H.$('tx-preview-cap').textContent = 'aperçu';
    var sample = cards.filter(function (c) { return c.lines.length > 1 || (c.words && c.words.length > 1); })[0] || cards[0] || { lines: [{ text: 'Regarde' }, { text: 'jusqu\'à' }, { text: 'la fin.', emphasis: true }] };
    var pw = 270, ph = Math.round(pw * sz.height / sz.width);
    var card = R.renderCard(sample, styleOf(), pw, ph);
    cv.width = pw; cv.height = ph;
    cv.getContext('2d').drawImage(card, 0, 0);
  }

  function render() {
    if (!H) return;
    var ts = TS(), s = S();
    H.$('tx-hook').checked = ts.hook; H.$('tx-hook-row').classList.toggle('hidden', !ts.hook);
    H.$('tx-hook-text').value = ts.hookText; H.$('tx-hook-sec').value = ts.hookSec; H.$('tx-hook-sec-v').textContent = ts.hookSec + ' s';
    H.$('tx-phrases').value = ts.phrases; H.$('tx-where').value = ts.where; H.$('tx-mode').value = ts.mode; H.$('tx-wpb').value = ts.wpb;
    H.$('tx-hold').value = ts.hold; H.$('tx-hold-v').textContent = ts.hold + ' temps';
    H.$('tx-variety').value = ts.variety; H.$('tx-spread').value = ts.spread;
    H.$('tx-dyn-row').classList.toggle('hidden', ts.mode !== 'dynamic'); H.$('tx-wpb').disabled = ts.mode === 'dynamic';
    var st = H.$('tx-style');
    if (!st.options.length) Object.keys(R.STYLES).forEach(function (k) { st.appendChild(H.el('option', { value: k, text: R.STYLES[k].label })); });
    st.value = ts.style; H.$('tx-font').value = ts.font; H.$('tx-size').value = ts.size; H.$('tx-emph').value = ts.emph; H.$('tx-y').value = ts.y;
    var tr = H.$('tx-track'); tr.innerHTML = '';
    var n = Math.max(((s.music && s.music.videoTracks) || []).length + 1, trackIndex() + 1, 3);
    for (var i = 0; i < n; i++) tr.appendChild(H.el('option', { value: i, text: 'V' + (i + 1) + (i >= ((s.music && s.music.videoTracks) || []).length ? ' (nouvelle)' : '') }));
    tr.value = trackIndex();
    compute();
    var sum = H.$('tx-summary');
    if (!s.analysis) sum.innerHTML = '<span class="warn">Analysez d\'abord la musique (étape 1).</span>';
    else if (!cards.length) sum.innerHTML = '<span class="muted">Écrivez une accroche ou des phrases pour voir le plan des textes.</span>';
    else {
      var words = cards.filter(function (c) { return !c.hook; }).length, hk = cards.filter(function (c) { return c.hook; }).length;
      var first = cards[0], last = cards[cards.length - 1];
      sum.innerHTML = '<div class="stats"><div><span>Textes</span><b class="big">' + cards.length + '</b></div>' +
        (hk ? '<div><span>Hook</span><b class="big">' + hk + '</b></div>' : '') +
        '<div><span>De</span><b class="big">' + H.fmt(first.start) + '</b></div><div><span>À</span><b class="big">' + H.fmt(last.end) + '</b></div></div>' +
        '<div class="muted" style="margin-top:4px">Sur V' + (trackIndex() + 1) + ' · ' + seqSize().width + '×' + seqSize().height + '</div>';
    }
    H.$('btn-tx-apply').disabled = !cards.length;
    renderPreview();
  }

  function writePng(dir, name, b64) {
    var fs = Boot.nodeRequire('fs'), path = Boot.nodeRequire('path');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    var full = path.join(dir, name);
    fs.writeFileSync(full, Buffer.from(b64, 'base64'));
    return full;
  }

  function apply() {
    var ts = TS(), s = S();
    if (!cards.length) return;
    if (B.isCEP && !Boot.nodeRequire) return H.toast('Node.js désactivé dans le panneau : impossible d\'écrire les images.', 'err');
    var sz = seqSize(), fps = (s.music && s.music.fps) || 25;
    var dir = (B.tempDir().replace(/frames$/, '') + 'texts');
    H.busy(true, 'Rendu de ' + cards.length + ' textes…');
    var items = [], stamp = Date.now();
    var work = cards.reduce(function (p, c, i) {
      return p.then(function () {
        var cv = R.renderCard(c, styleOf(), sz.width, sz.height);
        var b64 = R.toPngBase64(cv);
        var name = '1sec_text_' + stamp + '_' + String(i).padStart(3, '0') + '.png';
        var file = B.isCEP ? writePng(dir, name, b64) : name;
        items.push({ file: file, start: Math.round(c.timelineStart * fps) / fps, end: Math.round(c.timelineEnd * fps) / fps, pop: !!c.pop, popStrength: c.popStrength || 1 });
      });
    }, Promise.resolve());
    H.run(work.then(function () {
      H.busy(true, 'Import dans Premiere…');
      return B.call('OneSec_placeTexts', { videoTrack: trackIndex(), items: items, popFrames: 3, keyTimeMode: (s.effects && s.effects.keyTimeMode) || 'source' });
    }).then(function (r) {
      H.busy(false);
      ts.applied = true; H.save();
      var rep = H.$('tx-report'); rep.classList.remove('hidden');
      rep.innerHTML = '<div class="ok">✔ ' + r.placed + ' texte(s) posé(s) sur V' + (trackIndex() + 1) + '</div>' +
        (r.missing ? '<div class="err">✖ ' + r.missing + ' texte(s) non importé(s).</div>' : '') +
        (r.popFailed ? '<div class="warn">⚠ Pop-in non appliqué sur ' + r.popFailed + ' texte(s).</div>' : '') +
        ((r.errors || []).length ? '<pre class="log">' + r.errors.map(H.esc).join('\n') + '</pre>' : '') +
        '<div class="muted">Les images sont dans le chutier « 1SEC Textes ». Pour changer un mot : modifiez la phrase ici et re-placez (les anciens textes sont retirés).</div>';
      render();
      return r;
    }), 'Textes placés');
  }

  function clearTexts(silent) {
    var s = S();
    var range = s.music ? { start: s.music.start, end: s.music.end } : null;
    return B.call('OneSec_clearTexts', { videoTrack: null, range: range }).then(function (r) { if (!silent) H.toast(r.removed + ' texte(s) retiré(s).', 'ok'); return r; });
  }

  function bind() {
    function on(id, evt, fn) { H.$(id).addEventListener(evt, function (e) { fn(e.target, TS()); TS().applied = false; render(); H.save(); }); }
    on('tx-hook', 'change', function (t, ts) { ts.hook = t.checked; H.replan(); });
    on('tx-hook-text', 'input', function (t, ts) { ts.hookText = t.value; });
    on('tx-hook-sec', 'input', function (t, ts) { ts.hookSec = +t.value; H.replan(); });
    on('tx-phrases', 'input', function (t, ts) { ts.phrases = t.value; });
    on('tx-where', 'change', function (t, ts) { ts.where = t.value; });
    on('tx-mode', 'change', function (t, ts) { ts.mode = t.value; });
    on('tx-wpb', 'change', function (t, ts) { ts.wpb = t.value; });
    on('tx-hold', 'input', function (t, ts) { ts.hold = +t.value; });
    on('tx-variety', 'input', function (t, ts) { ts.variety = +t.value; });
    on('tx-spread', 'input', function (t, ts) { ts.spread = +t.value; });
    on('btn-tx-seed', 'click', function (t, ts) { ts.seed = (ts.seed * 7919 + 13) % 100003; });
    on('tx-style', 'change', function (t, ts) { ts.style = t.value; });
    on('tx-font', 'change', function (t, ts) { ts.font = t.value.trim(); });
    on('tx-size', 'input', function (t, ts) { ts.size = +t.value; });
    on('tx-emph', 'input', function (t, ts) { ts.emph = +t.value; });
    on('tx-y', 'input', function (t, ts) { ts.y = +t.value; });
    on('tx-track', 'change', function (t, ts) { ts.track = +t.value; });
    H.$('tx-preview').addEventListener('click', function () { previewIdx++; renderPreview(); });
    H.$('btn-tx-apply').addEventListener('click', function () { clearTexts(true).catch(function () {}).then(apply); });
    H.$('btn-tx-clear').addEventListener('click', function () { H.run(clearTexts(false)).then(function () { TS().applied = false; render(); H.save(); }); });
  }

  root.OneSecTextUI = { init: function (h) { H = h; bind(); }, render: render, cards: function () { return cards; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
