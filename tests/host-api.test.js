// Chaque fonction OneSec_* appelée depuis le panneau doit exister dans jsx/host.jsx.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const host = fs.readFileSync(path.join(__dirname, '../jsx/host.jsx'), 'utf8');
const defined = new Set((host.match(/^function (OneSec_\w+)/gm) || []).map(l => l.replace('function ', '')));
const called = new Set();
fs.readdirSync(path.join(__dirname, '../js')).forEach(f => {
  const src = fs.readFileSync(path.join(__dirname, '../js', f), 'utf8');
  (src.match(/call\('(OneSec_\w+)'/g) || []).forEach(m => called.add(m.match(/OneSec_\w+/)[0]));
});
test('toutes les fonctions appelées par le panneau existent dans host.jsx', () => {
  const missing = [...called].filter(f => !defined.has(f));
  assert.deepStrictEqual(missing, [], 'absentes de host.jsx : ' + missing.join(', '));
  assert.ok(called.size > 15, called.size + ' appels trouvés');
});
test('le mode démo couvre toutes les fonctions appelées', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '../js/bridge.js'), 'utf8');
  const missing = [...called].filter(f => !new RegExp(f + ':').test(bridge));
  assert.deepStrictEqual(missing, [], 'sans équivalent démo : ' + missing.join(', '));
});
