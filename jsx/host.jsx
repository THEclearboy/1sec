/*
 * 1SEC — Côté Premiere Pro (ExtendScript, ES3)
 * ---------------------------------------------
 * Toutes les fonctions publiques s'appellent OneSec_* et renvoient une chaîne
 * JSON : { ok: true, data: ... } ou { ok: false, error: "..." }.
 * Les arguments arrivent encodés (encodeURIComponent(JSON.stringify(obj))).
 *
 * Ce fichier est rechargé par le panneau via $.evalFile à chaque ouverture /
 * rechargement : une mise à jour ne nécessite pas de redémarrer Premiere.
 */

var ONESEC_TAG = '[1SEC]';
var ONESEC_TICKS = 254016000000;

// ------------------------------------------------------------------ JSON

function OneSec_json(v) {
  var t = typeof v, i, out;
  if (v === null || v === undefined) return 'null';
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\u0000-\u001f]/g, ' ') + '"';
  }
  if (v instanceof Array) {
    out = [];
    for (i = 0; i < v.length; i++) out.push(OneSec_json(v[i]));
    return '[' + out.join(',') + ']';
  }
  if (t === 'object') {
    out = [];
    for (i in v) if (v.hasOwnProperty(i) && typeof v[i] !== 'function') out.push(OneSec_json(String(i)) + ':' + OneSec_json(v[i]));
    return '{' + out.join(',') + '}';
  }
  return 'null';
}

function OneSec_ok(data) { return OneSec_json({ ok: true, data: data }); }
function OneSec_err(e) { return OneSec_json({ ok: false, error: String(e && e.message ? e.message + (e.line ? ' (ligne ' + e.line + ')' : '') : e) }); }
function OneSec_args(s) { return s ? eval('(' + decodeURIComponent(s) + ')') : {}; }

// ------------------------------------------------------------------ utilitaires

function OneSec_seq() {
  var seq = app.project.activeSequence;
  if (!seq) throw new Error('Aucune séquence active. Ouvrez votre séquence dans la timeline.');
  return seq;
}

function OneSec_secs(time) {
  if (time === undefined || time === null) return 0;
  if (typeof time === 'number') return time;
  if (time.seconds !== undefined) return time.seconds;
  return parseFloat(time.ticks) / ONESEC_TICKS;
}

function OneSec_ticks(seconds) {
  return String(Math.round(seconds * ONESEC_TICKS));
}

function OneSec_fps(seq) {
  try {
    var fd = seq.getSettings().videoFrameRate;
    var s = OneSec_secs(fd);
    if (s > 0) return 1 / s;
  } catch (e) {}
  try {
    var tb = parseFloat(seq.timebase);
    if (tb > 0) return ONESEC_TICKS / tb;
  } catch (e2) {}
  return 25;
}

function OneSec_trackItemInfo(it, kind, trackIndex) {
  var pi = it.projectItem, info = {
    name: it.name,
    kind: kind,
    trackIndex: trackIndex,
    start: OneSec_secs(it.start),
    end: OneSec_secs(it.end),
    inPoint: OneSec_secs(it.inPoint),
    outPoint: OneSec_secs(it.outPoint),
    nodeId: pi ? pi.nodeId : null,
    path: pi ? pi.getMediaPath() : null,
    speed: 1
  };
  try { info.speed = it.getSpeed(); } catch (e) {}
  return info;
}

var OneSec_itemCache = null;
function OneSec_findProjectItem(nodeId) {
  if (!OneSec_itemCache) {
    OneSec_itemCache = {};
    (function walk(item) {
      for (var i = 0; i < item.children.numItems; i++) {
        var c = item.children[i];
        OneSec_itemCache[c.nodeId] = c;
        if (c.type === ProjectItemType.BIN) walk(c);
      }
    })(app.project.rootItem);
  }
  return OneSec_itemCache[nodeId] || null;
}

function OneSec_markerList(markers) {
  var out = [], m, n = 0;
  if (!markers || !markers.numMarkers) return out;
  m = markers.getFirstMarker();
  while (m && n < 5000) {
    var color = null;
    try { color = m.getColorByIndex(); } catch (e) {}
    out.push({
      start: OneSec_secs(m.start), end: OneSec_secs(m.end),
      name: m.name || '', comments: m.comments || '', colorIndex: color, guid: m.guid
    });
    m = markers.getNextMarker(m);
    n++;
  }
  return out;
}

// ------------------------------------------------------------------ API

/** Ping + infos de version (sert aussi à vérifier que le script est chargé). */
function OneSec_ping() {
  try {
    var seq = app.project.activeSequence;
    return OneSec_ok({
      version: '1.0.0',
      app: app.version,
      project: app.project.name,
      sequence: seq ? seq.name : null,
      fps: seq ? OneSec_fps(seq) : null
    });
  } catch (e) { return OneSec_err(e); }
}

