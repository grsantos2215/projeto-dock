#!/usr/bin/env bash
# Abre um GNOME Shell aninhado (numa janela) só com esta extensão ativa.
# Configurações em memória e modo "user": nada muda na sua sessão real
# e o Ubuntu Dock / Desktop Icons não são carregados.
# Logs: tudo que a extensão escrever aparece neste terminal.
set -euo pipefail
cd "$(dirname "$0")"
./install.sh install >/dev/null

export GSETTINGS_BACKEND=memory
export MUTTER_DEBUG_DUMMY_MODE_SPECS=${MUTTER_DEBUG_DUMMY_MODE_SPECS:-1366x768}
unset GNOME_SHELL_SESSION_MODE

dbus-run-session -- bash -c '
    gnome-shell --nested --wayland --mode=user &
    SHELL_PID=$!
    sleep 6
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Extensions.EnableExtension projeto-dock@gabrielferraz >/dev/null
    wait $SHELL_PID
'
