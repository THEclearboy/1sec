const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/audio-analysis.js');
const { synthSong } = require('./synth.js');

const song = synthSong({ bpm: 128 });
const an = A.analyze([song.data], song.sr, { sensitivity: 0.8 });

test('tempo détecté à ±1 BPM', () => {
  assert.ok(Math.abs(an.bpm - 128) < 1, 'bpm=' + an.bpm);
});

test('temps réguliers couvrant tout le morceau', () => {
  const p = 60 / an.bpm;
  assert.ok(an.beats[0] < p);
  assert.ok(an.duration - an.beats[an.beats.length - 1] < p * 1.2);
  for (let i = 1; i < an.beats.length; i++) {
    const d = an.beats[i] - an.beats[i - 1];
    assert.ok(d > p * 0.7 && d < p * 1.3, 'intervalle ' + d);
  }
});

test('les temps tombent sur les kicks', () => {
  const p = 60 / 128;
  let err = 0, n = 0;
  an.beats.forEach(t => { if (t > 16 && t < 60) { const ph = t % p; err += Math.min(ph, p - ph); n++; } });
  assert.ok(err / n < 0.035, 'erreur moyenne ' + (err / n));
});

test('drop détecté au début de la partie intense (~31 s)', () => {
  const drop = an.sections.find(s => s.drop);
  assert.ok(drop, 'pas de drop : ' + JSON.stringify(an.sections.map(s => [s.start, s.type])));
  assert.ok(Math.abs(drop.start - 31) < 2, 'drop à ' + drop.start);
  assert.ok(drop.energy > 0.7);
});

test('intro et outro calmes', () => {
  assert.ok(an.sections[0].energy < 0.35);
  assert.ok(an.sections[an.sections.length - 1].energy < 0.35);
});

test('×2 / ÷2 du tempo', () => {
  const b = JSON.parse(JSON.stringify(an));
  A.scaleTempo(b, 2, 0.8);
  assert.ok(Math.abs(b.bpm - 256) < 2);
  A.scaleTempo(b, 0.5, 0.8);
  assert.ok(Math.abs(b.bpm - 128) < 1);
});

test('tempo sur un autre BPM (95)', () => {
  const s2 = synthSong({ bpm: 95 });
  const a2 = A.analyze([s2.data], s2.sr);
  assert.ok(Math.abs(a2.bpm - 95) < 1.5 || Math.abs(a2.bpm - 190) < 3, 'bpm=' + a2.bpm);
});
