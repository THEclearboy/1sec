# 1SEC — Montage sport en rythme pour Premiere Pro

Panneau Premiere Pro (extension CEP) qui cale vos rushes de sport sur la musique :
analyse du morceau (tempo, mesures, sections, moments forts), marqueurs dans la
timeline, puis montage automatique **non robotique** — plans longs et ralentis
dans les passages calmes, coupes rapides dans les montées et les drops — avec
un contrôle par étape sur chaque passage.

## Installation (une seule fois)

1. Clonez ce dépôt où vous voulez :
   ```
   git clone <url-du-depot> 1sec
   ```
2. Lancez le script d'installation :
   - macOS : `bash 1sec/scripts/install-mac.sh`
   - Windows : double-clic sur `1sec\scripts\install-win.bat`

   Il crée un **lien** vers le dossier du dépôt dans le dossier des extensions
   CEP et autorise les extensions non signées (PlayerDebugMode).
3. Redémarrez Premiere Pro **une fois**, puis *Fenêtre ▸ Extensions ▸ 1SEC Montage Sport*.

## Mettre à jour SANS redémarrer Premiere

Le plugin est conçu pour être mis à jour à chaud :

| Méthode | Comment |
|---|---|
| Bouton **⋯ ▸ Mettre à jour** | fait un `git pull` dans le dossier du plugin puis recharge le panneau |
| Bouton **⟳** | recharge le panneau et ré-évalue `jsx/host.jsx` dans Premiere |
| **Rechargement auto** (⋯, activé par défaut) | toute modification d'un fichier `.js / .jsx / .css / .html` du dossier recharge le panneau |

Le panneau charge ses scripts sans cache et recharge le code ExtendScript
(`jsx/host.jsx`) à chaque ouverture, donc un `git pull` ou une édition de
fichier prend effet immédiatement. L'état du travail en cours (analyse,
moments, réglages) est conservé au rechargement.

> Seule une modification de `CSXS/manifest.xml` (nom, version, hôte) demande un
> redémarrage de Premiere.

## Utilisation

### Étape 1 — Musique
Placez la musique dans la timeline, **sélectionnez le clip audio**, cliquez
*Analyser la musique*. Le plugin détecte : tempo (corrigible ÷2 / ×2), premier
temps des mesures (bouton *Décaler*), sections (curseur *moins / plus de
sections*), moments forts. *Poser les marqueurs* place des marqueurs de
séquence colorés (sections avec durée, moments forts, optionnellement mesures et
temps). Les marqueurs 1SEC sont remplacés à chaque pose.

### Étape 2 — Rushes (dérushage)
Dans le moniteur source, posez un marqueur (`M`) **à la fin de chaque moment
fort** de vos rushes. Le plan se terminera exactement sur ce marqueur, calé sur
la musique.
- Marqueur **avec durée** : moment précis (début → fin).
- Nommez-le **top** (ou marqueur rouge) : moment réservé aux drops / plans importants.
- Nommez-le **skip** : ignoré.

Sélectionnez les rushes (ou un chutier) dans le panneau Projet, puis *Charger
les moments*. Vous pouvez ★ marquer / ✕ ignorer chaque moment dans la liste.

### Étape 3 — Rythme
- **Style** régulier ↔ vivant, bouton **🎲 Variante** pour une autre proposition.
- **Sur les drops** : plan héros au ralenti puis coupes rapides, meilleur moment plein vitesse, ou rien.
- Par **section** : rythme (Auto / Très lent → Très rapide, en temps musicaux) et vitesse (100 % ou ralenti 75 → 25 %).
- **Détail des plans** : changez le rush ou la vitesse d'un plan, **🔒 verrouillez** ceux qui vous plaisent : ils ne bougent plus quand vous changez les réglages.
- Cliquez sur la frise en haut pour placer la tête de lecture et sélectionner la section.

### Étape 4 — Montage
Choisissez la piste vidéo, puis *Construire le montage*. Les rushes sont posés
en coupes sèches sur la grille musicale, avec leurs ralentis ; le son des rushes
est retiré et la musique vérifiée. Modifiez les réglages et reconstruisez autant
de fois que nécessaire : la piste est remplacée.

Pour des ralentis fluides : sélectionnez les plans ralentis dans Premiere,
*Interpolation temporelle ▸ Flux optique*.

### Étape 5 — Colo
Une vraie colorimétrie plan par plan, pas un filtre :
1. **Analyser les plans** : une image de chaque clip de la piste choisie est
   exportée depuis Premiere et mesurée (histogramme, point noir / blanc,
   balance, contraste, dominantes ombres / hautes lumières, tons de peau, écrêtage).
2. **Direction artistique** : un look (Naturel, Cinéma chaud, Teal & Orange,
   Froid / Nuit, Punchy sport, Vintage, Désaturé, Noir & blanc) **ou une image
   de référence** dont le rendu est extrait, puis des réglages fins (intensité,
   force du raccord, chaleur, contraste, saturation, exposition, teintes
   ombres / lumières, vignette, protection des peaux).
3. **Aperçu avant / après** de chaque plan, avec réglage individuel (look,
   exposition, chaleur, contraste, saturation) ou exclusion d'un plan.
4. **Appliquer** : un effet *Lumetri Color* est ajouté à chaque clip et réglé
   paramètre par paramètre (correction primaire propre au plan pour le raccord,
   puis look adapté au plan). Tout reste modifiable à la main dans Premiere.

Limites : les roues de teinte (split-toning) ne sont pas pilotables par
script — l'aperçu les montre, à pousser à la main dans Lumetri si besoin. Les
noms des paramètres Lumetri dépendent de la langue de Premiere : si le rapport
signale des paramètres non trouvés, *Diagnostic Lumetri* affiche la liste
réelle pour adapter `ONESEC_LUMETRI_NAMES` dans `jsx/host.jsx`.

## Comment le rythme est décidé

- Les coupes tombent sur la grille des temps (demi-temps possibles), les plans
  longs sur les mesures, et sur les accents forts de la musique.
- Le rythme de base de chaque section dépend de son énergie (intro/calme →
  4–8 temps et ralenti ; intense → 1–2 temps ; drop → plan héros puis 1 temps).
- Variations « humaines » : mélange de plans courts/longs, doubles coupes,
  accélération progressive qui suit la montée d'énergie.
- Les moments *top* vont sur les plans importants, un même rush n'est pas
  utilisé deux fois de suite, et le plugin prévient s'il manque de matière.

## Développement

```
npm test        # tests unitaires (analyse + planificateur) sur une musique synthétique
npm run demo    # ouvre le panneau dans un navigateur (mode démo, sans Premiere)
```

Débogage du panneau dans Premiere : `.debug` expose le panneau sur
`http://localhost:8088` (Chrome DevTools).

Structure :
- `js/audio-analysis.js` — tempo, temps, mesures, énergie, sections, moments forts (pur JS).
- `js/edit-planner.js` — découpage rythmique, attribution des rushes, marqueurs.
- `js/color-grade.js` — analyse d'image, looks, calcul de la colo par plan, aperçu.
- `js/app.js` — interface par étapes ; `js/app-color.js` — étape colo ; `js/bridge.js` — pont Premiere / mode démo ; `js/boot.js` — rechargement à chaud.
- `jsx/host.jsx` — côté Premiere (lecture des clips/marqueurs, pose des marqueurs, montage, vitesses).
