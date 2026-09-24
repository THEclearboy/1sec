/*
 * 1SEC — Interface du panneau (étapes 1 → 4)
 */
(function (root) {
  'use strict';

  var A = root.OneSecAnalysis, P = root.OneSecPlanner, B = root.OneSecBridge, Boot = root.OneSecBoot;
  var STORE_KEY = 'onesec.state.v1';

  var SECTION_COLORS = {
    intro: '#3fb0c0', calme: '#3a6fd8', moyen: '#3fb96b', montee: '#e5c33a',
    intense: '#e5813a', drop: '#e5534b', pause: '#5a6f9a', outro: '#3fb0c0'
  };

  function defaults() {
    return {
      step: 1,
      music: null,
      analysis: null,
      sensitivity: 0.6,
      markerOpts: { sections: true, hits: true, bars: false, beats: false },
      rushSource: 'selection', binId: null,
      momentLen: 3,
      clips: [],
      momentState: {},
      sectionSettings: {},
      options: { seed: 1, variation: 0.5, dropImpact: 'ralenti', order: 'mix', accelerateBuilds: true, cutOnHits: true, tailFrames: 2 },
      overrides: {},
      build: { videoTrack: null, clearTrack: true, muteRushAudio: true },
      lastBuild: null,
      selectedSection: null
    };
  }

  var S = defaults();
  var planResult = null;
  var saveTimer = null;

  // ------------------------------------------------------------ utilitaires

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function fmt(t) {
    if (t == null || isNaN(t)) return '–';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast hidden'; }, kind === 'err' ? 6000 : 3000);
  }
  function busy(on, text) {
    $('busy').className = on ? 'busy' : 'busy hidden';
    if (text) $('busy-text').textContent = text;
  }
  function run(promise, okMsg) {
    return promise.then(function (r) { if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); return r; })
      .catch(function (e) { busy(false); toast(e.message || String(e), 'err'); throw e; });
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { console.warn('[1SEC] sauvegarde impossible', e); }
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 300); }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw), d = defaults();
      Object.keys(d).forEach(function (k) { if (s[k] !== undefined) S[k] = s[k]; });
      S.options = Object.assign(d.options, s.options || {});
      S.build = Object.assign(d.build, s.build || {});
      S.markerOpts = Object.assign(d.markerOpts, s.markerOpts || {});
    } catch (e) { S = defaults(); }
  }

  // ------------------------------------------------------------ données dérivées

  function musicRange() {
    if (!S.music || !S.analysis) return null;
    var start = Math.max(0, S.music.inPoint || 0);
    var end = Math.min(S.analysis.duration, S.music.outPoint || S.analysis.duration);
    if (end - start < 1) { start = 0; end = S.analysis.duration; }
    return { start: start, end: end };
  }
  function timelineOffset() { return S.music ? S.music.start - (S.music.inPoint || 0) : 0; }

  function moments() {
    var ms = P.momentsFromClips(S.clips, { defaultLength: S.momentLen });
    ms.forEach(function (m) {
      var st = S.momentState[m.id];
      if (st) { if (st.enabled != null) m.enabled = st.enabled; if (st.rating != null) m.rating = st.rating; }
    });
    return ms;
  }

  function replan() {
    if (!S.analysis) { planResult = null; return; }
    var fps = (S.music && S.music.fps) || 25;
    planResult = P.plan({
      analysis: S.analysis,
      range: musicRange(),
      timelineOffset: timelineOffset(),
      fps: fps,
      sectionSettings: S.sectionSettings,
      moments: moments(),
      overrides: S.overrides,
      options: Object.assign({}, S.options, { tail: S.options.tailFrames / fps })
    });
  }

  // ------------------------------------------------------------ navigation

  function goto(step) {
    S.step = step;
    document.querySelectorAll('#steps button').forEach(function (b) {
      var n = +b.getAttribute('data-step');
      b.classList.toggle('active', n === step);
      b.classList.toggle('done', isDone(n) && n !== step);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', +p.getAttribute('data-panel') === step);
    });
    renderAll();
    saveSoon();
  }
  function isDone(n) {
    if (n === 1) return !!S.analysis;
    if (n === 2) return S.clips.length > 0;
    if (n === 3) return !!(planResult && planResult.shots.length && S.clips.length);
    if (n === 4) return !!S.lastBuild;
    return false;
  }

  // ------------------------------------------------------------ ÉTAPE 1

  function analyzeMusic() {
    var info;
    busy(true, 'Lecture de la musique…');
    return run(B.call('OneSec_getMusicInfo').then(function (i) {
      info = i;
      if (info.speed && Math.abs(info.speed - 1) > 0.01) toast('Attention : la musique a une vitesse de ' + Math.round(info.speed * 100) + '%. L\'analyse suppose 100%.', 'err');
      return B.decodeAudio(info.path);
    }).then(function (audio) {
      busy(true, 'Analyse du rythme…');
      return new Promise(function (resolve) {
        setTimeout(function () {
          var t0 = Date.now();
          var an = A.analyze(audio.channels, audio.sampleRate, { sensitivity: S.sensitivity });
          an.analysisMs = Date.now() - t0;
          resolve(an);
        }, 30);
      });
    }).then(function (an) {
      var sameMusic = S.music && S.music.path === info.path && S.music.nodeId === info.nodeId;
      if (typeof info.path !== 'string') info.path = info.name; // démo
      S.music = info;
      S.analysis = an;
      if (!sameMusic) { S.sectionSettings = {}; S.overrides = {}; S.selectedSection = null; }
      S.build.videoTrack = pickVideoTrack(info);
      busy(false);
      replan();
      renderAll();
      saveSoon();
      return an;
    }), function (an) { return 'Analyse terminée : ' + an.bpm + ' BPM, ' + an.sections.length + ' sections' + (info && info.guessed ? ' (clip audio non sélectionné : premier clip utilisé)' : ''); });
  }

  function pickVideoTrack(info) {
    var tracks = info.videoTracks || [];
    for (var i = 0; i < tracks.length; i++) if (!tracks[i].clipsInRange && tracks[i].index !== info.trackIndex) return tracks[i].index;
    for (i = 0; i < tracks.length; i++) if (tracks[i].index !== info.trackIndex) return tracks[i].index;
    return 0;
  }

  function afterAnalysisChange() {
    S.overrides = {}; // les plans verrouillés dépendent de la grille
    replan(); renderAll(); saveSoon();
  }

  function renderMusic() {
    var an = S.analysis;
    $('music-result').classList.toggle('hidden', !an);
    if (!an) return;
    $('m-name').textContent = (S.music && S.music.name) + (S.music ? ' · ' + fmt(S.music.end - S.music.start) : '');
    $('m-bpm').textContent = an.bpm + ' BPM';
    $('m-phase').textContent = 'temps ' + (an.downbeatPhase + 1) + ' / 4';
    $('sensitivity').value = S.sensitivity;
    ['sections', 'hits', 'bars', 'beats'].forEach(function (k) { $('mk-' + k).checked = !!S.markerOpts[k]; });
  }

  function placeMarkers() {
    if (!S.analysis) return;
    var list = P.musicMarkers(S.analysis, musicRange(), timelineOffset(), S.markerOpts);
    if (list.length > 600 && !confirm(list.length + ' marqueurs vont être posés. Continuer ?')) return;
    busy(true, 'Pose des marqueurs…');
    run(B.call('OneSec_clearMarkers').then(function () {
      return B.call('OneSec_addMarkers', { markers: list });
    }).then(function (r) { busy(false); return r; }), function (r) { return r.added + ' marqueurs posés (les anciens marqueurs 1SEC ont été remplacés).'; });
  }

  // ------------------------------------------------------------ ÉTAPE 2

  function loadBins() {
    return B.call('OneSec_getBins').then(function (bins) {
      var sel = $('rush-bin');
      sel.innerHTML = '';
      bins.forEach(function (b) { sel.appendChild(el('option', { value: b.nodeId, text: b.path })); });
      if (S.binId) sel.value = S.binId;
      if (!sel.value && bins[0]) sel.value = bins[0].nodeId;
      S.binId = sel.value || null;
    }).catch(function () {});
  }

  function loadRushes() {
    busy(true, 'Lecture des rushes…');
    run(B.call('OneSec_getRushes', { mode: S.rushSource, binId: S.binId }).then(function (clips) {
      busy(false);
      S.clips = clips.filter(function (c) { return c.markers && c.markers.length; });
      var without = clips.length - S.clips.length;
      replan(); renderAll(); saveSoon();
      if (without) toast(without + ' rush(es) sans marqueur ignoré(s).');
      return clips;
    }), function () { return moments().length + ' moments trouvés dans ' + S.clips.length + ' rushes'; });
  }

  function renderRushes() {
    var ms = moments(), list = $('rush-list');
    $('moment-len').value = S.momentLen;
    $('moment-len-v').textContent = S.momentLen + ' s';
    document.querySelectorAll('input[name=rush-src]').forEach(function (r) { r.checked = r.value === S.rushSource; });
    var sum = $('rush-summary');
    sum.classList.toggle('hidden', !S.clips.length);
    var enabled = ms.filter(function (m) { return m.enabled; });
    var tops = enabled.filter(function (m) { return m.rating; }).length;
    sum.innerHTML = '<div class="stats"><div><span>Rushes</span><b class="big">' + S.clips.length + '</b></div>' +
      '<div><span>Moments</span><b class="big">' + enabled.length + '</b></div>' +
      '<div><span>Top ★</span><b class="big">' + tops + '</b></div></div>';
    list.innerHTML = '';
    S.clips.forEach(function (c) {
      var cms = ms.filter(function (m) { return m.clipId === c.nodeId; });
      var box = el('div', { class: 'moments' });
      cms.forEach(function (m) {
        var star = el('button', { class: 'star' + (m.rating ? ' on' : ''), title: 'Moment top (ira sur les drops)', text: m.rating ? '★' : '☆', onclick: function () { setMoment(m.id, { rating: m.rating ? 0 : 1 }); } });
        var tog = el('button', { title: m.enabled ? 'Ignorer ce moment' : 'Utiliser ce moment', text: m.enabled ? '✕' : '↺', onclick: function () { setMoment(m.id, { enabled: !m.enabled }); } });
        box.appendChild(el('span', { class: 'moment' + (m.enabled ? '' : ' off') + (m.rating ? ' top' : ''), title: 'Moment de ' + fmt(m.rangeStart) + ' à ' + fmt(m.peak) + (m.label ? ' — ' + m.label : '') },
          [fmt(m.peak) + (m.label ? ' ' + m.label : ''), star, tog]));
      });
      list.appendChild(el('div', { class: 'clip' }, [
        el('div', { class: 'head' }, [el('span', { text: c.name }), el('small', { text: cms.length + ' moment(s)' })]), box
      ]));
    });
  }

  function setMoment(id, patch) {
    S.momentState[id] = Object.assign(S.momentState[id] || {}, patch);
    replan(); renderAll(); saveSoon();
  }

  // ------------------------------------------------------------ ÉTAPE 3

  function renderOptions() {
    var o = S.options;
    $('variation').value = o.variation;
    $('drop-impact').value = o.dropImpact;
    $('order').value = o.order;
    $('accelerate').checked = o.accelerateBuilds;
    $('cut-hits').checked = o.cutOnHits;
    $('tail').value = o.tailFrames;
    $('tail-v').textContent = o.tailFrames + ' image' + (o.tailFrames > 1 ? 's' : '');
  }

  function renderSections() {
    var box = $('sections');
    box.innerHTML = '';
    if (!planResult) { box.appendChild(el('p', { class: 'help small', text: 'Analysez d\'abord la musique (étape 1).' })); return; }
    planResult.sections.forEach(function (s) {
      var set = S.sectionSettings[s.index] || {};
      var autoPace = P.resolveSection(S.analysis.sections[s.index], {}).pace;
      var autoSpeed = P.resolveSection(S.analysis.sections[s.index], {}).speed;
      var nShots = planResult.shots.filter(function (sh) { return sh.section === s.index; }).length;

      var seg = el('div', { class: 'seg' });
      seg.appendChild(el('button', { class: 'auto' + (!set.pace || set.pace === 'auto' ? ' on' : ''), text: 'Auto (' + P.PACES[autoPace].label + ')', onclick: function () { setSection(s.index, { pace: 'auto' }); } }));
      P.PACE_ORDER.forEach(function (p) {
        seg.appendChild(el('button', { class: set.pace === p ? 'on' : '', text: P.PACES[p].label, onclick: function () { setSection(s.index, { pace: p }); } }));
      });
      var speed = el('select', { onchange: function (e) { setSection(s.index, { speed: e.target.value }); } });
      speed.appendChild(el('option', { value: 'auto', text: 'Auto (' + Math.round(autoSpeed * 100) + '%)' }));
      P.SPEEDS.forEach(function (v) { speed.appendChild(el('option', { value: String(v), text: v === 1 ? '100% (normal)' : Math.round(v * 100) + '% (ralenti)' })); });
      speed.value = set.speed ? String(set.speed) : 'auto';

      var card = el('div', { class: 'sec' + (S.selectedSection === s.index ? ' selected' : ''), id: 'sec-' + s.index }, [
        el('div', { class: 'strip', style: 'background:' + (SECTION_COLORS[s.type] || '#888') }),
        el('div', { class: 'body' }, [
          el('div', { class: 'title', onclick: function () { selectSection(s.index, true); } }, [
            el('span', { html: '<b>' + (s.index + 1) + '. ' + esc(s.label) + '</b> <small>' + fmt(s.start) + ' → ' + fmt(s.end) + '</small>' }),
            el('small', { html: '<span class="energy"><i style="width:' + Math.round(s.energy * 100) + '%"></i></span> ' + nShots + ' plans' })
          ]),
          seg,
          el('div', { class: 'ctrls' }, [el('label', { text: 'Vitesse' }), speed])
        ])
      ]);
      box.appendChild(card);
    });
  }

  function setSection(i, patch) {
    S.sectionSettings[i] = Object.assign(S.sectionSettings[i] || {}, patch);
    S.selectedSection = i;
    replan(); renderAll(); saveSoon();
  }

  function selectSection(i, playhead) {
    S.selectedSection = i;
    renderSections(); drawTimeline();
    if (playhead && planResult) {
      var s = planResult.sections.filter(function (x) { return x.index === i; })[0];
      if (s) B.call('OneSec_setPlayhead', { time: s.start + timelineOffset() }).catch(function () {});
    }
  }

  function momentOptions() {
    return moments().filter(function (m) { return m.enabled; });
  }

  function renderShots() {
    var box = $('shots');
    box.innerHTML = '';
    if (!planResult) return;
    $('shots-count').textContent = '(' + planResult.shots.length + ')';
    if (!$('shots-box').open) return; // rendu à l'ouverture seulement
    var opts = momentOptions();
    planResult.shots.forEach(function (sh, i) {
      var ov = S.overrides[sh.key] || {};
      var rush = el('select', { title: 'Rush utilisé', onchange: function (e) { setShot(sh, { momentId: e.target.value }); } });
      opts.forEach(function (m) { rush.appendChild(el('option', { value: m.id, text: (m.rating ? '★ ' : '') + m.clipName + ' @' + fmt(m.peak) })); });
      rush.value = sh.momentId || '';
      var speed = el('select', { title: 'Vitesse', onchange: function (e) { setShot(sh, { speed: Number(e.target.value) }); } });
      var speeds = P.SPEEDS.slice();
      if (speeds.indexOf(sh.speed) < 0) speeds.push(sh.speed);
      speeds.forEach(function (v) { speed.appendChild(el('option', { value: String(v), text: Math.round(v * 100) + '%' })); });
      speed.value = String(sh.speed);
      var sec = planResult.sections.filter(function (x) { return x.index === sh.section; })[0];
      box.appendChild(el('div', { class: 'shot' + (ov.locked ? ' locked' : ''), style: 'border-left-color:' + (sec ? SECTION_COLORS[sec.type] : '#888') }, [
        el('span', { class: 'n', text: '#' + (i + 1) }),
        el('span', { text: fmt(sh.start), title: (sh.beats ? sh.beats + ' temps · ' : '') + (sh.end - sh.start).toFixed(2) + ' s' + (sh.warning ? ' · ' + sh.warning : '') }),
        rush, speed,
        el('button', { title: ov.locked ? 'Déverrouiller' : 'Verrouiller ce plan', text: ov.locked ? '🔒' : '🔓', onclick: function () { toggleLock(sh); } }),
        el('button', { title: 'Aller à ce plan dans la timeline', text: '▶', onclick: function () { B.call('OneSec_setPlayhead', { time: sh.timelineStart }).catch(function () {}); } })
      ]));
    });
  }

  function setShot(sh, patch) {
    var ov = Object.assign(S.overrides[sh.key] || {}, patch);
    if (ov.locked) { ov.momentId = patch.momentId || ov.momentId; ov.speed = patch.speed || ov.speed; }
    S.overrides[sh.key] = ov;
    replan(); renderAll(); saveSoon();
  }

  function toggleLock(sh) {
    var ov = S.overrides[sh.key] || {};
    if (ov.locked) delete S.overrides[sh.key];
    else S.overrides[sh.key] = { locked: true, start: sh.start, end: sh.end, momentId: sh.momentId, speed: sh.speed };
    replan(); renderAll(); saveSoon();
  }

  // ------------------------------------------------------------ ÉTAPE 4

  function renderBuild() {
    var sum = $('plan-summary');
    if (!planResult || !S.music) { sum.innerHTML = '<span class="warn">Terminez les étapes 1 à 3.</span>'; }
    else {
      var st = planResult.stats;
      sum.innerHTML = '<div class="stats">' +
        '<div><span>Plans</span><b class="big">' + st.shots + '</b></div>' +
        '<div><span>Ralentis</span><b class="big">' + st.slowMotion + '</b></div>' +
        '<div><span>Durée moy.</span><b class="big">' + st.avgShot.toFixed(2) + ' s</b></div>' +
        '<div><span>Tempo</span><b class="big">' + S.analysis.bpm + '</b></div></div>' +
        planResult.warnings.slice(0, 4).map(function (w) { return '<div class="warn">⚠ ' + esc(w) + '</div>'; }).join('');
    }
    var sel = $('video-track');
    sel.innerHTML = '';
    ((S.music && S.music.videoTracks) || []).forEach(function (t) {
      sel.appendChild(el('option', { value: t.index, text: 'V' + (t.index + 1) + (t.clipsInRange ? ' (' + t.clipsInRange + ' clip(s) sur la zone)' : ' (vide)') }));
    });
    if (S.build.videoTrack != null) sel.value = S.build.videoTrack;
    $('clear-track').checked = S.build.clearTrack;
    $('mute-rush').checked = S.build.muteRushAudio;
    $('btn-build').disabled = !(planResult && planResult.shots.length && S.clips.length);
    $('btn-clear-edit').disabled = !S.lastBuild;
  }

  function buildEdit() {
    if (!planResult || !planResult.shots.length) return;
    var shots = planResult.shots.filter(function (s) { return s.clipId; }).map(function (s) {
      return { clipId: s.clipId, timelineStart: s.timelineStart, timelineEnd: s.timelineEnd, sourceIn: s.sourceIn, sourceOut: s.sourceOut, speed: s.speed };
    });
    var m = S.music;
    var args = {
      videoTrack: Number(S.build.videoTrack || 0),
      clearTrack: S.build.clearTrack,
      muteRushAudio: S.build.muteRushAudio,
      range: { start: m.start, end: m.end },
      music: { nodeId: m.nodeId, trackIndex: m.trackIndex, start: m.start, end: m.end, inPoint: m.inPoint, outPoint: m.outPoint },
      shots: shots
    };
    busy(true, 'Montage de ' + shots.length + ' plans…');
    run(B.call('OneSec_buildEdit', args).then(function (r) {
      busy(false);
      S.lastBuild = { videoTrack: args.videoTrack, range: args.range, musicTrack: m.trackIndex, clipIds: Object.keys(shots.reduce(function (o, s) { o[s.clipId] = 1; return o; }, {})) };
      var rep = $('build-report');
      rep.classList.remove('hidden');
      rep.innerHTML = '<div class="ok">✔ ' + r.placed + ' plans posés sur V' + (args.videoTrack + 1) + '</div>' +
        (r.speedFailed ? '<div class="warn">⚠ ' + r.speedFailed + ' ralenti(s) non appliqué(s) : réglez-les à la main (Ctrl/Cmd+R).</div>' : '') +
        (r.missing ? '<div class="err">✖ ' + r.missing + ' rush(es) introuvable(s) dans le projet.</div>' : '') +
        (r.musicRestored ? '<div class="warn">La musique a été reposée à l\'identique.</div>' : '') +
        (r.errors || []).slice(0, 5).map(function (e) { return '<div class="err">' + esc(e) + '</div>'; }).join('');
      renderAll(); saveSoon();
      return r;
    }), 'Montage construit !');
  }

  function clearEdit() {
    if (!S.lastBuild) return;
    run(B.call('OneSec_clearEdit', S.lastBuild), function (r) { return r.removed + ' clip(s) retiré(s).'; });
  }

  // ------------------------------------------------------------ visualisation

  var viz = { x0: 0, x1: 1, w: 0, h: 0 };

  function drawTimeline() {
    var cv = $('timeline'), ctx = cv.getContext('2d');
    var dpr = root.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    viz.w = w; viz.h = h;
    var an = S.analysis, range = musicRange();
    if (!an || !range) {
      ctx.fillStyle = '#666'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Analysez une musique pour voir sa structure', w / 2, h / 2);
      $('viz-legend').innerHTML = '';
      return;
    }
    viz.x0 = range.start; viz.x1 = range.end;
    function X(t) { return (t - range.start) / (range.end - range.start) * w; }

    var secY = 0, secH = 14, wfY = 16, wfH = 58, shotY = 80, shotH = 22;
    // Sections
    var secs = planResult ? planResult.sections : an.sections;
    secs.forEach(function (s) {
      var x = X(s.start), x2 = X(s.end), col = SECTION_COLORS[s.type] || '#888';
      ctx.fillStyle = col; ctx.globalAlpha = 0.85;
      ctx.fillRect(x, secY, x2 - x - 1, secH);
      ctx.globalAlpha = 0.07; ctx.fillRect(x, wfY, x2 - x - 1, wfH);
      ctx.globalAlpha = 1;
      if (S.selectedSection === s.index) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, 0.5, x2 - x - 2, h - 1); }
      if (x2 - x > 36) { ctx.fillStyle = '#111'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(s.label, x + 3, secY + 11); }
    });
    // Forme d'onde
    var wf = an.waveform, mid = wfY + wfH / 2;
    ctx.fillStyle = '#5b5b5b';
    for (var px = 0; px < w; px++) {
      var t0 = range.start + px / w * (range.end - range.start), t1 = range.start + (px + 1) / w * (range.end - range.start);
      var i0 = Math.floor(t0 * wf.rate), i1 = Math.max(i0 + 1, Math.floor(t1 * wf.rate)), m = 0;
      for (var i = i0; i < i1 && i < wf.peaks.length; i++) m = Math.max(m, wf.peaks[i]);
      var hh = Math.min(1, m) * wfH / 2;
      ctx.fillRect(px, mid - hh, 1, hh * 2 || 1);
    }
    // Courbe d'énergie
    var ic = an.curves.intensity;
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (px = 0; px <= w; px += 2) {
      var e = A.curveAt(ic, range.start + px / w * (range.end - range.start));
      var y = wfY + wfH - e * (wfH - 4) - 2;
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    // Temps et mesures
    var pxPerBeat = w / ((range.end - range.start) / (60 / an.bpm));
    an.beats.forEach(function (t) {
      if (t < range.start || t > range.end) return;
      var isBar = an.downbeats.indexOf(t) >= 0;
      if (!isBar && pxPerBeat < 4) return;
      ctx.fillStyle = isBar ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.15)';
      ctx.fillRect(Math.round(X(t)), wfY + wfH - (isBar ? 10 : 5), 1, isBar ? 10 : 5);
    });
    // Moments forts
    ctx.fillStyle = '#c77dff';
    (an.hits || []).forEach(function (hit) {
      if (hit.time < range.start || hit.time > range.end) return;
      var x = X(hit.time);
      ctx.beginPath(); ctx.moveTo(x - 4, wfY); ctx.lineTo(x + 4, wfY); ctx.lineTo(x, wfY + 6); ctx.fill();
    });
    // Plans
    if (planResult) {
      planResult.shots.forEach(function (s, k) {
        var x = X(s.start), x2 = X(s.end);
        var slow = s.speed < 0.99;
        ctx.fillStyle = s.tag === 'hero' ? '#e5534b' : slow ? (k % 2 ? '#3a6fd8' : '#2f5cb5') : (k % 2 ? '#7d7d7d' : '#9a9a9a');
        ctx.fillRect(x, shotY, Math.max(1, x2 - x - 1), shotH);
        if (slow && x2 - x > 6) {
          ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
          for (var hx = x - shotH; hx < x2; hx += 5) { ctx.beginPath(); ctx.moveTo(Math.max(x, hx), shotY + shotH - Math.max(0, x - hx)); ctx.lineTo(Math.min(x2 - 1, hx + shotH), shotY + Math.max(0, hx + shotH - x2 + 1)); ctx.stroke(); }
        }
        var ov = S.overrides[s.key];
        if (ov && ov.locked) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, shotY + 0.5, x2 - x - 2, shotH - 1); }
        if (!s.clipId) { ctx.fillStyle = 'rgba(229,83,75,.6)'; ctx.fillRect(x, shotY, x2 - x - 1, 3); }
      });
    }
    $('viz-legend').innerHTML =
      '<span><i style="background:#ffb347"></i>énergie</span><span><i style="background:#c77dff"></i>moment fort</span>' +
      '<span><i style="background:#9a9a9a"></i>plan</span><span><i style="background:#3a6fd8"></i>ralenti</span><span><i style="background:#e5534b"></i>héros</span>';
  }

  function timeAtX(px) { return viz.x0 + px / viz.w * (viz.x1 - viz.x0); }

  function bindTimeline() {
    var cv = $('timeline'), tip = $('tooltip');
    cv.addEventListener('mousemove', function (e) {
      if (!S.analysis) return;
      var r = cv.getBoundingClientRect(), t = timeAtX(e.clientX - r.left);
      var sec = (planResult ? planResult.sections : S.analysis.sections).filter(function (s) { return t >= s.start && t < s.end; })[0];
      var shot = planResult && planResult.shots.filter(function (s) { return t >= s.start && t < s.end; })[0];
      var html = '<b>' + fmt(t) + '</b>' + (sec ? ' · ' + esc(sec.label) : '');
      if (shot && e.clientY - r.top > 76) html += '<br>' + esc(shot.clipName || '—') + ' · ' + (shot.end - shot.start).toFixed(2) + ' s · ' + Math.round(shot.speed * 100) + '%';
      tip.innerHTML = html;
      tip.classList.remove('hidden');
      var x = Math.min(e.clientX - r.left + 10, r.width - tip.offsetWidth - 4);
      tip.style.left = x + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px';
    });
    cv.addEventListener('mouseleave', function () { tip.classList.add('hidden'); });
    cv.addEventListener('click', function (e) {
      if (!S.analysis) return;
      var r = cv.getBoundingClientRect(), t = timeAtX(e.clientX - r.left);
      var sec = (planResult ? planResult.sections : S.analysis.sections).filter(function (s) { return t >= s.start && t < s.end; })[0];
      B.call('OneSec_setPlayhead', { time: t + timelineOffset() }).catch(function () {});
      if (sec) {
        if (S.step !== 3) goto(3);
        selectSection(sec.index, false);
        var card = $('sec-' + sec.index);
        if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    root.addEventListener('resize', drawTimeline);
  }

  // ------------------------------------------------------------ rendu global

  function renderAll() {
    renderMusic();
    renderRushes();
    renderOptions();
    renderSections();
    renderShots();
    renderBuild();
    drawTimeline();
    document.querySelectorAll('#steps button').forEach(function (b) {
      var n = +b.getAttribute('data-step');
      b.classList.toggle('done', isDone(n) && n !== S.step);
    });
  }

  // ------------------------------------------------------------ événements

  function bind() {
    document.querySelectorAll('#steps button').forEach(function (b) { b.addEventListener('click', function () { goto(+b.getAttribute('data-step')); }); });
    document.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { goto(+b.getAttribute('data-goto')); }); });

    // En-tête
    $('btn-reload').addEventListener('click', function () { Boot.reload(); });
    $('btn-menu').addEventListener('click', function () { $('menu').classList.toggle('hidden'); });
    $('opt-autoreload').checked = Boot.autoReloadEnabled();
    $('opt-autoreload').addEventListener('change', function (e) {
      var ok = Boot.setAutoReload(e.target.checked);
      if (e.target.checked && !ok) toast('Surveillance des fichiers indisponible ici.', 'err');
    });
    $('btn-update').addEventListener('click', function () {
      var log = $('update-log');
      log.classList.remove('hidden'); log.textContent = 'git pull…';
      Boot.update().then(function (r) {
        log.textContent = r.output || (r.ok ? 'OK' : 'Échec');
        if (r.ok && r.changed) { log.textContent += '\nRechargement…'; setTimeout(Boot.reload, 800); }
      });
    });
    $('btn-reset').addEventListener('click', function () {
      if (!confirm('Oublier l\'analyse, les rushes et tous les réglages ?')) return;
      S = defaults(); planResult = null; saveState(); goto(1);
    });

    // Étape 1
    $('btn-analyze').addEventListener('click', function () {
      if (!B.isCEP && !B.demo.musicFile) { $('demo-audio').click(); return; }
      analyzeMusic();
    });
    $('demo-audio').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      B.demo.musicFile = f;
      B.decodeAudio(f).then(function (a) { B.demo.musicDuration = a.duration; analyzeMusic(); }).catch(function (err) { toast(err.message, 'err'); });
    });
    $('btn-bpm-half').addEventListener('click', function () { A.scaleTempo(S.analysis, 0.5, S.sensitivity); afterAnalysisChange(); });
    $('btn-bpm-double').addEventListener('click', function () { A.scaleTempo(S.analysis, 2, S.sensitivity); afterAnalysisChange(); });
    $('btn-phase').addEventListener('click', function () {
      A.setDownbeatPhase(S.analysis, S.analysis.downbeatPhase + 1);
      A.resegment(S.analysis, S.sensitivity);
      afterAnalysisChange();
    });
    $('sensitivity').addEventListener('input', function (e) {
      S.sensitivity = +e.target.value;
      if (S.analysis) { A.resegment(S.analysis, S.sensitivity); S.sectionSettings = {}; afterAnalysisChange(); }
    });
    ['sections', 'hits', 'bars', 'beats'].forEach(function (k) {
      $('mk-' + k).addEventListener('change', function (e) { S.markerOpts[k] = e.target.checked; saveSoon(); });
    });
    $('btn-markers').addEventListener('click', placeMarkers);
    $('btn-clear-markers').addEventListener('click', function () {
      run(B.call('OneSec_clearMarkers'), function (r) { return r.removed + ' marqueur(s) 1SEC retiré(s).'; });
    });

    // Étape 2
    document.querySelectorAll('input[name=rush-src]').forEach(function (r) {
      r.addEventListener('change', function () { S.rushSource = r.value; saveSoon(); });
    });
    $('rush-bin').addEventListener('change', function (e) { S.binId = e.target.value; S.rushSource = 'bin'; renderRushes(); saveSoon(); });
    $('btn-bins').addEventListener('click', loadBins);
    $('moment-len').addEventListener('input', function (e) { S.momentLen = +e.target.value; replan(); renderAll(); saveSoon(); });
    $('btn-rushes').addEventListener('click', loadRushes);

    // Étape 3
    function opt(id, key, conv, evt) {
      $(id).addEventListener(evt || 'change', function (e) {
        S.options[key] = conv(e.target);
        replan(); renderAll(); saveSoon();
      });
    }
    opt('variation', 'variation', function (t) { return +t.value; }, 'input');
    opt('drop-impact', 'dropImpact', function (t) { return t.value; });
    opt('order', 'order', function (t) { return t.value; });
    opt('accelerate', 'accelerateBuilds', function (t) { return t.checked; });
    opt('cut-hits', 'cutOnHits', function (t) { return t.checked; });
    opt('tail', 'tailFrames', function (t) { return +t.value; }, 'input');
    $('btn-seed').addEventListener('click', function () {
      S.options.seed = (S.options.seed * 7919 + 13) % 100003;
      replan(); renderAll(); saveSoon();
    });
    $('shots-box').addEventListener('toggle', renderShots);

    // Étape 4
    $('video-track').addEventListener('change', function (e) { S.build.videoTrack = +e.target.value; saveSoon(); });
    $('clear-track').addEventListener('change', function (e) { S.build.clearTrack = e.target.checked; saveSoon(); });
    $('mute-rush').addEventListener('change', function (e) { S.build.muteRushAudio = e.target.checked; saveSoon(); });
    $('btn-build').addEventListener('click', buildEdit);
    $('btn-clear-edit').addEventListener('click', clearEdit);

    bindTimeline();
    root.addEventListener('beforeunload', saveState);
  }

  function checkConnection() {
    var st = $('status');
    if (!B.isCEP) {
      st.className = 'status demo'; st.textContent = 'Mode démo (navigateur)';
      $('demo-file').classList.remove('hidden');
      return;
    }
    B.call('OneSec_ping').then(function (r) {
      st.className = 'status ok';
      st.textContent = r.sequence || 'Aucune séquence';
      st.title = 'Premiere ' + r.app + ' · projet ' + r.project;
    }).catch(function (e) {
      st.className = 'status err'; st.textContent = 'Premiere non connecté'; st.title = e.message;
    });
  }

  function start() {
    loadState();
    bind();
    checkConnection();
    loadBins();
    replan();
    goto(S.step || 1);
  }

  root.OneSecApp = { start: start, saveState: saveState, state: function () { return S; }, plan: function () { return planResult; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
