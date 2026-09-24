/*
 * 1SEC — Pont panneau ↔ Premiere
 * En dehors de Premiere (navigateur), un mode démo simule la timeline pour
 * tester l'analyse et le planificateur.
 */
(function (root) {
  'use strict';
  var Boot = root.OneSecBoot || { isCEP: false };

  function call(fn, args) {
    if (!Boot.isCEP) return Demo.call(fn, args);
    var code = fn + '(' + (args === undefined ? '' : '"' + encodeURIComponent(JSON.stringify(args)) + '"') + ')';
    return Boot.evalScript(code).then(function (r) {
      var res;
      try { res = JSON.parse(r); } catch (e) {
        if (/EvalScript error/i.test(r)) throw new Error('Script Premiere non chargé. Cliquez sur ⟳ pour recharger le plugin.');
        throw new Error('Réponse inattendue de Premiere : ' + r);
      }
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
  }

  /** Décode un fichier audio (chemin disque dans Premiere, File en démo). */
  function decodeAudio(source) {
    var getBuffer;
    if (source instanceof ArrayBuffer) getBuffer = Promise.resolve(source);
    else if (typeof File !== 'undefined' && source instanceof File) getBuffer = source.arrayBuffer();
    else {
      if (!Boot.nodeRequire) return Promise.reject(new Error('Lecture du fichier impossible (Node.js désactivé).'));
      getBuffer = new Promise(function (resolve, reject) {
        Boot.nodeRequire('fs').readFile(source, function (err, buf) {
          if (err) return reject(new Error('Lecture impossible : ' + source));
          resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        });
      });
    }
    return getBuffer.then(function (ab) {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      var ctx = new Ctx();
      return new Promise(function (resolve, reject) {
        ctx.decodeAudioData(ab, resolve, function () {
          reject(new Error('Format audio non décodable. Utilisez un WAV, MP3 ou AAC.'));
        });
      }).then(function (buf) {
        try { ctx.close(); } catch (e) {}
        var ch = [];
        for (var i = 0; i < buf.numberOfChannels; i++) ch.push(buf.getChannelData(i));
        return { channels: ch, sampleRate: buf.sampleRate, duration: buf.duration };
      });
    });
  }

  // ------------------------------------------------------------ mode démo

  var Demo = {
    musicFile: null,
    markers: [],
    call: function (fn, args) {
      var self = this;
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try { resolve(self[fn](args)); } catch (e) { reject(e); }
        }, 60);
      });
    },
    OneSec_ping: function () { return { version: '1.0.0', app: 'démo', sequence: 'Séquence démo', fps: 25 }; },
    OneSec_getMusicInfo: function () {
      if (!this.musicFile) throw new Error('Mode démo : choisissez un fichier audio.');
      var d = this.musicDuration || 60;
      return {
        name: this.musicFile.name, path: this.musicFile, kind: 'audio', trackIndex: 0,
        start: 10, end: 10 + d, inPoint: 0, outPoint: d, nodeId: 'music', speed: 1,
        sequence: 'Séquence démo', sequenceId: 'demo', fps: 25, audioTrackCount: 3,
        videoTracks: [{ index: 0, name: 'V1', clipsInRange: 0 }, { index: 1, name: 'V2', clipsInRange: 0 }, { index: 2, name: 'V3', clipsInRange: 0 }]
      };
    },
    OneSec_addMarkers: function (a) { this.markers = this.markers.concat(a.markers); return { added: a.markers.length }; },
    OneSec_clearMarkers: function () { var n = this.markers.length; this.markers = []; return { removed: n }; },
    OneSec_getBins: function () { return [{ nodeId: 'bin1', path: 'Rushes' }, { nodeId: 'bin2', path: 'Rushes / Jour 2' }]; },
    OneSec_getRushes: function () {
      var clips = [], names = ['Saut_01', 'Ride_02', 'Trick_03', 'Chute_04', 'Run_05', 'Slide_06', 'Air_07', 'Grab_08', 'Line_09', 'Drop_10', 'Spin_11', 'Rail_12'];
      var seed = 5;
      function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      names.forEach(function (n, i) {
        var dur = 8 + Math.round(r() * 20), markers = [], k = 1 + Math.floor(r() * 3);
        for (var j = 0; j < k; j++) {
          var t = Math.round((2 + (dur - 3) * (j + 1) / (k + 1) + r()) * 25) / 25;
          markers.push({ start: t, end: t, name: i % 5 === 0 && j === 0 ? 'top' : '', comments: '', colorIndex: 0 });
        }
        clips.push({ nodeId: 'clip' + i, name: n + '.mp4', duration: dur, inPoint: 0, outPoint: dur, markers: markers });
      });
      return clips;
    },
    OneSec_buildEdit: function (a) { root.console && console.log('[démo] montage', a); return { placed: a.shots.length, speedFailed: 0, missing: 0, removed: 0, audioRemoved: 0, musicRestored: false, errors: [] }; },
    OneSec_clearEdit: function () { return { removed: 0 }; },
    OneSec_setPlayhead: function () { return true; },
    OneSec_getTrackClips: function (a) {
      var clips = [], names = ['Saut_01', 'Ride_02', 'Trick_03', 'Chute_04', 'Run_05', 'Slide_06'];
      for (var i = 0; i < 6; i++) clips.push({ name: names[i] + '.mp4', kind: 'video', trackIndex: a.videoTrack, start: 10 + i * 4, end: 14 + i * 4, inPoint: 2, outPoint: 6, nodeId: 'clip' + i, index: i, hasLumetri: false, media: { width: i % 2 ? 2688 : 3840, height: i % 2 ? 2016 : 2160, par: 1 } });
      return { clips: clips, fps: 25, sequence: 'Séquence démo', width: 1080, height: 1920 };
    },
    OneSec_exportFrames: function (a) {
      // Images de synthèse variées (sombre/froid, clair/chaud, etc.)
      var files = a.times.map(function (t, i) {
        var c = document.createElement('canvas'); c.width = 90; c.height = 160;
        var g = c.getContext('2d'), k = i % 6;
        g.fillStyle = '#000'; g.fillRect(0, 0, 90, 160); g.translate(0, 55); g.save(); g.beginPath(); g.rect(0, 0, 90, 50); g.clip(); g.scale(90 / 160, 50 / 90);
        var grad = g.createLinearGradient(0, 0, 0, 90);
        var pal = [['#1a2238', '#5c6b8a'], ['#ffe2b0', '#c48a4a'], ['#3b6d3a', '#a9d18e'], ['#0b0b0e', '#4b4b55'], ['#f2f2f2', '#9aa0a6'], ['#7a2e2e', '#e8a37c']][k];
        grad.addColorStop(0, pal[0]); grad.addColorStop(1, pal[1]);
        g.fillStyle = grad; g.fillRect(0, 0, 160, 90);
        g.fillStyle = '#d9a077'; g.beginPath(); g.arc(80 + (k - 3) * 10, 45, 18, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(20, 70, 40 + k * 10, 6);
        g.restore();
        return c.toDataURL('image/png');
      });
      this._frames = files;
      return { files: files, errors: [], dir: 'demo' };
    },
    OneSec_waitFrames: function (a) { return { files: this._frames || [] }; },
    OneSec_applyGrades: function (a) { return { applied: a.grades.length, noLumetri: 0, failedParams: {}, missing: 0 }; },
    OneSec_removeGrades: function () { return { removed: 0 }; },
    OneSec_applyFraming: function (a) { return { fixed: a.items.filter(function (i) { return i.mode !== 'auto'; }).length, auto: a.items.filter(function (i) { return i.mode === 'auto'; }).length, autoFailed: 0, missing: 0, propFailed: 0 }; },
    OneSec_resetFraming: function () { return { reset: 6 }; },
    OneSec_applyEffects: function (a) { var r = { motion: 0, transitions: 0, pulse: 0, missing: 0, failed: {}, transitionMissing: [] }; a.ops.forEach(function (o) { if (o.type === 'transition') r.transitions++; else if (o.type === 'pulse') r.pulse++; else r.motion++; }); return r; },
    OneSec_clearEffects: function () { return { cleared: 6, note: '' }; },
    OneSec_placeTexts: function (a) { return { placed: a.items.length, missing: 0, popFailed: 0 }; },
    OneSec_clearTexts: function () { return { removed: 0 }; },
    OneSec_diagFrames: function () { return { dir: 'demo', files: [] }; },
    OneSec_listLumetriParams: function () { return [{ index: 0, name: 'Temperature', value: 0 }, { index: 1, name: 'Tint', value: 0 }]; }
  };

  /** Charge une image (chemin disque, data-URL ou File) → HTMLImageElement. */
  function loadImage(source) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Image illisible : ' + (source.name || source))); };
      if (typeof File !== 'undefined' && source instanceof File) { img.src = URL.createObjectURL(source); return; }
      if (/^data:/.test(source)) { img.src = source; return; }
      // Chemin disque : lecture via Node (fiable), sinon file://
      if (Boot.nodeRequire) {
        try {
          var buf = Boot.nodeRequire('fs').readFileSync(source);
          img.src = 'data:image/png;base64,' + buf.toString('base64');
          return;
        } catch (e) { reject(new Error('Lecture impossible : ' + source + ' (' + e.message + ')')); return; }
      }
      var norm = String(source).replace(/\\/g, '/');
      img.src = 'file://' + (norm.charAt(0) === '/' ? '' : '/') + norm;
    });
  }

  function tempDir() {
    if (Boot.nodeRequire) {
      try {
        var os = Boot.nodeRequire('os'), path = Boot.nodeRequire('path');
        return path.join(os.tmpdir(), 'onesec-frames');
      } catch (e) {}
    }
    if (Boot.root) return Boot.root + '/.cache/frames';
    return '/tmp/onesec-frames';
  }

  root.OneSecBridge = { call: call, decodeAudio: decodeAudio, loadImage: loadImage, tempDir: tempDir, demo: Demo, isCEP: Boot.isCEP };
})(typeof globalThis !== 'undefined' ? globalThis : this);
