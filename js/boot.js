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

  var SCRIPTS = ['js/audio-analysis.js', 'js/edit-planner.js', 'js/color-grade.js', 'js/bridge.js', 'js/app.js', 'js/app-color.js'];
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

  /** git pull dans le dossier du plugin, puis rechargement. */
  function update() {
    return new Promise(function (resolve) {
      if (!nodeRequire || !root) return resolve({ ok: false, output: 'Mise à jour disponible uniquement dans Premiere.' });
      var cp = nodeRequire('child_process');
      cp.exec('git pull --ff-only', { cwd: root, timeout: 60000 }, function (err, stdout, stderr) {
        var out = (stdout || '') + (stderr || '');
        if (err) return resolve({ ok: false, output: out || String(err) });
        resolve({ ok: true, output: out, changed: !/Already up to date|Déjà à jour/i.test(out) });
      });
    });
  }

  window.OneSecBoot = {
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
      document.body.innerHTML = '<pre style="color:#f88;padding:12px">[1SEC] ' + (e && e.message || e) + '</pre>';
    });
})();
