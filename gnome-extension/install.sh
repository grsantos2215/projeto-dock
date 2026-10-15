#!/usr/bin/env bash
# Uso: ./install.sh [install|uninstall|check|zip]
set -euo pipefail
cd "$(dirname "$0")"

UUID=projeto-dock@gabrielferraz
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
FILES=(metadata.json extension.js prefs.js stylesheet.css src helper schemas)

check() {
    for f in extension.js prefs.js src/*.js helper/*.js; do
        node --check "$f"
    done
    echo "sintaxe ok"
}

case "${1:-install}" in
    install)
        glib-compile-schemas schemas/
        rm -rf "$DEST"
        mkdir -p "$DEST"
        cp -r "${FILES[@]}" "$DEST/"
        echo "Instalado em $DEST"
        echo "No Wayland, saia e entre na sessão; depois: gnome-extensions enable $UUID"
        ;;
    uninstall)
        rm -rf "$DEST"
        ;;
    check)
        check
        ;;
    zip)
        glib-compile-schemas schemas/
        rm -f "$UUID.zip"
        zip -qr "$UUID.zip" "${FILES[@]}"
        echo "$UUID.zip"
        ;;
    *)
        echo "uso: $0 [install|uninstall|check|zip]" >&2
        exit 1
        ;;
esac