/** Clip musique : le clip audio sélectionné, sinon le premier clip audio trouvé. */
function OneSec_getMusicInfo() {
  try {
    var seq = OneSec_seq(), i, j, found = null;
    try {
      var sel = seq.getSelection();
      for (i = 0; i < sel.length; i++) {
        if (sel[i].mediaType === 'Audio') {
          for (j = 0; j < seq.audioTracks.numTracks; j++) {
            var tr = seq.audioTracks[j];
            for (var k = 0; k < tr.clips.numItems; k++) {
              if (tr.clips[k].nodeId === sel[i].nodeId) { found = OneSec_trackItemInfo(tr.clips[k], 'audio', j); break; }
            }
            if (found) break;
          }
          if (!found) found = OneSec_trackItemInfo(sel[i], 'audio', -1);
          break;
        }
      }
    } catch (eSel) {}
    if (!found) {
      for (j = 0; j < seq.audioTracks.numTracks && !found; j++) {
        if (seq.audioTracks[j].clips.numItems > 0) found = OneSec_trackItemInfo(seq.audioTracks[j].clips[0], 'audio', j);
      }
      if (found) found.guessed = true;
    }
    if (!found) throw new Error('Aucun clip audio dans la séquence. Placez votre musique dans la timeline.');
    found.sequence = seq.name;
    found.sequenceId = seq.sequenceID;
    found.fps = OneSec_fps(seq);
    found.videoTracks = [];
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
      var vt = seq.videoTracks[i], busy = 0;
      for (j = 0; j < vt.clips.numItems; j++) {
        var c = vt.clips[j];
        if (OneSec_secs(c.end) > found.start && OneSec_secs(c.start) < found.end) busy++;
      }
      found.videoTracks.push({ index: i, name: vt.name, clipsInRange: busy });
    }
    found.audioTrackCount = seq.audioTracks.numTracks;
    return OneSec_ok(found);
  } catch (e) { return OneSec_err(e); }
}

/** Pose des marqueurs sur la séquence. args: { markers: [{time, duration, name, comment, color}] } */
function OneSec_addMarkers(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), n = 0;
    for (var i = 0; i < a.markers.length; i++) {
      var d = a.markers[i];
      var m = seq.markers.createMarker(d.time);
      m.name = d.name || '';
      m.comments = ONESEC_TAG + ' ' + (d.comment || '');
      if (d.duration && d.duration > 0) {
        try { m.end = d.time + d.duration; } catch (e1) {
          try { var t = new Time(); t.seconds = d.time + d.duration; m.end = t; } catch (e2) {}
        }
      }
      if (d.color !== undefined && d.color !== null) { try { m.setColorByIndex(d.color, 0); } catch (e3) { try { m.setColorByIndex(d.color); } catch (e4) {} } }
      n++;
    }
    return OneSec_ok({ added: n });
  } catch (e) { return OneSec_err(e); }
}

/** Supprime les marqueurs posés par 1SEC (commentaire commençant par [1SEC]). */
function OneSec_clearMarkers() {
  try {
    var seq = OneSec_seq(), toDelete = [], m = seq.markers.getFirstMarker(), guard = 0;
    while (m && guard < 20000) {
      if (m.comments && m.comments.indexOf(ONESEC_TAG) === 0) toDelete.push(m);
      m = seq.markers.getNextMarker(m);
      guard++;
    }
    for (var i = 0; i < toDelete.length; i++) seq.markers.deleteMarker(toDelete[i]);
    return OneSec_ok({ removed: toDelete.length });
  } catch (e) { return OneSec_err(e); }
}

/** Lit les marqueurs de la séquence (pour resynchroniser après retouche manuelle). */
function OneSec_readSequenceMarkers() {
  try { return OneSec_ok(OneSec_markerList(OneSec_seq().markers)); } catch (e) { return OneSec_err(e); }
}

/** Liste des chutiers du projet. */
function OneSec_getBins() {
  try {
    var out = [];
    (function walk(item, path) {
      for (var i = 0; i < item.children.numItems; i++) {
        var c = item.children[i];
        if (c.type === ProjectItemType.BIN) {
          var p = path ? path + ' / ' + c.name : c.name;
          out.push({ nodeId: c.nodeId, path: p });
          walk(c, p);
        }
      }
    })(app.project.rootItem, '');
    return OneSec_ok(out);
  } catch (e) { return OneSec_err(e); }
}

