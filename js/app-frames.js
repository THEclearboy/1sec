/*
 * 1SEC — Images des rushes (partagé par la colo et le cadrage)
 * Les plans sont regroupés par rush (même média) : une image exportée par rush,
 * prise au milieu du plan le plus long de ce rush.
 */
(function (root) {
  'use strict';
  var C = root.OneSecColor, B = root.OneSecBridge;
  var H = null;
  var cache = {}; // nodeId → { small, box, stats, subject, path, error }
  var lastInfo = null;

  /**
   * Charge les clips d'une piste, les regroupe par rush et exporte une image par rush.
   * Retourne { clips, groups: [{ id, name, media, clips, rep }], seq, missing, errors }.
   */
  function load(track, range, label) {
    var clips, seq, groups;
    H.busy(true, 'Lecture des clips…');
    return B.call('OneSec_getTrackClips', { videoTrack: track, range: range }).then(function (r) {
      clips = r.clips; seq = { width: r.width, height: r.height, fps: r.fps };
      lastInfo = seq;
      if (!clips.length) throw new Error('Aucun clip sur la piste V' + (track + 1) + (range ? ' dans la zone de la musique' : '') + '.');
      var byId = {};
      groups = [];
      clips.forEach(function (c) {
        var id = c.nodeId || c.name;
        if (!byId[id]) { byId[id] = { id: id, name: c.name, media: c.media, clips: [], rep: c }; groups.push(byId[id]); }
        byId[id].clips.push(c);
        if (c.end - c.start > byId[id].rep.end - byId[id].rep.start) byId[id].rep = c;
      });
      H.busy(true, (label || 'Export') + ' : ' + groups.length + ' rushes…');
      var times = groups.map(function (g) { return g.rep.start + (g.rep.end - g.rep.start) * 0.5; });
      return B.call('OneSec_exportFrames', { times: times, dir: B.tempDir() });
    }).then(function (r) {
      H.busy(true, 'Analyse des images…');
      var errors = r.errors || [], missing = 0;
      return groups.reduce(function (p, g, i) {
        return p.then(function () {
          if (!r.files[i]) { missing++; cache[g.id] = { error: errors[0] ? errors[0].replace(/^Image \d+ : /, '') : 'export impossible' }; return; }
          return B.loadImage(r.files[i]).then(function (img) {
            var cv = document.createElement('canvas');
            var scale = Math.min(1, 360 / Math.max(img.width, img.height));
            cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
            var ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            var data = ctx.getImageData(0, 0, cv.width, cv.height);
            var box = C.contentBox(data);
            cache[g.id] = { small: data, box: box, stats: C.analyzeImage(data, 1, box), subject: C.findSubject(data, box), path: r.files[i] };
          }).catch(function (e) { missing++; cache[g.id] = { error: e.message }; });
        });
      }, Promise.resolve()).then(function () {
        H.busy(false);
        return { clips: clips, groups: groups, seq: seq, missing: missing, errors: errors };
      });
    }).catch(function (e) { H.busy(false); throw e; });
  }

  function get(id) { return cache[id] || null; }
  function has() { return Object.keys(cache).length > 0; }
  function clear() { cache = {}; }

  root.OneSecFrames = { init: function (h) { H = h; }, load: load, get: get, has: has, clear: clear, seqInfo: function () { return lastInfo; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
