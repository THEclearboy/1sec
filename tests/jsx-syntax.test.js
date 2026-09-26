// Vérifie que jsx/host.jsx reste compatible ExtendScript (ES3) : syntaxe + API ES5 interdites.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../jsx/host.jsx', 'utf8');

test('host.jsx : syntaxe ES3', () => {
  let acorn;
  try { acorn = require('acorn'); } catch (e) { return; } // npm install pour activer
  assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: 3 }));
});

test('host.jsx : pas d\'API ES5+ absente d\'ExtendScript', () => {
  const banned = [/\.trim\(/, /Object\.keys/, /Date\.now/, /Array\.isArray/, /\.forEach\(/, /\.map\(function/, /\.filter\(function/, /\.reduce\(/, /\bJSON\.(parse|stringify)\(/, /\.bind\(/, /padStart|padEnd|includes\(/];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  banned.forEach(re => assert.ok(!re.test(code), 'API non ExtendScript : ' + re));
  // indexOf uniquement sur des chaînes (Array.indexOf n'existe pas)
  const arrIdx = code.match(/\b(\w+)\.indexOf\(/g) || [];
  arrIdx.forEach(m => assert.ok(!/(Missing|list|items|ids|files)\.indexOf/.test(m), 'Array.indexOf : ' + m));
});
