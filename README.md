# Projeto Dock

Bandeja de aplicativos para a **dock do COSMIC** com um recurso que até hoje só existia no macOS:
**arraste um arquivo ou uma pasta sobre o ícone de um app e ele abre o app com aquilo.**

Exemplo: arraste a pasta `meu-projeto` do gerenciador de arquivos até o ícone do VS Code na
dock. O VS Code abre com a pasta, e se ele já estava aberto, abre na janela existente.

É uma versão modificada da bandeja oficial do COSMIC
([`cosmic-app-list`](https://github.com/pop-os/cosmic-applets/tree/master/cosmic-app-list)),
então tudo que ela já faz continua igual: apps fixados, janelas abertas, menu do botão direito,
arrastar ícones para reordenar.

## Como funciona

- Arraste arquivos ou pastas sobre qualquer ícone da dock, fixado ou aberto. O ícone fica
  destacado e, ao soltar, o app abre com os itens.
- Funciona com qualquer app que aceite abrir arquivos (VS Code, Zed, editores de texto,
  navegadores, visualizadores de imagem…).
- Arrastar o arquivo `.desktop` de um app para a dock continua **fixando** o app, como na bandeja
  oficial.
- O arquivo arrastado é sempre **copiado para o app**, nunca movido: o gerenciador de arquivos
  não apaga nada.
- Se o app não aceita abrir arquivos, nada acontece. O motivo fica registrado no log.

## Requisitos

- **COSMIC** (testado no COSMIC 1.10 sobre o Ubuntu 26.04; deve funcionar no Pop!\_OS e em
  outras distros com COSMIC).
- Uns **3 GB** livres em disco para compilar (o resultado final tem ~25 MB).

## Instalação

### 1. Instale as dependências de compilação

Ubuntu / Pop!\_OS / Debian:

```sh
sudo apt install -y git curl build-essential pkg-config libclang-dev libdbus-1-dev libegl-dev \
  libpulse-dev libpipewire-0.3-dev libudev-dev libxkbcommon-dev libwayland-dev libinput-dev
```

<details>
<summary>Fedora e Arch (não testado)</summary>

Fedora:

```sh
sudo dnf install -y git curl gcc clang-devel pkgconf-pkg-config dbus-devel mesa-libEGL-devel \
  pulseaudio-libs-devel pipewire-devel systemd-devel libxkbcommon-devel wayland-devel libinput-devel
```

Arch:

```sh
sudo pacman -S --needed git curl base-devel clang dbus libglvnd libpulse pipewire systemd-libs \
  libxkbcommon wayland libinput
```

</details>

### 2. Instale o Rust

Se você ainda não tem o Rust (`rustc --version` não funciona), instale pelo rustup. Ele fica
só na sua pasta pessoal, sem `sudo`:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

A versão certa do Rust (1.93) é baixada sozinha na primeira compilação, por causa do
arquivo `cosmic-applet/rust-toolchain.toml`.

### 3. Baixe e instale o Projeto Dock

```sh
git clone https://github.com/grsantos2215/projeto-dock.git
cd projeto-dock/cosmic-applet
./install.sh
```

A primeira compilação leva alguns minutos. O script:

- compila e instala o programa em `~/.local/bin/projeto-dock-applet`;
- registra o applet para o painel do COSMIC em
  `~/.local/share/applications/io.github.projetodock.Dock.desktop`;
- copia os **apps que você já tinha fixado** na bandeja oficial (só na primeira vez).

Nada é instalado fora da sua pasta pessoal.

### 4. Coloque na dock

```sh
./install.sh ativar
```

Isso troca a bandeja oficial pelo Projeto Dock na configuração da dock e reinicia o painel.
Um backup da configuração anterior fica em
`~/.config/cosmic/com.system76.CosmicPanel.Dock/v1/plugins_center.antes-projeto-dock`.

Se a dock não voltar depois de alguns segundos, saia da sessão e entre de novo.

<details>
<summary>Prefere fazer pelas Configurações?</summary>

Abra as **Configurações** do COSMIC, vá até a seção da **Dock** e, na lista de applets, remova a
**Bandeja de aplicativos** e adicione **Projeto Dock** no centro. Os apps fixados ficam
separados entre as duas bandejas: o `./install.sh` copia os seus na primeira instalação.

</details>

## Atualizar

```sh
cd projeto-dock
git pull
cd cosmic-applet
./install.sh
pkill -x cosmic-panel   # recarrega a dock com a versão nova
```

## Voltar para a bandeja oficial / desinstalar

```sh
cd projeto-dock/cosmic-applet
./install.sh desativar   # volta para a bandeja oficial (o Projeto Dock continua instalado)
./install.sh remover     # desativa e apaga o programa
```

Os apps fixados do Projeto Dock ficam guardados em
`~/.config/cosmic/io.github.projetodock.Dock/` caso você queira reinstalar depois.

## Problemas

- **Soltei o arquivo e nada abriu**: veja o log do applet:
  ```sh
  journalctl --user -b | grep -i projeto-dock | tail -30
  ```
  Se não aparecer nada, rode o applet direto no terminal para ver os erros:
  `RUST_LOG=debug ~/.local/bin/projeto-dock-applet`.
- **O app abriu, mas sem o arquivo**: alguns apps não declaram no seu `.desktop` que aceitam
  arquivos (falta `%f`, `%F`, `%u` ou `%U` na linha `Exec`). Nesses casos o Projeto Dock não
  tem como passar o arquivo.
- **`./install.sh ativar` diz que não achou a bandeja oficial**: a sua dock está com outra
  configuração; use o caminho pelas Configurações (acima).

## Desenvolvimento

```sh
cd cosmic-applet
cargo test --lib     # testes
cargo build --release
```

O código do recurso de soltar está em `cosmic-applet/src/app.rs`:

- `DndUris`: lê a lista de arquivos arrastados (`text/uri-list`).
- `item_at`: descobre o ícone sob o cursor.
- `exec_with_files`: monta o comando do app com os arquivos.

Detalhes que valem saber:

- Há **uma única** área de soltar envolvendo a bandeja inteira. Áreas de soltar aninhadas não
  funcionam na libcosmic: a de fora sempre recebe o drop.
- A libcosmic descarta os códigos `%f %F %u %U` do `Exec`, então eles são trocados pelos
  caminhos antes de executar.

A pasta `gnome-extension/` tem a primeira versão do projeto, uma extensão para o GNOME Shell 42.
Ela não é mais mantida e fica só como referência.

### Ideias para o futuro

- Segurar **Alt** ao soltar para escolher com qual app abrir.
- Arquivos e projetos **recentes** no menu do botão direito de cada app.
- **Pilhas**: pastas fixadas que abrem em grade, como os Downloads no macOS.
- **Badges**: contadores e barra de progresso enviados pelos apps.

## Licença

GPL-3.0, a mesma da bandeja oficial do COSMIC. Baseado em
[pop-os/cosmic-applets](https://github.com/pop-os/cosmic-applets) © System76.
