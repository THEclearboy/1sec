const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/color-grade.js');

function img(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x / w, y / h); const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
const dark = img(64, 64, (x, y) => [40 + x * 60, 40 + x * 60, 60 + x * 60]);        // sombre, bleuté
const bright = img(64, 64, (x, y) => [150 + x * 100, 130 + x * 100, 90 + x * 100]); // clair, chaud
const flat = img(64, 64, () => [120, 120, 120]);

test('analyse : luminosité, chaleur, contraste', () => {
  const a = C.analyzeImage(dark, 1), b = C.analyzeImage(bright, 1), f = C.analyzeImage(flat, 1);
  assert.ok(a.p.p50 < b.p.p50);
  assert.ok(a.warm < 0 && b.warm > 0);
  assert.ok(f.contrast < 0.05 && a.contrast > 0.15);
  assert.ok(b.skin.ratio > 0.5, 'peau ' + b.skin.ratio);
});

test('raccord : le plan sombre est éclairci, le clair assombri, vers la même médiane', () => {
  const look = C.LOOKS.naturel;
  const ga = C.gradeShot(C.analyzeImage(dark, 1), look, { matchStrength: 1 });
  const gb = C.gradeShot(C.analyzeImage(bright, 1), look, { matchStrength: 1 });
  assert.ok(ga.params.exposure > 0.3, 'expo sombre ' + ga.params.exposure);
  assert.ok(gb.params.exposure < -0.3, 'expo clair ' + gb.params.exposure);
  assert.ok(ga.params.temperature > gb.params.temperature); // le bleu est réchauffé plus que le chaud
  assert.ok(gb.protectSkin);
});

test('le look influence la direction : froid < naturel < chaud en température', () => {
  const st = C.analyzeImage(flat, 1);
  const t = k => C.gradeShot(st, C.LOOKS[k], {}).params.temperature;
  assert.ok(t('froid_nuit') < t('naturel') && t('naturel') < t('cinema_chaud'));
  assert.strictEqual(C.gradeShot(st, C.LOOKS.noir_blanc, {}).params.saturation2, 0);
});

test('intensité 0 = pas de look, mais le raccord reste', () => {
  const st = C.analyzeImage(dark, 1);
  const g = C.gradeShot(st, C.LOOKS.teal_orange, { lookIntensity: 0 });
  assert.strictEqual(g.params.vignetteAmount, 0);
  assert.strictEqual(g.toning.shadowStrength, 0);
  assert.ok(g.params.exposure > 0);
});

test('image de référence → cible cohérente', () => {
  const t = C.targetFromReference(bright);
  assert.ok(t.warm > 0.05 && t.median > 0.5);
  const g = C.gradeShot(C.analyzeImage(dark, 1), t, {});
  assert.ok(g.params.temperature > 20 && g.params.exposure > 0.5);
});

test('aperçu : plus clair après exposition positive, désaturé en N&B', () => {
  const before = C.analyzeImage(dark, 1);
  const copy = { width: dark.width, height: dark.height, data: new Uint8ClampedArray(dark.data) };
  C.previewGrade(copy, C.gradeShot(before, C.LOOKS.naturel, { matchStrength: 1 }));
  const after = C.analyzeImage(copy, 1);
  assert.ok(after.p.p50 > before.p.p50 + 20);
  const bw = { width: bright.width, height: bright.height, data: new Uint8ClampedArray(bright.data) };
  C.previewGrade(bw, C.gradeShot(C.analyzeImage(bright, 1), C.LOOKS.noir_blanc, {}));
  assert.ok(C.analyzeImage(bw, 1).saturation < 0.02);
});

test('valeurs dans les plages Lumetri', () => {
  const extreme = img(32, 32, () => [255, 0, 0]);
  Object.values(C.LOOKS).forEach(look => {
    const p = C.gradeShot(C.analyzeImage(extreme, 1), look, { matchStrength: 1, lookIntensity: 1.5 }).params;
    assert.ok(Math.abs(p.temperature) <= 100 && Math.abs(p.exposure) <= 5 && p.saturation2 >= 0 && p.saturation2 <= 200 && p.fadedFilm <= 100 && p.vignetteAmount >= -5);
  });
});

test('bandes noires ignorées et sujet trouvé', () => {
  // image 90x160 noire avec une bande 16:9 au milieu, sujet (peau) à droite
  const im = img(90, 160, (x, y) => {
    if (y < 0.34 || y > 0.66) return [0, 0, 0];
    if (Math.abs(x - 0.8) < 0.06 && Math.abs(y - 0.5) < 0.1) return [220, 160, 120];
    return [40, 90, 140];
  });
  const box = C.contentBox(im);
  assert.ok(box.y0 > 50 && box.y1 < 110 && box.x0 === 0, JSON.stringify(box));
  const st = C.analyzeImage(im, 1);
  assert.ok(st.p.p50 > 60, 'médiane sans bandes noires : ' + st.p.p50);
  const sub = C.findSubject(im, box);
  assert.ok(sub.x > 0.65, 'sujet x=' + sub.x);
});

test('cadrage 16:9 → 9:16 : remplit la hauteur et suit le sujet', () => {
  const f = C.fitFraming(3840, 2160, 1080, 1920, { x: 0.8, y: 0.5 });
  assert.ok(Math.abs(f.scale - 88.89) < 0.1, 'scale ' + f.scale);
  assert.ok(f.x < 540, 'décalé vers la gauche pour montrer la droite : ' + f.x);
  assert.ok(f.crop.x1 <= 1.0001 && f.crop.x0 >= 0);
  const c = C.fitFraming(3840, 2160, 1080, 1920, { x: 0.5, y: 0.5 });
  assert.strictEqual(c.x, 540); assert.strictEqual(c.y, 960);
  const far = C.fitFraming(3840, 2160, 1080, 1920, { x: 1, y: 0.5 });
  assert.ok(far.crop.x1 <= 1.0001, 'ne sort pas du média');
});
