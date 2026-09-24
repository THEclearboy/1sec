/*
 * 1SEC — Colorimétrie
 * -------------------
 * 1. analyzeImage   : statistiques d'une image (histogramme, balance, dominantes,
 *                     peau, contraste, écrêtage).
 * 2. targetFromReference : direction artistique extraite d'une image de référence.
 * 3. LOOKS          : directions artistiques prédéfinies.
 * 4. gradeShot      : correction primaire + look → paramètres Lumetri d'un plan.
 * 5. previewGrade   : simulation approximative du rendu (pour l'aperçu).
 *
 * Module pur : fonctionne dans le panneau et dans Node (tests) sur des ImageData
 * ({ width, height, data: Uint8ClampedArray RGBA }).
 */
(function (root, factory) {
  var api = factory();
  root.OneSecColor = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------- couleur

  function rgb2hsv(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: max > 0 ? d / max : 0, v: max };
  }

  function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  function isSkin(r, g, b) {
    // Règle simple (Kovac) sur RGB 0..255
    return r > 95 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15 && Math.max(r, g, b) - Math.min(r, g, b) > 15;
  }

  // ---------------------------------------------------------------- analyse

  /** Zone utile de l'image : retire les bandes noires (letterbox / pillarbox). */
  function contentBox(img) {
    var d = img.data, w = img.width, h = img.height, thr = 12;
    function rowDark(y) { var s = 0, n = 0; for (var x = 0; x < w; x += 2) { var i = (y * w + x) * 4; s += d[i] + d[i + 1] + d[i + 2]; n++; } return s / n / 3 < thr; }
    function colDark(x) { var s = 0, n = 0; for (var y = 0; y < h; y += 2) { var i = (y * w + x) * 4; s += d[i] + d[i + 1] + d[i + 2]; n++; } return s / n / 3 < thr; }
    var y0 = 0, y1 = h, x0 = 0, x1 = w;
    while (y0 < h - 8 && rowDark(y0)) y0++;
    while (y1 > y0 + 8 && rowDark(y1 - 1)) y1--;
    while (x0 < w - 8 && colDark(x0)) x0++;
    while (x1 > x0 + 8 && colDark(x1 - 1)) x1--;
    if ((y1 - y0) * (x1 - x0) < w * h * 0.05) return { x0: 0, y0: 0, x1: w, y1: h };
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /** Statistiques d'une image. step = sous-échantillonnage des pixels. */
  function analyzeImage(img, step, box) {
    step = step || 2;
    var d = img.data, w = img.width, h = img.height;
    box = box || contentBox(img);
    var hist = new Float64Array(256);
    var n = 0, sr = 0, sg = 0, sb = 0, sSat = 0, sLum = 0;
    var shR = 0, shG = 0, shB = 0, shN = 0, hiR = 0, hiG = 0, hiB = 0, hiN = 0;
    var midR = 0, midG = 0, midB = 0, midN = 0;
    var skinN = 0, skinH = 0, skinS = 0;
    var clipB = 0, clipW = 0;
    var hueBins = new Float64Array(12);
    for (var y = box.y0; y < box.y1; y += step) {
      for (var x = box.x0; x < box.x1; x += step) {
        var i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        var L = luma(r, g, b);
        hist[Math.round(L)]++;
        n++; sr += r; sg += g; sb += b; sLum += L;
        var hsv = rgb2hsv(r / 255, g / 255, b / 255);
        sSat += hsv.s;
        if (hsv.s > 0.15 && hsv.v > 0.1) hueBins[Math.floor(hsv.h / 30) % 12] += hsv.s;
        if (L < 70) { shR += r; shG += g; shB += b; shN++; }
        else if (L > 180) { hiR += r; hiG += g; hiB += b; hiN++; }
        else { midR += r; midG += g; midB += b; midN++; }
        if (L <= 3) clipB++;
        if (L >= 252) clipW++;
        if (isSkin(r, g, b)) { skinN++; skinH += hsv.h; skinS += hsv.s; }
      }
    }
    n = n || 1;
    var cum = 0, p = {}, wanted = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99], wi = 0;
    for (var v = 0; v < 256 && wi < wanted.length; v++) {
      cum += hist[v];
      while (wi < wanted.length && cum / n >= wanted[wi]) { p['p' + Math.round(wanted[wi] * 100)] = v; wi++; }
    }
    while (wi < wanted.length) { p['p' + Math.round(wanted[wi] * 100)] = 255; wi++; }
    var mr = sr / n, mg = sg / n, mb = sb / n;
    var meanL = luma(mr, mg, mb) || 1;
    function cast(R, G, B, N) {
      if (!N) return { warm: 0, tint: 0 };
      R /= N; G /= N; B /= N;
      var l = luma(R, G, B) || 1;
      return { warm: (R - B) / l, tint: (G - (R + B) / 2) / l };
    }
    var dominant = 0;
    for (var k = 1; k < 12; k++) if (hueBins[k] > hueBins[dominant]) dominant = k;
    return {
      width: w, height: h, box: box,
      mean: { r: mr, g: mg, b: mb, luma: sLum / n },
      p: p,
      contrast: (p.p95 - p.p5) / 255,
      // Balance globale : > 0 chaud (rouge), < 0 froid (bleu) ; teinte > 0 vert, < 0 magenta
      warm: (mr - mb) / meanL,
      tint: (mg - (mr + mb) / 2) / meanL,
      saturation: sSat / n,
      shadows: cast(shR, shG, shB, shN),
      mids: cast(midR, midG, midB, midN),
      highlights: cast(hiR, hiG, hiB, hiN),
      skin: { ratio: skinN / n, hue: skinN ? skinH / skinN : null, sat: skinN ? skinS / skinN : null },
      clipped: { black: clipB / n, white: clipW / n },
      dominantHue: dominant * 30 + 15,
      colorfulness: Array.prototype.reduce.call(hueBins, function (s, x) { return s + x; }, 0) / n
    };
  }

  // ---------------------------------------------------------------- looks

  /**
   * Un look = cible de rendu.
   *  warm       : balance visée (-1 froid … +1 chaud, en unités « warm » d'analyse ≈ 0.1 par cran)
   *  contrast   : contraste visé (p95-p5 normalisé, 0.55 = doux, 0.8 = punchy)
   *  median     : luminosité médiane visée (0..1)
   *  saturation : saturation moyenne visée (0..1, ~0.3 typique)
   *  shadowHue / shadowStrength, highlightHue / highlightStrength : teintes ombres / hautes lumières
   *  fade       : noirs relevés (0..1), vignette (0..1), sharpen (0..1), vibranceBias (-1..1)
   */
  var LOOKS = {
    naturel: { label: 'Naturel équilibré', desc: 'Raccord propre, couleurs fidèles, léger punch.', warm: 0.02, contrast: 0.7, median: 0.42, saturation: 0.3, shadowHue: null, shadowStrength: 0, highlightHue: null, highlightStrength: 0, fade: 0, vignette: 0.15, sharpen: 0.1, vibranceBias: 0.1 },
    cinema_chaud: { label: 'Cinéma chaud', desc: 'Doré, ombres douces, hautes lumières crème.', warm: 0.14, contrast: 0.66, median: 0.4, saturation: 0.28, shadowHue: 25, shadowStrength: 0.25, highlightHue: 45, highlightStrength: 0.3, fade: 0.15, vignette: 0.35, sharpen: 0, vibranceBias: 0 },
    teal_orange: { label: 'Teal & Orange', desc: 'Ombres cyan, peaux orangées, très « blockbuster ».', warm: 0.06, contrast: 0.78, median: 0.4, saturation: 0.34, shadowHue: 195, shadowStrength: 0.45, highlightHue: 35, highlightStrength: 0.35, fade: 0.05, vignette: 0.3, sharpen: 0.15, vibranceBias: 0.2 },
    froid_nuit: { label: 'Froid / Nuit', desc: 'Bleu acier, contraste marqué, ambiance sombre.', warm: -0.14, contrast: 0.8, median: 0.32, saturation: 0.24, shadowHue: 220, shadowStrength: 0.45, highlightHue: 205, highlightStrength: 0.15, fade: 0.05, vignette: 0.45, sharpen: 0.1, vibranceBias: -0.1 },
    punchy: { label: 'Punchy sport', desc: 'Contraste fort, couleurs vives, net : clips réseaux.', warm: 0.04, contrast: 0.86, median: 0.44, saturation: 0.4, shadowHue: null, shadowStrength: 0, highlightHue: null, highlightStrength: 0, fade: 0, vignette: 0.2, sharpen: 0.35, vibranceBias: 0.4 },
    vintage: { label: 'Vintage / pellicule', desc: 'Noirs délavés, vert-jaune dans les ombres, doux.', warm: 0.1, contrast: 0.55, median: 0.45, saturation: 0.22, shadowHue: 80, shadowStrength: 0.3, highlightHue: 40, highlightStrength: 0.25, fade: 0.45, vignette: 0.4, sharpen: 0, vibranceBias: -0.2 },
    desature: { label: 'Désaturé dramatique', desc: 'Presque monochrome, contraste dur, ombres froides.', warm: -0.04, contrast: 0.85, median: 0.36, saturation: 0.12, shadowHue: 215, shadowStrength: 0.25, highlightHue: null, highlightStrength: 0, fade: 0.1, vignette: 0.5, sharpen: 0.2, vibranceBias: -0.3 },
    noir_blanc: { label: 'Noir & blanc', desc: 'Monochrome contrasté, grain de contraste.', warm: 0, contrast: 0.85, median: 0.4, saturation: 0, shadowHue: null, shadowStrength: 0, highlightHue: null, highlightStrength: 0, fade: 0.08, vignette: 0.4, sharpen: 0.2, vibranceBias: 0 }
  };
  var LOOK_ORDER = ['naturel', 'cinema_chaud', 'teal_orange', 'froid_nuit', 'punchy', 'vintage', 'desature', 'noir_blanc'];

  /** Direction artistique déduite d'une image de référence. */
  function targetFromReference(img) {
    var st = analyzeImage(img, 2);
    function tint(c, minStrength) {
      var s = Math.sqrt(c.warm * c.warm + c.tint * c.tint);
      if (s < 0.06) return { hue: null, strength: 0 };
      // hue à partir des composantes chaud/teinte (approx.)
      var hue = (Math.atan2(-c.tint, c.warm) * 180 / Math.PI + 360) % 360;
      // ramène dans un espace teinte proche de HSV : chaud=0→30°, froid=180→210°
      hue = (hue * 0.5 + (c.warm >= 0 ? 15 : 200)) % 360;
      if (c.warm < 0) hue = 180 + (c.tint > 0 ? -20 : 25);
      else hue = c.tint > 0 ? 55 : 25;
      return { hue: hue, strength: clamp(s * 2.5, minStrength || 0, 0.6) };
    }
    var sh = tint(st.shadows), hi = tint(st.highlights);
    return {
      label: 'Image de référence', desc: 'Rendu extrait de votre image.',
      warm: clamp(st.warm, -0.3, 0.3),
      contrast: clamp(st.contrast, 0.35, 0.95),
      median: clamp(st.p.p50 / 255, 0.2, 0.65),
      saturation: clamp(st.saturation, 0, 0.6),
      shadowHue: sh.hue, shadowStrength: sh.strength,
      highlightHue: hi.hue, highlightStrength: hi.strength,
      fade: clamp(st.p.p1 / 40, 0, 0.6),
      vignette: 0.25, sharpen: 0.1, vibranceBias: 0,
      stats: st
    };
  }

  // ---------------------------------------------------------------- grade

  /**
   * Calcule les paramètres Lumetri d'un plan.
   * @param stats   analyzeImage du plan
   * @param look    cible (LOOKS[x] ou targetFromReference)
   * @param opts    { matchStrength (0..1), lookIntensity (0..1.5), protectSkin (bool),
   *                  adjust: { warm, contrast, saturation, exposure, vignette, shadowStrength, highlightStrength } }
   */
  function gradeShot(stats, look, opts) {
    opts = opts || {};
    var match = opts.matchStrength == null ? 0.8 : opts.matchStrength;
    var inten = opts.lookIntensity == null ? 1 : opts.lookIntensity;
    var adj = Object.assign({ warm: 0, contrast: 0, saturation: 0, exposure: 0, vignette: 0, shadowStrength: 0, highlightStrength: 0 }, opts.adjust || {});
    var protect = opts.protectSkin !== false && stats.skin.ratio > 0.02;

    // ---- Correction primaire (raccord), dans l'ordre d'un étalonneur :
    // 1) point noir / point blanc, 2) exposition sur la médiane obtenue, 3) contraste.
    var blackPt = stats.p.p1 / 255, whitePt = stats.p.p99 / 255;
    var targetBlack = 0.02 + look.fade * 0.08, targetWhite = 0.96;
    // Modèle : Noirs / Blancs déplacent le point noir / blanc d'environ 0,25 pour 100.
    var K = 0.25 / 100;
    var blacks = clamp((targetBlack - blackPt) / K * match, -60, 60);
    var whites = clamp((targetWhite - whitePt) / K * match, -50, 50);
    var lo = -blacks * K, hiPt = 1 - whites * K;
    // Médiane et contraste une fois la plage déplacée ; l'exposition fait le reste
    var medianAfter = clamp((stats.p.p50 / 255 - lo) / (hiPt - lo), 0.02, 0.98);
    var exposure = clamp(Math.log(look.median / medianAfter) / Math.LN2 * match, -1.6, 1.6) + adj.exposure;
    var contrastAfter = clamp(stats.contrast / (hiPt - lo) * Math.pow(2, exposure * 0.5), 0, 1);
    var contrast = clamp((look.contrast - contrastAfter) * 90 * match + adj.contrast * 40, -40, 50);
    // Balance : neutralise une part de la dominante puis vise la chaleur du look
    var warmDelta = (look.warm + adj.warm * 0.1) - stats.warm;
    var temperature = clamp(warmDelta * 220 * lerp(0.5, 1, match) * (0.6 + 0.4 * inten), -60, 60);
    var tintV = clamp(-stats.tint * 200 * match, -30, 30);
    if (protect) { temperature *= 0.7; tintV *= 0.7; }

    // ---- Look créatif, adapté à ce plan
    var satDelta = (look.saturation - stats.saturation);
    var saturation = clamp(100 + (satDelta * 180 + adj.saturation * 30) * inten, 0, 180);
    if (look.saturation === 0) saturation = 0;
    var vibrance = clamp(look.vibranceBias * 40 * inten + (stats.colorfulness < 0.08 ? 10 : 0), -40, 50);
    if (protect && vibrance > 0) vibrance *= 0.8;
    var faded = clamp(look.fade * 60 * inten, 0, 70);
    var sharpen = clamp(look.sharpen * 60 * inten, 0, 60);
    var shStr = clamp(look.shadowStrength + adj.shadowStrength * 0.2, 0, 0.8) * inten;
    var hiStr = clamp(look.highlightStrength + adj.highlightStrength * 0.2, 0, 0.8) * inten;
    var highlights = clamp(-(stats.clipped.white * 400) - (look.contrast > 0.75 ? 0 : 8) , -40, 10);
    var shadowsV = clamp(look.fade * 20 - (stats.clipped.black * 300), -30, 30);
    var vig = clamp(look.vignette + adj.vignette * 0.25, 0, 1) * inten;

    var params = {
      temperature: round(temperature), tint: round(tintV),
      exposure: round(exposure, 2), contrast: round(contrast),
      highlights: round(highlights), shadows: round(shadowsV),
      whites: round(whites), blacks: round(blacks),
      saturation: 100,
      fadedFilm: round(faded), sharpen: round(sharpen), vibrance: round(vibrance),
      saturation2: round(saturation),
      vignetteAmount: round(-vig * 2.2, 2), vignetteMidpoint: 50, vignetteRoundness: 0, vignetteFeather: 70
    };
    // Split-toning : décrit pour l'aperçu et pour les roues (appliqué si l'API le permet)
    var toning = {
      shadowHue: look.shadowHue, shadowStrength: shStr,
      highlightHue: look.highlightHue, highlightStrength: hiStr
    };
    return { params: params, toning: toning, protectSkin: protect };
  }

  function round(v, d) { var m = Math.pow(10, d || 0); return (Math.round(v * m) / m) + 0 || 0; }

  // ---------------------------------------------------------------- aperçu

  function hueToRgb(h) {
    var c = rgb2hsvInv(h, 1, 1);
    return c;
  }
  function rgb2hsvInv(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  /**
   * Simulation approximative de Lumetri sur une ImageData (modifiée en place).
   * Suffisant pour juger la direction : pas une reproduction exacte de Premiere.
   */
  function previewGrade(img, grade, box) {
    var p = grade.params, t = grade.toning, d = img.data, w = img.width, h = img.height;
    box = box || { x0: 0, y0: 0, x1: w, y1: h };
    var gainExp = Math.pow(2, p.exposure);
    var temp = p.temperature / 100, tint = p.tint / 100;
    var wbR = 1 + temp * 0.35 - tint * 0.08, wbG = 1 + tint * 0.2, wbB = 1 - temp * 0.35 - tint * 0.08;
    var contrast = p.contrast / 100, blacks = p.blacks / 100, whites = p.whites / 100;
    var hi = p.highlights / 100, sh = p.shadows / 100;
    var sat = (p.saturation / 100) * (p.saturation2 / 100);
    var vib = p.vibrance / 100, fade = p.fadedFilm / 100;
    var vigAmt = -p.vignetteAmount / 5, feather = p.vignetteFeather / 100;
    var shRGB = t.shadowHue != null ? rgb2hsvInv(t.shadowHue, 1, 1) : [1, 1, 1];
    var hiRGB = t.highlightHue != null ? rgb2hsvInv(t.highlightHue, 1, 1) : [1, 1, 1];
    var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, rad = Math.sqrt(Math.pow((box.x1 - box.x0) / 2, 2) + Math.pow((box.y1 - box.y0) / 2, 2));
    for (var y = box.y0; y < box.y1; y++) {
      var vy = (y - cy) / rad;
      for (var x = box.x0; x < box.x1; x++) {
        var i = (y * w + x) * 4;
        var r = d[i] / 255 * wbR, g = d[i + 1] / 255 * wbG, b = d[i + 2] / 255 * wbB;
        // noirs / blancs (points) et contraste (courbe en S autour de 0.5)
        var lo = -blacks * 0.25, hiPt = 1 - whites * 0.25;
        r = (r - lo) / (hiPt - lo) * gainExp; g = (g - lo) / (hiPt - lo) * gainExp; b = (b - lo) / (hiPt - lo) * gainExp;
        var L = luma(r, g, b);
        var k = 1 + contrast * 0.9;
        var Lc = clamp(0.5 + (L - 0.5) * k, -0.2, 1.2);
        // tons clairs / foncés
        Lc += hi * 0.25 * smooth((L - 0.5) * 2) + sh * 0.25 * smooth((0.5 - L) * 2);
        // fade : relève les noirs
        Lc = Lc * (1 - fade * 0.18) + fade * 0.18;
        var ratio = L > 0.001 ? Lc / L : 1;
        r *= ratio; g *= ratio; b *= ratio;
        // saturation / vibrance
        var Lg = luma(r, g, b);
        var maxc = Math.max(r, g, b), minc = Math.min(r, g, b), s0 = maxc > 0 ? (maxc - minc) / maxc : 0;
        var satK = sat + vib * (1 - s0) * 0.8;
        r = Lg + (r - Lg) * satK; g = Lg + (g - Lg) * satK; b = Lg + (b - Lg) * satK;
        // split toning
        var wsh = t.shadowStrength * smooth(1 - Lg * 1.6), whi = t.highlightStrength * smooth((Lg - 0.45) * 2);
        r = r * (1 - wsh * 0.5) + wsh * 0.5 * Lg * (0.6 + shRGB[0] * 0.8);
        g = g * (1 - wsh * 0.5) + wsh * 0.5 * Lg * (0.6 + shRGB[1] * 0.8);
        b = b * (1 - wsh * 0.5) + wsh * 0.5 * Lg * (0.6 + shRGB[2] * 0.8);
        r = r * (1 - whi * 0.4) + whi * 0.4 * Lg * (0.7 + hiRGB[0] * 0.6);
        g = g * (1 - whi * 0.4) + whi * 0.4 * Lg * (0.7 + hiRGB[1] * 0.6);
        b = b * (1 - whi * 0.4) + whi * 0.4 * Lg * (0.7 + hiRGB[2] * 0.6);
        // vignette
        var vx = (x - cx) / rad, dist = Math.sqrt(vx * vx + vy * vy);
        var vg = 1 - vigAmt * smooth((dist - 0.45) / Math.max(0.2, feather));
        r *= vg; g *= vg; b *= vg;
        d[i] = clamp(r, 0, 1) * 255; d[i + 1] = clamp(g, 0, 1) * 255; d[i + 2] = clamp(b, 0, 1) * 255;
      }
    }
    return img;
  }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // ---------------------------------------------------------------- sujet

  /**
   * Position probable du sujet (0..1 en x et y, dans la zone utile) :
   * carte d'intérêt = contraste local + peau + saturation, pondérée vers le centre.
   */
  function findSubject(img, box) {
    box = box || contentBox(img);
    var d = img.data, w = img.width;
    var bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    var cols = new Float64Array(bw), rows = new Float64Array(bh), total = 0;
    for (var y = box.y0 + 1; y < box.y1 - 1; y += 2) {
      for (var x = box.x0 + 1; x < box.x1 - 1; x += 2) {
        var i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        var L = luma(r, g, b);
        var Lr = luma(d[i + 8], d[i + 9], d[i + 10]), Ld = luma(d[i + w * 8], d[i + w * 8 + 1], d[i + w * 8 + 2]);
        var grad = Math.abs(L - Lr) + Math.abs(L - Ld);
        var hsv = rgb2hsv(r / 255, g / 255, b / 255);
        var v = grad / 255 + hsv.s * 0.5 + (isSkin(r, g, b) ? 1.2 : 0);
        var cxn = ((x - box.x0) / bw - 0.5) * 2, cyn = ((y - box.y0) / bh - 0.5) * 2;
        v *= 1 - 0.35 * (cxn * cxn + cyn * cyn) / 2; // léger a priori centré
        cols[x - box.x0] += v; rows[y - box.y0] += v; total += v;
      }
    }
    var sm = movingAvg(cols, Math.max(3, Math.round(bw * 0.12)));
    var smr = movingAvg(rows, Math.max(3, Math.round(bh * 0.12)));
    var bx = 0, by = 0;
    for (var k = 1; k < bw; k++) if (sm[k] > sm[bx]) bx = k;
    for (k = 1; k < bh; k++) if (smr[k] > smr[by]) by = k;
    var peak = sm[bx], mean = total / bw;
    return { x: bx / bw, y: by / bh, confidence: clamp((peak / (mean || 1) - 1) / 1.5, 0, 1) };
  }
  function movingAvg(a, win) {
    var out = new Float64Array(a.length), half = Math.floor(win / 2);
    for (var i = 0; i < a.length; i++) {
      var s = 0, n = 0;
      for (var k = -half; k <= half; k++) { var j = i + k; if (j >= 0 && j < a.length) { s += a[j]; n++; } }
      out[i] = s / n;
    }
    return out;
  }

  /**
   * Cadrage fixe d'un média (mw×mh) dans une séquence (sw×sh) en remplissant le cadre.
   * subject : { x, y } 0..1 ; retourne { scale (%), x, y (px séquence), crop: fenêtre visible dans le média (0..1) }
   */
  function fitFraming(mw, mh, sw, sh, subject, bias) {
    subject = subject || { x: 0.5, y: 0.5 };
    bias = bias || { x: 0, y: 0 };
    var scale = Math.max(sw / mw, sh / mh);
    var vw = mw * scale, vh = mh * scale; // taille du média une fois mis à l'échelle
    var sx = clamp(subject.x + bias.x * 0.5, 0, 1), sy = clamp(subject.y + bias.y * 0.5, 0, 1);
    var maxDx = (vw - sw) / 2, maxDy = (vh - sh) / 2;
    var dx = clamp((0.5 - sx) * vw, -maxDx, maxDx), dy = clamp((0.5 - sy) * vh, -maxDy, maxDy);
    var x = sw / 2 + dx, y = sh / 2 + dy;
    var cropX0 = (0.5 - 0.5 * sw / vw) - dx / vw, cropY0 = (0.5 - 0.5 * sh / vh) - dy / vh;
    return { scale: Math.round(scale * 10000) / 100, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      crop: { x0: cropX0, y0: cropY0, x1: cropX0 + sw / vw, y1: cropY0 + sh / vh } };
  }

  return {
    analyzeImage: analyzeImage,
    contentBox: contentBox,
    findSubject: findSubject,
    fitFraming: fitFraming,
    targetFromReference: targetFromReference,
    gradeShot: gradeShot,
    previewGrade: previewGrade,
    LOOKS: LOOKS,
    LOOK_ORDER: LOOK_ORDER
  };
});
