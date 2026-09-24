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
    OneSec_setPlayhead: function () { return true; }
  };

  root.OneSecBridge = { call: call, decodeAudio: decodeAudio, demo: Demo, isCEP: Boot.isCEP };
})(typeof globalThis !== 'undefined' ? globalThis : this);
