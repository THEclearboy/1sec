const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/audio-analysis.js');
const T = require('../js/text-planner.js');
const { synthSong } = require('./synth.js');
const song = synthSong({ bpm: 128 });
const an = A.analyze([song.data], song.sr, { sensitivity: 0.8 });
const beat = 60 / an.bpm;

test('mode empilé : les mots s\'accumulent, dernier mot en avant, un mot par temps', () => {
  const cards = T.planTexts(['Tu consommes plus que tu crées.', 'Tu scrolles et tu appelles ça recherche.'], an, { mode: 'stack', from: 0, to: 30, wordsPerBeat: 1, timelineOffset: 10 });
  assert.strictEqual(cards.length, 6 + 7);
  assert.deepStrictEqual(cards[2].lines.map(l => l.text), ['Tu', 'consommes', 'plus']);
  assert.ok(cards[5].lines[5].emphasis && !cards[5].lines[0].emphasis);
  for (let i = 1; i < 6; i++) assert.ok(Math.abs((cards[i].start - cards[i - 1].start) - beat) < 0.06, 'un temps entre les mots');
  assert.ok(cards[5].end - cards[5].start > beat * 1.5, 'le dernier état tient');
  assert.ok(cards[6].start >= cards[5].end + beat - 0.02, 'pause entre les phrases');
  cards.forEach(c => { assert.ok(c.end > c.start); assert.strictEqual(c.timelineStart, c.start + 10); });
});

test('mode mot à mot : une ligne par carte', () => {
  const cards = T.planTexts(['Regarde jusqu\'à la fin'], an, { mode: 'word', from: 0, to: 10, wordsPerBeat: 2 });
  assert.strictEqual(cards.length, 4);
  cards.forEach(c => assert.strictEqual(c.lines.length, 1));
  assert.ok(Math.abs((cards[1].start - cards[0].start) - beat / 2) < 0.02, 'demi-temps');
});

test('densité auto : beaucoup de mots sur peu de temps → demi-temps', () => {
  const many = ['un deux trois quatre cinq six sept huit neuf dix onze douze'];
  const c = T.planTexts(many, an, { mode: 'word', from: 0, to: 4 });
  assert.ok(c.length >= 8);
  assert.ok(c[c.length - 1].start <= 4.01);
});

test('fenêtre hook', () => {
  const w = T.hookWindow(an, 3);
  assert.ok(w.start === 0 && w.end > 0 && w.end <= 3);
});

test('mode dynamique : groupes de 1-3 mots, tailles et positions variées, mots-outils accrochés', () => {
  const cards = T.planDynamic(['Tu consommes *plus* que tu ne crées.', 'Tu scrolles pendant des HEURES et tu appelles ça de la recherche.'], an, { from: 0, to: 30, seed: 3 });
  assert.ok(cards.length >= 6 && cards.length <= 14, cards.length + ' groupes');
  cards.forEach(c => { assert.ok(c.words.length >= 1 && c.words.length <= 4); assert.ok(c.end > c.start); });
  // aucun groupe ne commence par un mot-outil seul ("de", "la") sauf le tout premier
  cards.slice(1).forEach(c => { if (c.words.length === 1) assert.ok(!/^(de|la|que|tu|et)$/i.test(c.words[0].text), 'mot-outil isolé : ' + c.words[0].text); });
  const sizes = new Set(), ys = new Set();
  cards.forEach(c => c.lines.forEach(l => l.words.forEach(w => sizes.add(w.size))));
  cards.forEach(c => ys.add(Math.round(c.y * 20)));
  assert.ok(sizes.size >= 3, 'tailles variées'); assert.ok(ys.size >= 3, 'positions variées');
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].start >= cards[i - 1].end - 1e-6, 'pas de chevauchement');
  const plus = cards.find(c => c.words.some(w => w.text === 'plus'));
  assert.ok(plus.impact > 0.7, '*plus* est fort : ' + plus.impact);
  const heures = cards.find(c => c.words.some(w => w.text === 'HEURES'));
  assert.ok(heures.y > 0.4 && heures.y < 0.6, 'mot fort au centre');
});

test('impact des mots', () => {
  assert.ok(T.wordImpact('de', 1, 5) < 0.2);
  assert.ok(T.wordImpact('recherche.', 4, 5) > 0.6);
  assert.ok(T.wordImpact('*jamais*', 1, 5) > 0.7);
});
