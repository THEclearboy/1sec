/*
 * 1SEC — Chargeur à chaud
 * -----------------------
 * Permet de mettre à jour le plugin SANS redémarrer Premiere Pro :
 *  - les scripts du panneau sont chargés avec un paramètre anti-cache ;
 *  - le script ExtendScript (jsx/host.jsx) est ré-évalué via $.evalFile à
 *    chaque chargement du panneau ;
 *  - en mode « rechargement auto », toute modification d'un fichier du plugin
 *    recharge le panneau (et le jsx) automatiquement ;
 *  - le bouton « Mettre à jour » fait un `git pull` puis recharge.
 * Seule une modification de CSXS/manifest.xml demande un redémarrage.
 */
(function () {
  'use strict';

  var SCRIPTS = ['js/audio-analysis.js', 'js/edit-planner.js', 'js/color-grade.js', 'js/bridge.js', 'js/app.js', 'js/app-frames.js', 'js/app-color.js', 'js/app-framing.js', 'js/effects-planner.js', 'js/app-effects.js', 'js/text-planner.js', 'js/text-render.js', 'js/app-text.js'];
  var isCEP = !!(window.__adobe_cep__);
  var nodeRequire = (window.cep_node && window.cep_node.require) || (typeof window.require === 'function' ? window.require : null);

  function extensionRoot() {
    if (!isCEP) return null;
    var p = decodeURI(window.__adobe_cep__.getSystemPath('extension'));
    var isWin = navigator.platform.indexOf('Win') === 0;
    return isWin ? p.replace(/^file:\/\/\//, '') : p.replace(/^file:\/\//, '');
  }

  var root = extensionRoot();

  function evalScript(code) {
    return new Promise(function (resolve) {
      if (!isCEP) return resolve('');
      window.__adobe_cep__.evalScript(code, function (r) { resolve(r); });
    });
  }

  /** Recharge le code ExtendScript (host.jsx) dans Premiere. */
  function loadHost() {
    if (!isCEP) return Promise.resolve(true);
    var file = (root + '/jsx/host.jsx').replace(/\\/g, '/');
    return evalScript('try{$.evalFile("' + file.replace(/"/g, '\\"') + '");"ok"}catch(e){"ERR "+e.message+" ligne "+e.line}')
      .then(function (r) {
        if (r !== 'ok') console.error('[1SEC] host.jsx :', r);
        return r === 'ok';
      });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src + '?v=' + Date.now();
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Impossible de charger ' + src)); };
      document.body.appendChild(s);
    });
  }

  function reload() {
    try { window.OneSecApp && window.OneSecApp.saveState && window.OneSecApp.saveState(); } catch (e) {}
    window.location.reload();
  }

  // ------------------------------------------------ surveillance des fichiers

  var watcher = null, reloadTimer = null;
  function setAutoReload(on) {
    try { localStorage.setItem('onesec.autoReload', on ? '1' : '0'); } catch (e) {}
    if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
    if (!on || !nodeRequire || !root) return false;
    try {
      var fs = nodeRequire('fs');
      watcher = fs.watch(root, { recursive: true }, function (evt, file) {
        if (!file) return;
        file = String(file).replace(/\\/g, '/');
        if (file.indexOf('.git/') === 0 || file.indexOf('node_modules/') === 0 || file.indexOf('tests/') === 0) return;
        if (!/\.(js|jsx|css|html)$/.test(file)) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(reload, 400);
      });
      return true;
    } catch (e) {
      console.warn('[1SEC] surveillance indisponible', e);
      return false;
    }
  }

  function autoReloadEnabled() {
    try { return localStorage.getItem('onesec.autoReload') !== '0'; } catch (e) { return true; }
  }

  // ------------------------------------------------ git

  var gitCmd = null;
  /** Trouve git : PATH, puis emplacements habituels (Premiere peut avoir un PATH sans git). */
  function findGit() {
    return new Promise(function (resolve) {
      if (gitCmd) return resolve(gitCmd);
      if (!nodeRequire) return resolve(null);
      var cp = nodeRequire('child_process'), fs = nodeRequire('fs');
      var isWin = navigator.platform.indexOf('Win') === 0;
      var cands = isWin
        ? ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
           (process.env.LOCALAPPDATA || '') + '\\Programs\\Git\\cmd\\git.exe', (process.env.USERPROFILE || '') + '\\scoop\\shims\\git.exe']
        : ['git', '/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/Applications/Xcode.app/Contents/Developer/usr/bin/git'];
      (function tryNext(i) {
        if (i >= cands.length) return resolve(null);
        var c = cands[i];
        if (c !== 'git') { try { if (!fs.existsSync(c)) return tryNext(i + 1); } catch (e) { return tryNext(i + 1); } }
        cp.execFile(c, ['--version'], { timeout: 10000 }, function (err) {
          if (err) return tryNext(i + 1);
          gitCmd = c; resolve(c);
        });
      })(0);
    });
  }

  function git(args, timeout) {
    return findGit().then(function (g) {
      if (!g) throw new Error('git introuvable. Installez Git (https://git-scm.com) puis redémarrez Premiere une fois.');
      return new Promise(function (resolve, reject) {
        nodeRequire('child_process').execFile(g, args, { cwd: root, timeout: timeout || 60000 }, function (err, stdout, stderr) {
          if (err) return reject(new Error((stderr || stdout || String(err)).trim()));
          resolve(String(stdout));
        });
      });
    });
  }

  /** Mise à jour : fetch + reset sur la branche distante (ignore les modifications locales), puis rechargement. */
  function update() {
    if (!nodeRequire || !root) return Promise.resolve({ ok: false, output: 'Mise à jour disponible uniquement dans Premiere.' });
    var before = '';
    return git(['rev-parse', 'HEAD']).then(function (h) { before = h.trim(); return git(['fetch', '--quiet']); })
      .then(function () { return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); })
      .then(function (up) { return git(['reset', '--hard', up.trim()]); })
      .then(function (out) { return git(['rev-parse', 'HEAD']).then(function (h) { return { ok: true, output: out, changed: h.trim() !== before }; }); })
      .catch(function (e) { return { ok: false, output: e.message }; });
  }

  /** Vérifie s'il existe une mise à jour (git fetch, sans rien modifier). */
  function checkUpdate() {
    if (!nodeRequire || !root) return Promise.resolve({ available: false });
    return git(['fetch', '--quiet'], 30000).then(function () { return git(['rev-list', '--count', 'HEAD..@{u}']); })
      .then(function (out) { var n = parseInt(out.trim(), 10) || 0; return { available: n > 0, commits: n }; })
      .catch(function (e) { return { available: false, error: e.message }; });
  }

  window.OneSecBoot = {
    checkUpdate: checkUpdate,
    isCEP: isCEP,
    root: root,
    nodeRequire: nodeRequire,
    evalScript: evalScript,
    loadHost: loadHost,
    reload: reload,
    update: update,
    setAutoReload: setAutoReload,
    autoReloadEnabled: autoReloadEnabled
  };

  loadHost()
    .then(function () {
      return SCRIPTS.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve());
    })
    .then(function () {
      if (autoReloadEnabled()) setAutoReload(true);
      window.OneSecApp.start();
    })
    .catch(function (e) {
      console.error('[1SEC]', e);
      document.body.innerHTML = '<div style="padding:14px;font:12px sans-serif;color:#ddd">' +
        '<pre style="color:#f88;white-space:pre-wrap">[1SEC] ' + (e && e.message || e) + '</pre>' +
        '<p>Le panneau n\'a pas pu démarrer. Essayez de le recharger ; si ça persiste, réinitialisez l\'état sauvegardé (analyse, réglages).</p>' +
        '<button id="b-reload" style="padding:6px 12px;margin-right:8px">⟳ Recharger</button>' +
        '<button id="b-reset" style="padding:6px 12px">Réinitialiser et recharger</button>' +
        '<button id="b-update" style="padding:6px 12px;margin-left:8px">⬇ Mettre à jour</button></div>';
      document.getElementById('b-reload').onclick = function () { window.location.reload(); };
      document.getElementById('b-reset').onclick = function () { try { localStorage.clear(); } catch (x) {} window.location.reload(); };
      document.getElementById('b-update').onclick = function () { update().then(function () { window.location.reload(); }); };
    });
})();