function OneSec_clipInfo(pi) {
  if (!pi || pi.type !== ProjectItemType.CLIP) return null;
  try { if (pi.isSequence()) return null; } catch (e) {}
  var info = { nodeId: pi.nodeId, name: pi.name, path: pi.getMediaPath(), markers: OneSec_markerList(pi.getMarkers()) };
  // Durée du média : on lit le point de sortie après avoir retiré temporairement les points in/out.
  try {
    var oldIn = OneSec_secs(pi.getInPoint()), oldOut = OneSec_secs(pi.getOutPoint());
    pi.clearInOutPoints();
    info.duration = OneSec_secs(pi.getOutPoint());
    info.inPoint = 0;
    info.outPoint = info.duration;
    if (oldIn > 0.0001 || Math.abs(oldOut - info.duration) > 0.0001) {
      pi.setInPoint(oldIn, 4);
      pi.setOutPoint(oldOut, 4);
    }
  } catch (e2) { info.duration = null; }
  try {
    var fi = pi.getFootageInterpretation();
    if (fi && fi.frameRate) info.fps = fi.frameRate;
  } catch (e3) {}
  return info;
}

/**
 * Rushes et leurs marqueurs.
 * args: { mode: 'selection' | 'bin', binId }
 */
function OneSec_getRushes(s) {
  try {
    var a = OneSec_args(s), clips = [], i;
    OneSec_itemCache = null;
    if (a.mode === 'bin') {
      var bin = OneSec_findProjectItem(a.binId);
      if (!bin) throw new Error('Chutier introuvable.');
      (function walk(item) {
        for (var k = 0; k < item.children.numItems; k++) {
          var c = item.children[k];
          if (c.type === ProjectItemType.BIN) walk(c);
          else { var info = OneSec_clipInfo(c); if (info) clips.push(info); }
        }
      })(bin);
    } else {
      var sel = app.getCurrentProjectViewSelection();
      if (!sel || !sel.length) throw new Error('Sélectionnez vos rushes (ou un chutier) dans le panneau Projet.');
      for (i = 0; i < sel.length; i++) {
        if (sel[i].type === ProjectItemType.BIN) {
          (function walk2(item) {
            for (var k = 0; k < item.children.numItems; k++) {
              var c = item.children[k];
              if (c.type === ProjectItemType.BIN) walk2(c);
              else { var inf = OneSec_clipInfo(c); if (inf) clips.push(inf); }
            }
          })(sel[i]);
        } else {
          var info2 = OneSec_clipInfo(sel[i]);
          if (info2) clips.push(info2);
        }
      }
    }
    return OneSec_ok(clips);
  } catch (e) { return OneSec_err(e); }
}

// ------------------------------------------------------------------ montage

function OneSec_findTrackItemAt(track, start, nodeId) {
  var best = null, bestD = 1e9;
  for (var i = 0; i < track.clips.numItems; i++) {
    var c = track.clips[i], d = Math.abs(OneSec_secs(c.start) - start);
    if (d < bestD && (!nodeId || (c.projectItem && c.projectItem.nodeId === nodeId))) { best = { item: c, index: i }; bestD = d; }
  }
  return best && bestD < 0.1 ? best : null;
}

/** Trouve l'élément QE correspondant au n-ième clip (non vide) d'une piste. */
function OneSec_qeItem(qeTrack, clipIndex) {
  var n = -1;
  for (var i = 0; i < qeTrack.numItems; i++) {
    var it = qeTrack.getItemAt(i);
    if (!it || it.type === 'Empty') continue;
    n++;
    if (n === clipIndex) return it;
  }
  return null;
}

/**
 * Applique une vitesse au clip (API QE, non documentée).
 * La signature de setSpeed varie selon les versions : on vérifie le résultat.
 */
function OneSec_setSpeed(track, trackIndex, start, nodeId, speed) {
  if (Math.abs(speed - 1) < 0.001) return true;
  app.enableQE();
  var qeSeq = qe.project.getActiveSequence();
  var tries = [speed, speed * 100];
  for (var t = 0; t < tries.length; t++) {
    var found = OneSec_findTrackItemAt(track, start, nodeId);
    if (!found) return false;
    var qi = OneSec_qeItem(qeSeq.getVideoTrackAt(trackIndex), found.index);
    if (!qi) return false;
    try { qi.setSpeed(tries[t], '', false, false, false); } catch (e) { continue; }
    var check = OneSec_findTrackItemAt(track, start, nodeId);
    var got = 1;
    try { got = check.item.getSpeed(); } catch (e2) { return true; }
    if (Math.abs(got - speed) < 0.02) return true;
    // Mauvaise interprétation : on remet à 100 % avant l'essai suivant
    try { qi.setSpeed(t === 0 ? 1 : 100, '', false, false, false); } catch (e3) {}
  }
  return false;
}

