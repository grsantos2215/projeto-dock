# Projeto Dock

Dock flutuante para o GNOME Shell (42, Wayland/X11), inspirada na dock do COSMIC,
com o recurso do macOS de **soltar arquivos/pastas sobre um app** para abri-los nele.

## Recursos

- **Soltar no app**: arraste `p4c-workspace` do Nautilus para o VS Code na dock e ele
  abre a pasta (na instância já aberta, se houver).
  - **Alt** ao soltar: menu "Abrir com…" (apps compatíveis, nova janela, fixar, copiar caminho).
  - Soltar sobre uma **pasta fixada**: move os itens para ela (**Ctrl** copia). Nunca sobrescreve.
  - Soltar numa **área vazia** da dock ou no botão de apps: fixa a pasta/arquivo na dock.
  - Também aceita links arrastados do navegador.
- **Pilhas**: pastas fixadas abrem uma grade com os itens mais recentes (como Downloads no macOS).
- **Recentes por app** no botão direito (VS Code lê os projetos do próprio VS Code; os demais
  usam `~/.local/share/recently-used.xbel`).
- **Miniaturas das janelas** ao passar o mouse sobre um app aberto (clique foca, × fecha).
- **Badges/progresso** via `com.canonical.Unity.LauncherEntry` (Chrome, Telegram, Thunderbird…).
- **Esconder**: sempre visível (reserva espaço), automático, ou intellihide (padrão).
- Clique: abre / foca / minimiza / alterna entre janelas. Clique do meio ou Ctrl+clique: nova janela.

## Instalar

```sh
gnome-extensions disable ubuntu-dock@ubuntu.com   # as duas docks conflitam
./install.sh                                        # copia para ~/.local/share/gnome-shell/extensions
# Wayland: saia e entre na sessão para o Shell enxergar a extensão nova
gnome-extensions enable projeto-dock@gabrielferraz
gnome-extensions prefs projeto-dock@gabrielferraz   # preferências
```

Para voltar: `gnome-extensions disable projeto-dock@gabrielferraz && gnome-extensions enable ubuntu-dock@ubuntu.com`.

Logs: `journalctl -f -o cat /usr/bin/gnome-shell | grep -i dock`

## Desenvolvimento

- `./install.sh check` — checa a sintaxe dos arquivos JS.
- `./dev-nested.sh` — abre um GNOME Shell aninhado numa janela, só com esta extensão,
  sem mexer nas suas configurações. Bom para ver visual, menus e autohide.
  *Limitação:* no shell aninhado o arrastar-e-soltar e os cliques simulados não são
  confiáveis (o ponteiro do host e o do shell aninhado são diferentes). Teste o drop na
  sessão real.
- `PROJETO_DOCK_DEBUG=1` no ambiente do Shell pinta a janela de drop de vermelho translúcido.

## Como o "soltar no app" funciona

O GNOME Shell não consegue ler os dados de um arrasto vindo de outro app no Wayland
(nem sabe que um arrasto começou, fora do modo visão geral). Então:

1. `src/dropTarget.js` mantém um processo auxiliar (`helper/dropHelper.js`, GTK4) com uma
   janela transparente, **minimizada** enquanto não é usada (iniciado via `Meta.WaylandClient`,
   o mesmo truque do Desktop Icons NG, para ficar fora do Alt+Tab e da própria dock).
2. A cada 80 ms a extensão olha o ponteiro: se o botão está pressionado sobre a dock
   (ou na borda inferior, com a dock escondida) e o clique **não** começou na dock,
   a janela auxiliar é posta exatamente sob a dock e os ícones ficam não-reativos —
   assim o compositor entrega o drop para a janela.
3. A janela recebe as URIs (`Gdk.FileList` / `text/uri-list`, só ação COPY para a origem
   nunca apagar o arquivo) e as escreve no stdout (`@@DROP {...}`).
4. A extensão vê qual ícone estava sob o cursor e chama `Gio.DesktopAppInfo.launch_uris()`
   com um contexto com timestamp (token de ativação → o app já aberto vem para frente).

O auxiliar sai sozinho se o Shell/extensão sumir (EOF no stdin ou display fechado).

## Estrutura

```
extension.js            enable/disable
prefs.js                preferências (libadwaita)
stylesheet.css          visual
src/dock.js             barra, ícones, posição, tooltip, menus de drop
src/items.js            itens: app, pasta/arquivo fixado, botão de apps
src/autohide.js         sempre visível / autohide / intellihide
src/dropTarget.js       detecção do arrasto + processo auxiliar
src/launcher.js         abrir arquivos com apps, "abrir com", mover/copiar
src/windowPreviews.js   miniaturas das janelas
src/stacks.js           pilhas (grade de pasta)
src/recents.js          recentes por app
src/badges.js           LauncherEntry (contadores/progresso)
helper/dropHelper.js    janela GTK4 que recebe o drop
helper/vscode_recents.py  lê os recentes do VS Code (somente leitura)
```

## Próximos passos

- Reordenar/fixar apps arrastando dentro da dock.
- Abrir a pilha automaticamente ao segurar um arquivo sobre ela (spring-loading).
- Multi-monitor, posição lateral, magnificação.
- Porte para GNOME 45+ (módulos ESM).
