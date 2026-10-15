/* exported DropTarget */
const { Clutter, Gio, GLib, Meta } = imports.gi;
const Main = imports.ui.main;

const Me = imports.misc.extensionUtils.getCurrentExtension();

const POLL_MS = 80;
const DROP_WAIT_MS = 600;
const TRIGGER_MARGIN = 6;
const MAX_RESPAWN_DELAY = 30000;

/**
 * "Soltar arquivo no app".
 *
 * O Shell não consegue ler o conteúdo de um arrasto vindo de outro app. Então
 * mantemos um processo auxiliar (helper/dropHelper.js) com uma janela GTK4
 * transparente, minimizada enquanto não é usada. Quando o usuário arrasta algo
 * até a dock (botão pressionado sobre ela), a janela é posta exatamente sob a
 * dock e os ícones ficam "transparentes" ao mouse; o compositor então entrega o
 * drop à janela, que nos manda as URIs pela saída padrão. Aí abrimos o app que
 * estava sob o cursor com esses arquivos.
 */
var DropTarget = class {
    constructor(dock) {
        this.dock = dock;
        this._window = null;
        this._proc = null;
        this._client = null;
        this._active = false;
        this._pressInDock = false;
        this._xdndActive = false;
        this._releaseTime = 0;
        this._lastPos = [0, 0];
        this._lastMods = 0;
        this._hoverItem = null;
        this._respawnDelay = 1000;
        this._respawnId = 0;
        this._destroyed = false;

        // arrastar um ícone da própria dock não deve ativar o modo de drop
        dock.box.connect('button-press-event', () => {
            this._pressInDock = true;
            return Clutter.EVENT_PROPAGATE;
        });

        global.display.connectObject('window-created', (d, w) => this._maybeAdopt(w), this);
        // no X11 (e no Wayland com o Shell em modo modal) o Shell avisa o início do arrasto
        Main.xdndHandler.connectObject(
            'drag-begin', () => (this._xdndActive = true),
            'drag-end', () => (this._xdndActive = false), this);

        this._spawn();
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    isHelperWindow(metaWindow) {
        if (metaWindow === this._window)
            return true;
        return this._owns(metaWindow);
    }

    // ---- processo auxiliar ----

    _spawn() {
        const launcher = new Gio.SubprocessLauncher({
            // stdin aberto = sinal de vida para o helper (ele sai no EOF)
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_MERGE,
        });
        const argv = [
            GLib.find_program_in_path('gjs') ?? '/usr/bin/gjs',
            GLib.build_filenamev([Me.path, 'helper', 'dropHelper.js']),
        ];
        try {
            if (Meta.is_wayland_compositor()) {
                // WaylandClient permite reconhecer e esconder as janelas do helper
                this._client = Meta.WaylandClient.new(launcher);
                this._proc = this._client.spawnv(global.display, argv);
            } else {
                this._client = null;
                this._proc = launcher.spawnv(argv);
            }
        } catch (e) {
            logError(e, '[projeto-dock] não foi possível iniciar o helper de drop');
            this._scheduleRespawn();
            return;
        } finally {
            launcher.close?.();
        }

        this._cancellable = new Gio.Cancellable();
        this._stdout = new Gio.DataInputStream({ base_stream: this._proc.get_stdout_pipe() });
        this._readLine();
        const proc = this._proc;
        proc.wait_async(this._cancellable, () => {
            if (proc === this._proc)
                this._onExit();
        });
    }

    _readLine() {
        const stream = this._stdout;
        stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
            let line;
            try {
                [line] = s.read_line_finish_utf8(res);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, '[projeto-dock] helper');
                return;
            }
            if (line === null)
                return; // EOF
            this._onHelperLine(line);
            if (stream === this._stdout)
                this._readLine();
        });
    }

    _onHelperLine(line) {
        if (!line.startsWith('@@')) {
            log(`[projeto-dock helper] ${line}`);
            return;
        }
        const space = line.indexOf(' ');
        const kind = space < 0 ? line.slice(2) : line.slice(2, space);
        if (kind === 'READY') {
            this._respawnDelay = 1000;
        } else if (kind === 'DROP') {
            try {
                this._onDrop(JSON.parse(line.slice(space + 1)));
            } catch (e) {
                logError(e, '[projeto-dock] drop inválido');
            }
        }
    }

    _onExit() {
        this._proc = null;
        this._window = null;
        this._stdout = null;
        if (this._active)
            this._deactivate();
        if (!this._destroyed)
            this._scheduleRespawn();
    }

    _scheduleRespawn() {
        if (this._respawnId || this._destroyed)
            return;
        this._respawnId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._respawnDelay, () => {
            this._respawnId = 0;
            this._spawn();
            return GLib.SOURCE_REMOVE;
        });
        this._respawnDelay = Math.min(this._respawnDelay * 2, MAX_RESPAWN_DELAY);
    }

    _owns(metaWindow) {
        if (!this._proc)
            return false;
        if (this._client) {
            try {
                return this._client.owns_window(metaWindow);
            } catch (e) {
                return false;
            }
        }
        return `${metaWindow.get_pid()}` === this._proc.get_identifier();
    }

    _maybeAdopt(metaWindow) {
        if (this._window || !this._owns(metaWindow))
            return;

        this._window = metaWindow;
        this._client?.hide_from_window_list(metaWindow);
        log('[projeto-dock] janela de drop pronta');
        metaWindow.connectObject(
            'unmanaged', () => {
                if (this._window === metaWindow)
                    this._window = null;
            },
            // primeira exibição: esconder até ser necessária
            'shown', () => {
                if (!this._active)
                    this._park();
            }, this);
        this.dock.queueRedisplay();
    }

    /** Esconde a janela do helper (minimizada, sem animação). */
    _park() {
        const w = this._window;
        if (!w || w.minimized)
            return;
        const actor = w.get_compositor_private();
        if (actor)
            Main.wm.skipNextEffect(actor);
        w.minimize();
    }

    /** Põe a janela do helper exatamente sob a dock. */
    _unpark() {
        const w = this._window;
        const r = this.dock.getShownRect();
        if (!w.is_above())
            w.make_above();
        if (!w.is_on_all_workspaces())
            w.stick();
        if (w.minimized) {
            const actor = w.get_compositor_private();
            if (actor)
                Main.wm.skipNextEffect(actor);
            w.unminimize();
        }
        w.move_resize_frame(false, r.x, r.y, r.width, r.height);
        w.raise();
    }

    // ---- detecção do arrasto ----

    _inTriggerZone(x, y) {
        const r = this.dock.getShownRect();
        const m = TRIGGER_MARGIN;
        if (x < r.x - m || x > r.x + r.width + m)
            return false;
        if (this.dock.autohide.shown)
            return y >= r.y - m && y <= r.y + r.height + m;
        // dock escondida: encostar na borda inferior revela
        const monitor = this.dock.monitor;
        return y >= monitor.y + monitor.height - 4;
    }

    _poll() {
        const [x, y, mods] = global.get_pointer();
        const pressed = (mods & Clutter.ModifierType.BUTTON1_MASK) !== 0;

        if (!this._active) {
            if (!pressed) {
                this._pressInDock = false;
                return;
            }
            if (this._pressInDock && !this._xdndActive)
                return;
            if (!this._window || Main.overview.visible || this.dock.menuOpen)
                return;
            if (global.display.get_grab_op() !== Meta.GrabOp.NONE)
                return; // movendo/redimensionando uma janela
            if (this._inTriggerZone(x, y))
                this._activate();
            return;
        }

        if (pressed) {
            this._releaseTime = 0;
            this._lastPos = [x, y];
            this._lastMods = mods;
            this._setHoverItem(this.dock.itemAt(x, y).item);
        } else if (!this._releaseTime) {
            this._releaseTime = GLib.get_monotonic_time();
        } else if (GLib.get_monotonic_time() - this._releaseTime > DROP_WAIT_MS * 1000) {
            // soltou fora da dock, ou o arrasto não era de arquivos
            this._deactivate();
        }
    }

    _activate() {
        this._active = true;
        this._releaseTime = 0;
        this.dock.autohide.setBlocked('drop', true);
        this.dock.setDropMode(true);
        this._unpark();
    }

    _deactivate() {
        this._active = false;
        this._setHoverItem(null);
        this._park();
        this.dock.setDropMode(false);
        this.dock.autohide.setBlocked('drop', false);
    }

    _setHoverItem(item) {
        if (item === this._hoverItem)
            return;
        this._hoverItem?.setDropHover(false);
        this._hoverItem = item;
        item?.setDropHover(true);
    }

    _onDrop({ uris, alt, ctrl, shift }) {
        // a janela do helper não tem foco de teclado, então os modificadores
        // confiáveis são os que o Shell viu enquanto o botão estava pressionado
        const [, , mods] = global.get_pointer();
        const allMods = mods | this._lastMods;
        const target = this.dock.itemAt(...this._lastPos);
        const modifiers = {
            alt: alt || (allMods & Clutter.ModifierType.MOD1_MASK) !== 0,
            ctrl: ctrl || (allMods & Clutter.ModifierType.CONTROL_MASK) !== 0,
            shift: shift || (allMods & Clutter.ModifierType.SHIFT_MASK) !== 0,
        };
        this._deactivate();
        this.dock.handleExternalDrop(target, uris, modifiers);
    }

    destroy() {
        this._destroyed = true;
        GLib.source_remove(this._pollId);
        if (this._respawnId)
            GLib.source_remove(this._respawnId);
        if (this._active)
            this._deactivate();
        global.display.disconnectObject(this);
        Main.xdndHandler.disconnectObject(this);
        this._window?.disconnectObject(this);
        this._cancellable?.cancel();
        this._proc?.force_exit();
        this._proc = null;
        this._window = null;
    }
};