function OneSec_removeInRange(track, from, to, nodeIds) {
  var removed = 0;
  for (var i = track.clips.numItems - 1; i >= 0; i--) {
    var c = track.clips[i], s0 = OneSec_secs(c.start), s1 = OneSec_secs(c.end);
    if (s0 >= from - 0.01 && s1 <= to + 0.01 && (!nodeIds || (c.projectItem && nodeIds[c.projectItem.nodeId]))) {
      c.remove(false, false);
      removed++;
    }
  }
  return removed;
}

/**
 * Construit le montage.
 * args: {
 *   videoTrack, clearTrack, muteRushAudio,
 *   range: { start, end },            // timeline
 *   music: { nodeId, trackIndex, start, end, inPoint, outPoint },
 *   shots: [{ clipId, timelineStart, timelineEnd, sourceIn, sourceOut, speed }]
 * }
 */
function OneSec_buildEdit(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), i;
    OneSec_itemCache = null;
    if (a.videoTrack >= seq.videoTracks.numTracks) throw new Error('Piste vidéo V' + (a.videoTrack + 1) + ' inexistante.');
    var track = seq.videoTracks[a.videoTrack];
    var report = { placed: 0, speedFailed: 0, missing: 0, removed: 0, audioRemoved: 0, musicRestored: false, errors: [] };
    var rushIds = {};
    for (i = 0; i < a.shots.length; i++) rushIds[a.shots[i].clipId] = true;

    if (a.clearTrack) report.removed = OneSec_removeInRange(track, a.range.start, a.range.end, null);

    var touched = {};
    for (i = 0; i < a.shots.length; i++) {
      var sh = a.shots[i];
      var pi = OneSec_findProjectItem(sh.clipId);
      if (!pi) { report.missing++; continue; }
      if (!touched[sh.clipId]) {
        touched[sh.clipId] = { item: pi, inP: OneSec_secs(pi.getInPoint()), outP: OneSec_secs(pi.getOutPoint()) };
      }
      try {
        pi.setInPoint(sh.sourceIn, 4);
        pi.setOutPoint(sh.sourceOut, 4);
        track.overwriteClip(pi, sh.timelineStart);
        report.placed++;
        if (Math.abs(sh.speed - 1) > 0.001) {
          if (!OneSec_setSpeed(track, a.videoTrack, sh.timelineStart, sh.clipId, sh.speed)) report.speedFailed++;
        }
      } catch (ePlace) {
        report.errors.push('Plan ' + (i + 1) + ' : ' + ePlace);
      }
    }

    // Restaure les points in/out d'origine des rushes
    for (var id in touched) {
      if (!touched.hasOwnProperty(id)) continue;
      var tc = touched[id];
      try { tc.item.clearInOutPoints(); } catch (eC) {}
      try {
        var full = OneSec_secs(tc.item.getOutPoint());
        if (tc.inP > 0.0001 || Math.abs(tc.outP - full) > 0.0001) { tc.item.setInPoint(tc.inP, 4); tc.item.setOutPoint(tc.outP, 4); }
      } catch (eR) {}
    }

    // Son des rushes : on le retire de toutes les pistes audio dans la zone du montage
    if (a.muteRushAudio) {
      for (i = 0; i < seq.audioTracks.numTracks; i++) {
        if (a.music && i === a.music.trackIndex) continue;
        report.audioRemoved += OneSec_removeInRange(seq.audioTracks[i], a.range.start, a.range.end, rushIds);
      }
    }

    // Vérifie que la musique est intacte ; sinon on la repose.
    if (a.music && a.music.trackIndex >= 0) {
      var mt = seq.audioTracks[a.music.trackIndex], intact = false, dirty = false;
      for (i = 0; i < mt.clips.numItems; i++) {
        var c = mt.clips[i];
        var cs = OneSec_secs(c.start), ce = OneSec_secs(c.end);
        if (ce <= a.music.start + 0.01 || cs >= a.music.end - 0.01) continue;
        if (c.projectItem && c.projectItem.nodeId === a.music.nodeId && Math.abs(cs - a.music.start) < 0.02 && Math.abs(ce - a.music.end) < 0.02) intact = true;
        else if (c.projectItem && rushIds[c.projectItem.nodeId]) dirty = true;
      }
      if (!intact || dirty) {
        OneSec_removeInRange(mt, a.music.start, a.music.end, null);
        var mpi = OneSec_findProjectItem(a.music.nodeId);
        if (mpi) {
          var mIn = OneSec_secs(mpi.getInPoint()), mOut = OneSec_secs(mpi.getOutPoint());
          mpi.setInPoint(a.music.inPoint, 4);
          mpi.setOutPoint(a.music.outPoint, 4);
          mt.overwriteClip(mpi, a.music.start);
          mpi.setInPoint(mIn, 4); mpi.setOutPoint(mOut, 4);
          report.musicRestored = true;
        }
      }
    }
    return OneSec_ok(report);
  } catch (e) { return OneSec_err(e); }
}

