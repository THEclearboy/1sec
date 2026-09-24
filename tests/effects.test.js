const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/audio-analysis.js');
const P = require('../js/edit-planner.js');
const E = require('../js/effects-planner.js');
const { synthSong } = require('./synth.js');

const song = synthSong({ bpm: 128 });
const an = A.analyze([song.data], song.sr, { sensitivity: 0.8 });
const clips = [];
for (let c = 0; c < 10; c++) clips.push({ nodeId: 'c' + c, name: 'Rush ' + c, inPoint: 0, outPoint: 20, duration: 20, markers: [{ start: 5, end: 5 }, { start: 9, end: 12 }, { start: 15, end: 15 }] });
const plan = P.plan({ analysis: an, fps: 25, moments: P.momentsFromClips(clips, {}), timelineOffset: 10, options: { seed: 4 } });
const fx = E.planEffects(plan, an, 25, { pulse: true });

test('des effets de chaque type, en quantité raisonnable', () => {
  assert.ok(fx.ops.length > 3 && fx.ops.length < plan.shots.length, fx.ops.length + ' effets pour ' + plan.shots.length + ' plans');
  assert.ok(fx.summary.dipBlack === 2, JSON.stringify(fx.summary));
  assert.ok(fx.summary.dipWhite >= 1, 'flash au drop');
  assert.ok((fx.summary.punch || 0) + (fx.summary.shake || 0) >= 1, 'accents');
  assert.ok(fx.summary.kenburns >= 1, 'zoom lent');
  assert.ok(fx.summary.pulse >= 1);
});

test('les images clés restent dans le plan et sont en temps timeline', () => {
  fx.ops.forEach(op => {
    const shot = plan.shots.find(s => s.timelineStart === op.start);
    assert.ok(shot, 'plan introuvable pour ' + op.type);
    (op.keys || []).forEach(k => assert.ok(k.t >= 0 && k.t <= shot.timelineEnd - shot.timelineStart + 1e-6, op.type + ' clé hors plan : ' + k.t));
    if (op.type === 'punch') { const last = op.keys[op.keys.length - 1]; assert.ok(last.scale === 1 && op.keys.some(k => k.scale > 1)); }
  });
});

test('un seul effet d\'accent par plan, pas dans les sections calmes', () => {
  const seen = {};
  fx.ops.filter(o => o.type === 'punch' || o.type === 'shake').forEach(o => {
    assert.ok(!seen[o.start], 'doublon'); seen[o.start] = true;
    const shot = plan.shots.find(s => s.timelineStart === o.start);
    assert.ok(!/intro|calme|outro|pause/.test(shot.sectionType));
  });
});

test('flash au drop tombe sur le premier plan du drop', () => {
  const drop = plan.sections.find(s => s.drop);
  const flash = fx.ops.find(o => o.name === 'dipWhite');
  const shot = plan.shots.find(s => s.timelineStart === flash.start);
  assert.ok(Math.abs(shot.start - drop.start) < 1e-6);
});

test('tout désactivé → aucune opération', () => {
  const none = E.planEffects(plan, an, 25, { punch: false, shake: false, kenburns: false, flash: false, dissolve: false, fadeInOut: false, pulse: false });
  assert.strictEqual(none.ops.length, 0);
});
