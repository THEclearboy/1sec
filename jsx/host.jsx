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