/** Efface le montage généré (clips des rushes sur la piste cible, dans la zone de la musique). */
function OneSec_clearEdit(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), ids = {}, i;
    for (i = 0; i < a.clipIds.length; i++) ids[a.clipIds[i]] = true;
    var removed = OneSec_removeInRange(seq.videoTracks[a.videoTrack], a.range.start, a.range.end, ids);
    for (i = 0; i < seq.audioTracks.numTracks; i++) {
      if (a.musicTrack === i) continue;
      removed += OneSec_removeInRange(seq.audioTracks[i], a.range.start, a.range.end, ids);
    }
    return OneSec_ok({ removed: removed });
  } catch (e) { return OneSec_err(e); }
}

/** Place la tête de lecture (aperçu d'un plan / d'une section). */
function OneSec_setPlayhead(s) {
  try {
    var a = OneSec_args(s);
    OneSec_seq().setPlayerPosition(OneSec_ticks(a.time));
    return OneSec_ok(true);
  } catch (e) { return OneSec_err(e); }
}

// ================================================================== COLORIMÉTRIE

function OneSec_timecode(seconds, fps) {
  var df = Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;
  var nominal = df ? Math.round(fps) : fps;
  var totalFrames = Math.round(seconds * fps);
  var fr = Math.round(nominal);
  var f = totalFrames % fr, s = Math.floor(totalFrames / fr);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s = s % 60;
  function p(n) { return (n < 10 ? '0' : '') + n; }
  var sep = df ? ';' : ':';
  return p(h) + ':' + p(m) + ':' + p(s) + sep + p(f);
}

/** Clips vidéo d'une piste. args: { videoTrack, range? } */
function OneSec_getTrackClips(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), out = [];
    var track = seq.videoTracks[a.videoTrack];
    if (!track) throw new Error('Piste vidéo introuvable.');
    for (var i = 0; i < track.clips.numItems; i++) {
      var c = track.clips[i], info = OneSec_trackItemInfo(c, 'video', a.videoTrack);
      if (a.range && (info.end <= a.range.start || info.start >= a.range.end)) continue;
      info.index = i;
      info.media = OneSec_mediaInfo(c.projectItem);
      info.hasLumetri = false;
      try {
        for (var k = 0; k < c.components.numItems; k++) {
          if (/lumetri/i.test(c.components[k].displayName)) { info.hasLumetri = true; break; }
        }
      } catch (e) {}
      out.push(info);
    }
    return OneSec_ok({ clips: out, fps: OneSec_fps(seq), sequence: seq.name, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical });
  } catch (e) { return OneSec_err(e); }
}

/** Dimensions du média (via les métadonnées projet « VideoInfo », ex. « 3840 x 2160 (1.0) »). */
function OneSec_mediaInfo(pi) {
  var info = { width: null, height: null, par: 1, source: null };
  if (!pi) return info;
  function parse(str, src) {
    var m = /([0-9]{3,5})\s*[x×]\s*([0-9]{3,5})(?:\s*\(([0-9.]+)\))?/.exec(str || '');
    if (m && !info.width) { info.width = parseInt(m[1], 10); info.height = parseInt(m[2], 10); if (m[3]) info.par = parseFloat(m[3]); info.source = src; }
  }
  try {
    var xmp = pi.getProjectMetadata();
    var m1 = /VideoInfo[^>]*>([^<]*)</.exec(xmp);
    if (m1) parse(m1[1], 'xmp');
  } catch (e) {}
  if (!info.width) {
    try {
      var cols = pi.getProjectColumnsMetadata();
      var m2 = /"(?:Video Info|Infos vidéo|Informations vidéo)"\s*:\s*"([^"]*)"/.exec(cols);
      if (m2) parse(m2[1], 'columns'); else parse(cols, 'columns-any');
    } catch (e2) {}
  }
  try { var fi = pi.getFootageInterpretation(); if (fi && fi.pixelAspectRatio) info.par = fi.pixelAspectRatio; } catch (e3) {}
  return info;
}

// ================================================================== CADRAGE

var ONESEC_MOTION_NAMES = {
  position: ['Position'],
  scale: ['Scale', 'Échelle', 'Echelle'],
  uniform: ['Uniform Scale', 'Échelle uniforme', 'Echelle uniforme']
};
function OneSec_findMotion(clip) {
  for (var k = 0; k < clip.components.numItems; k++) {
    var dn = clip.components[k].displayName;
    if (/^(Motion|Trajectoire|Bewegung|Movimiento)$/i.test(dn)) return clip.components[k];
  }
  return clip.components.numItems > 1 ? clip.components[1] : null; // [0] = Opacité, [1] = Trajectoire habituellement
}
function OneSec_motionProp(comp, key, fallbackIndex) {
  var names = ONESEC_MOTION_NAMES[key];
  for (var i = 0; i < comp.properties.numItems; i++) {
    for (var n = 0; n < names.length; n++) if (comp.properties[i].displayName === names[n]) return comp.properties[i];
  }
  return fallbackIndex != null && fallbackIndex < comp.properties.numItems ? comp.properties[fallbackIndex] : null;
}

