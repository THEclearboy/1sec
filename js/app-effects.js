/*
 * 1SEC — Étape 6 : effets (interface)
 */
(function (root) {
  'use strict';
  var E = root.OneSecEffects, B = root.OneSecBridge;
  var H = null, last = null;

  function S() { return H.state(); }
  function ES() {
    var s = S();
    if (!s.effects) s.effects = { opts: Object.assign({}, E.DEFAULTS), keyTimeMode: 'source', applied: false };
    if (!s.effects.opts) s.effects.opts = Object.assign({}, E.DEFAULTS);
    return s.effects;
  }
  var CTRL = [
    ['fx-density', 'density'], ['fx-punch', 'punch'], ['fx-punch-amt', 'punchAmount'], ['fx-shake', 'shake'], ['fx-shake-amt', 'shakeAmount'],
    ['fx-kenburns', 'kenburns'], ['fx-kb-amt', 'kenburnsAmount'], ['fx-flash', 'flash'], ['fx-flash-len', 'flashFrames'],
    ['fx-dissolve', 'dissolve'], ['fx-dissolve-len', 'dissolveFrames'], ['fx-fade', 'fadeInOut'], ['fx-pulse', 'pulse'], ['fx-pulse-amt', 'pulseAmount']
  ];

  function compute() {
    var s = S(), plan = H.plan();
    if (!plan || !plan.shots.length || !s.analysis) return null;
    var fps = (s.music && s.music.fps) || 25;
    return E.planEffects(plan, s.analysis, fps, ES().opts);
  }

  function render() {
    if (!H) return;
    var es = ES(), s = S();
    CTRL.forEach(function (c) {
      var el = H.$(c[0]); if (!el) return;
      if (el.type === 'checkbox') el.checked = !!es.opts[c[1]]; else el.value = es.opts[c[1]];
    });
    H.$('fx-keymode').value = es.keyTimeMode || 'source';
    last = compute();
    var sum = H.$('fx-summary');
    if (!last) { sum.innerHTML = '<span class="warn">Il faut une musique analysée (étape 1) et un montage (étapes 3-4).</span>'; H.$('btn-fx-apply').disabled = true; return; }
    var keys = Object.keys(last.summary);
    sum.innerHTML = '<div class="stats"><div><span>Effets</span><b class="big">' + last.ops.length + '</b></div>' +
      '<div><span>Plans</span><b class="big">' + H.plan().shots.length + '</b></div></div>' +
      '<div class="fx-tl">' + keys.map(function (k) { return '<span class="fx-tag">' + last.summary[k] + ' × ' + (E.LABELS[k] || k) + '</span>'; }).join('') + '</div>' +
      (!s.lastBuild ? '<div class="warn" style="margin-top:6px">⚠ Construisez d\'abord le montage (étape 4) : les effets se posent sur ses plans.</div>' : '');
    H.$('btn-fx-apply').disabled = !last.ops.length;
  }

  function apply() {
    var s = S(), es = ES();
    if (!last || !last.ops.length) return;
    var track = s.lastBuild ? s.lastBuild.videoTrack : Number(s.build.videoTrack || 0);
    H.busy(true, 'Application de ' + last.ops.length + ' effets…');
    H.run(B.call('OneSec_applyEffects', { videoTrack: track, ops: last.ops, keyTimeMode: es.keyTimeMode }).then(function (r) {
      H.busy(false);
      es.applied = true; H.save();
      var failed = Object.keys(r.failed || {});
      var rep = H.$('fx-report');
      rep.classList.remove('hidden');
      rep.innerHTML = '<div class="ok">✔ ' + r.motion + ' animation(s), ' + r.transitions + ' transition(s)' + (r.pulse ? ', ' + r.pulse + ' pulsation(s)' : '') + '</div>' +
        (r.missing ? '<div class="warn">⚠ ' + r.missing + ' plan(s) introuvable(s) sur la piste : reconstruisez le montage puis ré-appliquez.</div>' : '') +
        (r.transitionMissing && r.transitionMissing.length ? '<div class="warn">⚠ Transitions introuvables dans Premiere : ' + r.transitionMissing.join(', ') + ' (nom localisé ? dites-moi la langue de Premiere).</div>' : '') +
        (failed.length ? '<div class="warn">⚠ Échecs : ' + failed.map(function (k) { return H.esc(k) + ' ×' + r.failed[k]; }).join(', ') + '</div>' : '') +
        '<div class="muted">Vérifiez un punch-in dans Premiere : s\'il tombe au mauvais endroit, changez « Temps des images clés » (réglages avancés) et ré-appliquez.</div>';
      render();
      return r;
    }), 'Effets appliqués');
  }

  function bind() {
    CTRL.forEach(function (c) {
      var el = H.$(c[0]); if (!el) return;
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function (e) {
        ES().opts[c[1]] = el.type === 'checkbox' ? e.target.checked : +e.target.value;
        ES().applied = false; render(); H.save();
      });
    });
    H.$('fx-keymode').addEventListener('change', function (e) { ES().keyTimeMode = e.target.value; H.save(); });
    H.$('btn-fx-apply').addEventListener('click', apply);
    H.$('btn-fx-clear').addEventListener('click', function () {
      var s = S(), track = s.lastBuild ? s.lastBuild.videoTrack : Number(s.build.videoTrack || 0);
      var range = s.music ? { start: s.music.start, end: s.music.end } : null;
      H.run(B.call('OneSec_clearEffects', { videoTrack: track, range: range }).then(function (r) { ES().applied = false; render(); H.save(); return r; }),
        function (r) { return r.cleared + ' clip(s) nettoyé(s). ' + (r.note || ''); });
    });
  }

  root.OneSecEffectsUI = { init: function (h) { H = h; bind(); }, render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
