#!/bin/bash
# Installe 1SEC dans Premiere Pro (macOS) en mode développement.
# Le dossier du plugin est LIÉ (lien symbolique) : un `git pull` suffit ensuite,
# puis ⟳ dans le panneau — pas besoin de redémarrer Premiere.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.onesec.sportedit"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -s "$SRC" "$DEST"
# Autorise les extensions non signées
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
echo "✔ 1SEC installé : $DEST -> $SRC"
echo "  Redémarrez Premiere Pro UNE fois, puis Fenêtre > Extensions > 1SEC Montage Sport."