/**
 * Applique un cadrage aux clips.
 * args: { videoTrack, items: [{ start, mode: 'fixed'|'auto', scale, x, y }] }
 *  - fixed : Trajectoire › Échelle / Position
 *  - auto  : effet « Recadrage automatique » (suivi du sujet par Premiere)
 */
function OneSec_applyFraming(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), track = seq.videoTracks[a.videoTrack];
    var report = { fixed: 0, auto: 0, autoFailed: 0, missing: 0, propFailed: 0, positionUnit: null };
    var sw = seq.frameSizeHorizontal, sh = seq.frameSizeVertical;
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var autoFx = null, autoNames = ['Auto Reframe', 'Recadrage automatique', 'Automatisch neu einrahmen', 'Reencuadre automático'];
    for (var i = 0; i < a.items.length; i++) {
      var it = a.items[i], found = OneSec_findTrackItemAt(track, it.start, null);
      if (!found) { report.missing++; continue; }
      var clip = found.item;
      if (it.mode === 'auto') {
        var done = false;
        if (!autoFx) for (var n = 0; n < autoNames.length && !autoFx; n++) { try { autoFx = qe.project.getVideoEffectByName(autoNames[n]); } catch (e) {} }
        if (autoFx) {
          try {
            var already = false;
            for (var k = 0; k < clip.components.numItems; k++) if (/reframe|recadrage/i.test(clip.components[k].displayName)) already = true;
            if (!already) { var qi = OneSec_qeItem(qeSeq.getVideoTrackAt(a.videoTrack), found.index); if (qi) qi.addVideoEffect(autoFx); }
            done = true;
          } catch (e1) {}
        }
        if (done) { report.auto++; continue; }
        report.autoFailed++;
        // repli : cadrage fixe
      }
      var motion = OneSec_findMotion(clip);
      if (!motion) { report.propFailed++; continue; }
      try {
        var ps = OneSec_motionProp(motion, 'scale', 1);
        if (ps) { try { if (ps.isTimeVarying()) ps.setTimeVarying(false); } catch (eT) {} ps.setValue(it.scale, true); }
        var pp = OneSec_motionProp(motion, 'position', 0);
        if (pp) {
          try { if (pp.isTimeVarying()) pp.setTimeVarying(false); } catch (eT2) {}
          var pos = OneSec_positionValue(pp, it.x, it.y, sw, sh);
          report.positionUnit = pos.unit;
          pp.setValue(pos.value, true);
        }
        report.fixed++;
      } catch (e2) { report.propFailed++; }
    }
    return OneSec_ok(report);
  } catch (e) { return OneSec_err(e); }
}

/**
 * La Position de Trajectoire est, selon les versions, en pixels ou normalisée (0,5 ; 0,5 = centre).
 * On déduit l'unité de la valeur courante.
 */
function OneSec_positionValue(pp, x, y, sw, sh) {
  var unit = 'normalized';
  try {
    var cur = pp.getValue();
    if (cur && cur.length >= 2 && (Math.abs(cur[0]) > 2 || Math.abs(cur[1]) > 2)) unit = 'pixels';
  } catch (e) {}
  return unit === 'pixels' ? { unit: unit, value: [x, y] } : { unit: unit, value: [x / sw, y / sh] };
}

/** Remet Échelle 100 % / Position centrée et retire le recadrage automatique. args: { videoTrack, range? } */
function OneSec_resetFraming(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), track = seq.videoTracks[a.videoTrack], n = 0;
    app.enableQE();
    var qeTrack = qe.project.getActiveSequence().getVideoTrackAt(a.videoTrack);
    var cx = seq.frameSizeHorizontal / 2, cy = seq.frameSizeVertical / 2;
    for (var i = 0; i < track.clips.numItems; i++) {
      var c = track.clips[i], st = OneSec_secs(c.start);
      if (a.range && (OneSec_secs(c.end) <= a.range.start || st >= a.range.end)) continue;
      var motion = OneSec_findMotion(c);
      if (motion) {
        try {
          var ps0 = OneSec_motionProp(motion, 'scale', 1), pp0 = OneSec_motionProp(motion, 'position', 0);
          try { if (ps0.isTimeVarying()) ps0.setTimeVarying(false); } catch (eA) {}
          try { if (pp0.isTimeVarying()) pp0.setTimeVarying(false); } catch (eB) {}
          ps0.setValue(100, true);
          pp0.setValue(OneSec_positionValue(pp0, cx, cy, seq.frameSizeHorizontal, seq.frameSizeVertical).value, true);
        } catch (e) {}
      }
      var qi = OneSec_qeItem(qeTrack, i);
      if (qi) for (var k = qi.numComponents - 1; k >= 0; k--) {
        var comp = qi.getComponentAt(k);
        if (comp && /reframe|recadrage/i.test(comp.name)) { try { comp.remove(); } catch (e2) {} }
      }
      n++;
    }
    return OneSec_ok({ reset: n });
  } catch (e) { return OneSec_err(e); }
}

