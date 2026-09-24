const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/audio-analysis.js');
const P = require('../js/edit-planner.js');
const { synthSong } = require('./synth.js');

const song = synthSong({ bpm: 128 });
const an = A.analyze([song.data], song.sr, { sensitivity: 0.8 });

const clips = [];
for (let c = 0; c < 10; c++) {
  clips.push({ nodeId: 'c' + c, name: 'Rush ' + c, inPoint: 0, outPoint: 20, duration: 20,
    markers: [{ start: 5, end: 5, name: c === 2 ? 'top' : '' }, { start: 9, end: 12, name: '' }, { start: 15, end: 15, name: c === 3 ? 'skip' : '' }] });
}
const moments = P.momentsFromClips(clips, { defaultLength: 3 });
const fps = 25;
function mk(extra) {
  return P.plan(Object.assign({ analysis: an, fps, moments, timelineOffset: 10, options: { seed: 4 } }, extra || {}));
}

test('moments issus des marqueurs', () => {
  assert.strictEqual(moments.length, 29); // 30 - 1 skip
  const dur = moments.find(m => m.clipId === 'c0' && m.peak === 12);
  assert.strictEqual(dur.rangeStart, 9);
  assert.strictEqual(moments.filter(m => m.rating).length, 1);
});

test('les plans couvrent toute la musique sans trou ni chevauchement', () => {
  const p = mk();
  const s = p.shots;
  assert.ok(Math.abs(s[0].timelineStart - 10) < 1 / fps);
  assert.ok(Math.abs(s[s.length - 1].timelineEnd - (10 + an.duration)) < 1 / fps + 1e-6);
  for (let i = 1; i < s.length; i++) assert.ok(Math.abs(s[i].timelineStart - s[i - 1].timelineEnd) < 1e-6, 'trou au plan ' + i);
});

test('coupes sur la grille des temps et alignées à l\'image', () => {
  const p = mk();
  const grid = [];
  an.beats.forEach((b, i) => { grid.push(b); if (i) grid.push((b + an.beats[i - 1]) / 2); });
  p.shots.forEach(s => {
    const onGrid = s.start === 0 || grid.some(g => Math.abs(g - s.start) < 1e-6) || an.sections.some(x => Math.abs(x.start - s.start) < 1e-6);
    assert.ok(onGrid, 'coupe hors grille à ' + s.start);
    assert.ok(Math.abs(s.timelineStart * fps - Math.round(s.timelineStart * fps)) < 1e-6);
  });
});

test('rythme : plus de coupes dans le drop que dans l\'intro, ralentis dans le calme', () => {
  const p = mk();
  const drop = p.sections.find(s => s.drop);
  const calm = p.sections[p.sections.length - 1]; // outro calme
  const avg = (sec) => { const sh = p.shots.filter(s => s.section === sec.index); return (sec.end - sec.start) / sh.length; };
  assert.ok(avg(drop) < avg(calm) / 2, 'drop ' + avg(drop) + ' calme ' + avg(calm));
  assert.ok(p.shots.filter(s => s.section === calm.index).every(s => s.speed <= 0.5));
  // le début de la musique (calme) est coupé plus lentement que le drop
  const early = p.shots.filter(s => s.end < 14);
  assert.ok(14 / early.length > avg(drop) * 2, 'début ' + 14 / early.length);
});

test('plan héros au drop avec le moment top', () => {
  const p = mk();
  const drop = p.sections.find(s => s.drop);
  const hero = p.shots.find(s => s.section === drop.index);
  assert.strictEqual(hero.tag, 'hero');
  assert.strictEqual(hero.clipId, 'c2');
  assert.ok(hero.speed <= 0.5);
});

test('la source se termine sur le marqueur (+ marge) et a la bonne durée', () => {
  const p = mk({ options: { seed: 4, tail: 0 } });
  p.shots.forEach(s => {
    const m = moments.find(x => x.id === s.momentId);
    assert.ok(s.sourceOut <= m.peak + 1e-6);
    assert.ok(s.sourceIn >= m.clipStart - 1e-6);
    const need = (s.end - s.start) * s.speed;
    assert.ok(Math.abs((s.sourceOut - s.sourceIn) - need) < 1e-6);
  });
});

test('pas deux fois le même rush d\'affilée', () => {
  const p = mk();
  let same = 0;
  for (let i = 1; i < p.shots.length; i++) if (p.shots[i].clipId === p.shots[i - 1].clipId) same++;
  assert.ok(same <= 2, same + ' répétitions');
});

test('réglage manuel : section en « très rapide » et vitesse 100%', () => {
  const base = mk();
  const intro = base.sections[base.sections.length - 1];
  const p = mk({ sectionSettings: { [intro.index]: { pace: 'tres_rapide', speed: '1' } } });
  const a = base.shots.filter(s => s.section === intro.index).length;
  const b = p.shots.filter(s => s.section === intro.index).length;
  assert.ok(b > a * 3, a + ' -> ' + b);
  assert.ok(p.shots.filter(s => s.section === intro.index).every(s => s.speed === 1));
});

test('plan verrouillé conservé quand on change de variante', () => {
  const base = mk();
  const target = base.shots[5];
  const overrides = { [target.key]: { locked: true, start: target.start, end: target.end, momentId: target.momentId, speed: target.speed } };
  for (const seed of [9, 10, 11]) {
    const p = mk({ overrides, options: { seed } });
    const same = p.shots.find(s => Math.abs(s.start - target.start) < 1e-6);
    assert.ok(same && Math.abs(same.end - target.end) < 1e-6 && same.momentId === target.momentId);
  }
});

test('variantes différentes selon la graine, déterministes pour une graine', () => {
  const a = mk({ options: { seed: 1 } }), b = mk({ options: { seed: 2 } }), c = mk({ options: { seed: 1 } });
  assert.deepStrictEqual(a.shots.map(s => s.start), c.shots.map(s => s.start));
  assert.notDeepStrictEqual(a.shots.map(s => s.start + s.momentId), b.shots.map(s => s.start + s.momentId));
});

test('marqueurs musique : sections et moments forts', () => {
  const list = P.musicMarkers(an, { start: 0, end: an.duration }, 10, { sections: true, hits: true });
  assert.ok(list.filter(m => m.kind === 'section').length === an.sections.length);
  assert.ok(list.every(m => m.time >= 10));
});
