/*
 * 1SEC — Rendu des textes en PNG transparent (canvas, navigateur uniquement)
 * renderCard(card, style, w, h) → canvas
 */
(function (root) {
  'use strict';

  var STYLES = {
    impact: { label: 'Impact', font: '"Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif', weight: 800, color: '#ffffff', shadow: 0.55, stroke: 0, upper: false, letter: -0.02 },
    clean: { label: 'Épuré', font: '"Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif', weight: 700, color: '#ffffff', shadow: 0.35, stroke: 0, upper: false, letter: -0.01 },
    caps: { label: 'Capitales', font: '"Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif', weight: 900, color: '#ffffff', shadow: 0.5, stroke: 0, upper: true, letter: 0.02 },
    outline: { label: 'Contour', font: '"Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif', weight: 800, color: '#ffffff', shadow: 0.2, stroke: 1, upper: false, letter: -0.02 },
    yellow: { label: 'Jaune', font: '"Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif', weight: 800, color: '#ffe23a', shadow: 0.6, stroke: 0, upper: true, letter: 0 }
  };

  /**
   * @param card   { lines: [{ text, emphasis }] }
   * @param style  { preset, fontFamily?, size (0..1 = hauteur de ligne relative à la largeur), y (0..1 centre vertical), emphasisScale, maxWidth (0..1), color? }
   */
  /** Normalise une carte (ancien format lines[{text,emphasis}] ou nouveau lines[{words:[{text,size}]}]). */
  function normalize(card) {
    return card.lines.map(function (l) {
      if (l.words) return l;
      return { words: [{ text: l.text, size: l.emphasis ? null : 1, emphasis: !!l.emphasis }] };
    });
  }

  function renderCard(card, style, w, h) {
    var p = Object.assign({}, STYLES[style.preset] || STYLES.impact);
    if (style.fontFamily) p.font = '"' + style.fontFamily + '", ' + p.font;
    if (style.color) p.color = style.color;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);
    var base = w * (style.size || 0.085);
    var emph = style.emphasisScale || 1.5;
    var maxW = w * (style.maxWidth || 0.86);
    var lines = normalize(card).map(function (l) {
      var words = l.words.map(function (wd) {
        var txt = p.upper ? wd.text.toUpperCase() : wd.text;
        var size = base * (wd.size != null ? wd.size : (wd.emphasis ? emph : 1));
        g.font = p.weight + ' ' + size + 'px ' + p.font;
        return { text: txt, size: size, width: g.measureText(txt).width * (1 + p.letter) };
      });
      var space = words[0].size * 0.28;
      var tw = words.reduce(function (n, x) { return n + x.width; }, 0) + space * (words.length - 1);
      if (tw > maxW) { var k = maxW / tw; words.forEach(function (x) { x.size *= k; x.width *= k; }); space *= k; tw = maxW; }
      var maxSize = Math.max.apply(null, words.map(function (x) { return x.size; }));
      return { words: words, width: tw, space: space, height: maxSize };
    });
    var lh = 0.92, total = 0;
    lines.forEach(function (l) { total += l.height * lh; });
    var cx = w * (card.x == null ? 0.5 : card.x), cy = h * (card.y != null ? card.y : (style.y == null ? 0.5 : style.y));
    var align = card.align || 'center';
    var blockW = Math.max.apply(null, lines.map(function (l) { return l.width; }));
    g.save();
    g.translate(cx, cy);
    if (card.rotate) g.rotate(card.rotate * Math.PI / 180);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    var y = -total / 2;
    lines.forEach(function (l) {
      var x0 = align === 'left' ? -blockW / 2 : align === 'right' ? blockW / 2 - l.width : -l.width / 2;
      var by = y + l.height * lh * 0.8;
      l.words.forEach(function (wd) {
        g.font = p.weight + ' ' + wd.size + 'px ' + p.font;
        try { g.letterSpacing = (p.letter * wd.size) + 'px'; } catch (e) {}
        if (p.shadow) {
          g.save();
          g.shadowColor = 'rgba(0,0,0,' + p.shadow + ')'; g.shadowBlur = wd.size * 0.25; g.shadowOffsetY = wd.size * 0.04;
          g.fillStyle = p.color; g.fillText(wd.text, x0, by);
          g.restore();
        }
        if (p.stroke) { g.lineWidth = wd.size * 0.08 * p.stroke; g.strokeStyle = 'rgba(0,0,0,.9)'; g.lineJoin = 'round'; g.strokeText(wd.text, x0, by); }
        g.fillStyle = p.color; g.fillText(wd.text, x0, by);
        x0 += wd.width + l.space;
      });
      y += l.height * lh;
    });
    g.restore();
    return cv;
  }

  function toPngBase64(cv) { return cv.toDataURL('image/png').split(',')[1]; }

  root.OneSecTextRender = { renderCard: renderCard, toPngBase64: toPngBase64, STYLES: STYLES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