// ================================================================== EFFETS

// Temps des images clés : 'source' = temps média (point d'entrée + décalage),
// 'sequence' = temps de la séquence. Changez si les effets tombent au mauvais endroit.
var ONESEC_KEY_TIME_MODE = 'source';

function OneSec_keyTime(clip, tLocal, mode) {
  return (mode === 'sequence' ? OneSec_secs(clip.start) : OneSec_secs(clip.inPoint)) + tLocal;
}

function OneSec_setKeys(prop, clip, keys, valueOf, mode) {
  prop.setTimeVarying(true);
  for (var i = 0; i < keys.length; i++) {
    var t = OneSec_keyTime(clip, keys[i].t, mode);
    try { prop.addKey(t); } catch (e) {}
    prop.setValueAtKey(t, valueOf(keys[i]), true);
    try { prop.setInterpolationTypeAtKey(t, 5, true); } catch (e2) {} // 5 = Bézier (lisse) si supporté
  }
}

var ONESEC_TRANSITIONS = {
  dissolve: ['Cross Dissolve', 'Fondu enchaîné', 'Fondu enchaîne', 'Weiche Blende'],
  dipBlack: ['Dip to Black', 'Fondu au noir', 'Schwarzblende'],
  dipWhite: ['Dip to White', 'Fondu au blanc', 'Weißblende']
};
var OneSec_transitionCache = {};
function OneSec_transition(name) {
  if (OneSec_transitionCache[name] !== undefined) return OneSec_transitionCache[name];
  var fx = null, names = ONESEC_TRANSITIONS[name] || [name];
  for (var i = 0; i < names.length && !fx; i++) { try { fx = qe.project.getVideoTransitionByName(names[i]); } catch (e) {} }
  OneSec_transitionCache[name] = fx || null;
  return fx;
}

function OneSec_addTransition(qi, fx, atStart, duration, fps) {
  var tc = OneSec_timecode(duration, fps);
  var attempts = [
    function () { return qi.addTransition(fx, atStart, tc, '00:00:00:00', 0.5, false, true); },
    function () { return qi.addTransition(fx, atStart, tc); },
    function () { return qi.addTransition(fx, atStart); }
  ];
  for (var i = 0; i < attempts.length; i++) { try { attempts[i](); return true; } catch (e) {} }
  return false;
}

/**
 * Applique les effets. args: { videoTrack, ops: [...], keyTimeMode? }
 */
