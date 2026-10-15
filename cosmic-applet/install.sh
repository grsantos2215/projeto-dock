#!/usr/bin/env bash
# Projeto Dock (applet do COSMIC)
#   ./install.sh            compila e instala em ~/.local
#   ./install.sh ativar     troca a bandeja oficial pela nossa na Dock (faz backup)
#   ./install.sh desativar  volta para a bandeja oficial
#   ./install.sh remover    desinstala
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"

APP_ID=io.github.projetodock.Dock
OFFICIAL=com.system76.CosmicAppList
BIN="$HOME/.local/bin/projeto-dock-applet"
DESKTOP="$HOME/.local/share/applications/$APP_ID.desktop"
CFG="$HOME/.config/cosmic"
DOCK_CFG="$CFG/com.system76.CosmicPanel.Dock/v1/plugins_center"

restart_panel() {
    # o cosmic-session reinicia o painel sozinho
    pkill -x cosmic-panel || true
}

case "${1:-instalar}" in
    instalar)
        cargo build --release
        install -Dm755 target/release/projeto-dock-applet "$BIN"
        mkdir -p "$(dirname "$DESKTOP")"
        sed "s|@BIN@|$BIN|" data/$APP_ID.desktop > "$DESKTOP"
        # leva os apps fixados da bandeja oficial (só na primeira vez)
        if [ ! -e "$CFG/$APP_ID/v1/favorites" ] && [ -e "$CFG/$OFFICIAL/v1/favorites" ]; then
            mkdir -p "$CFG/$APP_ID/v1"
            cp "$CFG/$OFFICIAL/v1/"* "$CFG/$APP_ID/v1/"
            echo "Apps fixados copiados da bandeja oficial."
        fi
        echo "Instalado: $BIN"
        echo "Próximo passo: ./install.sh ativar"
        ;;
    ativar)
        [ -e "$DOCK_CFG" ] || { echo "Não achei $DOCK_CFG (a Dock está ligada?)" >&2; exit 1; }
        cp -n "$DOCK_CFG" "$DOCK_CFG.antes-projeto-dock"
        sed -i "s/\"$OFFICIAL\"/\"$APP_ID\"/" "$DOCK_CFG"
        grep -q "$APP_ID" "$DOCK_CFG" || { echo "A bandeja oficial não está no centro da Dock; adicione 'Projeto Dock' em Configurações > Área de trabalho > Dock." >&2; exit 1; }
        restart_panel
        echo "Dock usando o Projeto Dock. Backup: $DOCK_CFG.antes-projeto-dock"
        ;;
    desativar)
        sed -i "s/\"$APP_ID\"/\"$OFFICIAL\"/" "$DOCK_CFG"
        restart_panel
        echo "Dock de volta à bandeja oficial."
        ;;
    remover)
        "$0" desativar || true
        rm -f "$BIN" "$DESKTOP"
        echo "Removido (configurações em $CFG/$APP_ID mantidas)."
        ;;
    *)
        sed -n '2,6p' "$0"
        exit 1
        ;;
esac
