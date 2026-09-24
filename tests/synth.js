// Génère une musique synthétique : intro calme, montée, drop intense, outro.
function synthSong(opts) {
  opts = opts || {};
  var sr = opts.sr || 44100, bpm = opts.bpm || 128;
  var parts = opts.parts || [
    { dur: 16, kick: 0.15, hat: 0.0, bass: 0.05, pad: 0.15 },   // intro
    { dur: 15, kick: 0.35, hat: 0.2, bass: 0.15, pad: 0.1, rise: true }, // montée
    { dur: 30, kick: 0.9, hat: 0.5, bass: 0.6, pad: 0.1 },      // drop
    { dur: 12, kick: 0.1, hat: 0.0, bass: 0.0, pad: 0.2 }       // outro
  ];
  var total = parts.reduce(function (s, p) { return s + p.dur; }, 0);
  var n = Math.floor(total * sr), x = new Float32Array(n);
  var beat = 60 / bpm, seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; }
  var t0 = 0;
  parts.forEach(function (p) {
    var s0 = Math.floor(t0 * sr), s1 = Math.floor((t0 + p.dur) * sr);
    for (var i = s0; i < s1; i++) {
      var t = i / sr, lt = t - t0, g = p.rise ? 0.3 + 0.7 * lt / p.dur : 1;
      var bp = (t % beat), hp = (t % (beat / 2));
      var v = 0;
      v += p.kick * g * Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-bp * 30)) * bp) * Math.exp(-bp * 12);
      v += p.hat * g * rnd() * Math.exp(-((hp + beat / 4) % (beat / 2)) * 60) * 0.5;
      v += p.bass * g * Math.sin(2 * Math.PI * 55 * t) * (0.6 + 0.4 * Math.exp(-bp * 4));
      v += p.pad * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 277 * t)) * 0.3;
      x[i] = v * 0.5;
    }
    t0 += p.dur;
  });
  return { data: x, sr: sr, bpm: bpm, parts: parts };
}
module.exports = { synthSong: synthSong };