function OneSec_applyEffects(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), track = seq.videoTracks[a.videoTrack], fps = OneSec_fps(seq);
    var mode = a.keyTimeMode || ONESEC_KEY_TIME_MODE;
    app.enableQE();
    var qeTrack = qe.project.getActiveSequence().getVideoTrackAt(a.videoTrack);
    var cx = seq.frameSizeHorizontal / 2, cy = seq.frameSizeVertical / 2;
    var report = { motion: 0, transitions: 0, pulse: 0, missing: 0, failed: {}, transitionMissing: [] };
    OneSec_transitionCache = {};
    function fail(k) { report.failed[k] = (report.failed[k] || 0) + 1; }
    for (var i = 0; i < a.ops.length; i++) {
      var op = a.ops[i], found = OneSec_findTrackItemAt(track, op.start, null);
      if (!found) { report.missing++; continue; }
      var clip = found.item;
      try {
        if (op.type === 'transition') {
          var fx = OneSec_transition(op.name);
          if (!fx) { if (report.transitionMissing.indexOf(op.name) < 0) report.transitionMissing.push(op.name); fail(op.name); continue; }
          var qi = OneSec_qeItem(qeTrack, found.index);
          if (qi && OneSec_addTransition(qi, fx, op.position !== 'end', op.duration, fps)) report.transitions++; else fail(op.name);
        } else if (op.type === 'punch' || op.type === 'kenburns') {
          var motion = OneSec_findMotion(clip), ps = OneSec_motionProp(motion, 'scale', 1);
          var base = 100;
          try { base = ps.getValue(); } catch (eB) {}
          OneSec_setKeys(ps, clip, op.keys, function (k) { return base * k.scale; }, mode);
          report.motion++;
        } else if (op.type === 'shake') {
          var motion2 = OneSec_findMotion(clip), pp = OneSec_motionProp(motion2, 'position', 0);
          var basePos = [cx, cy], norm = false;
          try { basePos = pp.getValue(); norm = Math.abs(basePos[0]) <= 2 && Math.abs(basePos[1]) <= 2; } catch (eP) {}
          var sw2 = seq.frameSizeHorizontal, sh2 = seq.frameSizeVertical;
          OneSec_setKeys(pp, clip, op.keys, function (k) { return norm ? [basePos[0] + k.dx / sw2, basePos[1] + k.dy / sh2] : [basePos[0] + k.dx, basePos[1] + k.dy]; }, mode);
          report.motion++;
        } else if (op.type === 'pulse') {
          if (!OneSec_ensureLumetri(seq, a.videoTrack, clip)) { fail('pulse'); continue; }
          var comp = OneSec_findLumetri(clip), idx = OneSec_lumetriIndex(comp, 'exposure', 0);
          if (idx < 0) { fail('pulse'); continue; }
          var pe = comp.properties[idx], baseE = 0;
          try { baseE = pe.getValue(); } catch (eE) {}
          OneSec_setKeys(pe, clip, op.keys, function (k) { return baseE + k.exposure; }, mode);
          report.pulse++;
        }
      } catch (e) { fail(op.type + ':' + e); }
    }
    return OneSec_ok(report);
  } catch (e) { return OneSec_err(e); }
}

/** Retire les images clés Trajectoire (échelle / position) et l'animation d'exposition. args: { videoTrack, range? } */
function OneSec_clearEffects(s) {
  try {
    var a = OneSec_args(s), seq = OneSec_seq(), track = seq.videoTracks[a.videoTrack], n = 0;
    var cx = seq.frameSizeHorizontal / 2, cy = seq.frameSizeVertical / 2;
    for (var i = 0; i < track.clips.numItems; i++) {
      var c = track.clips[i], st = OneSec_secs(c.start);
      if (a.range && (OneSec_secs(c.end) <= a.range.start || st >= a.range.end)) continue;
      var motion = OneSec_findMotion(c);
      if (motion) {
        try {
          var ps = OneSec_motionProp(motion, 'scale', 1), pp = OneSec_motionProp(motion, 'position', 0);
          if (ps && ps.isTimeVarying()) { var v = ps.getValue(); ps.setTimeVarying(false); ps.setValue(a.keepScale === false ? 100 : v, true); }
          if (pp && pp.isTimeVarying()) { pp.setTimeVarying(false); pp.setValue([cx, cy], true); }
        } catch (e) {}
      }
      var comp = OneSec_findLumetri(c);
      if (comp) { try { var idx = OneSec_lumetriIndex(comp, 'exposure', 0); var pe = comp.properties[idx]; if (pe.isTimeVarying()) { var ev = pe.getValue(); pe.setTimeVarying(false); pe.setValue(ev, true); } } catch (e2) {} }
      n++;
    }
    return OneSec_ok({ cleared: n, note: 'Les transitions se retirent dans Premiere (sélection + Suppr).' });
  } catch (e) { return OneSec_err(e); }
}

/** Diagnostic : contenu du dossier d'export et infos média des clips d'une piste. args: { dir, videoTrack } */
function OneSec_diagFrames(s) {
  try {
    var a = OneSec_args(s), out = { dir: a.dir, files: [], media: [] };
    var folder = new Folder(a.dir);
    out.dirExists = folder.exists;
    if (folder.exists) { var fl = folder.getFiles(); for (var i = 0; i < fl.length; i++) out.files.push(decodeURI(fl[i].name) + ' (' + fl[i].length + ' o)'); }
    var seq = OneSec_seq(), track = seq.videoTracks[a.videoTrack];
    var seen = {};
    for (var k = 0; k < track.clips.numItems && out.media.length < 6; k++) {
      var pi = track.clips[k].projectItem;
      if (!pi || seen[pi.nodeId]) continue;
      seen[pi.nodeId] = true;
      var mi = OneSec_mediaInfo(pi), raw = '';
      try { raw = (/VideoInfo[^>]*>([^<]*)</.exec(pi.getProjectMetadata()) || [])[1] || ''; } catch (e) {}
      out.media.push({ name: pi.name, width: mi.width, height: mi.height, source: mi.source, raw: raw });
    }
    out.sequence = { width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: OneSec_fps(seq) };
    return OneSec_ok(out);
  } catch (e) { return OneSec_err(e); }
}
