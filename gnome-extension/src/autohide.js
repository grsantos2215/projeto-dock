/* exported Autohide */
const { Clutter, GLib, Meta, St } = imports.gi;
const Main = imports.ui.main;

const ANIMATION_TIME = 200;
const HIDE_DELAY = 400;
const HOT_ZONE_HEIGHT = 2;
const SHADOW_MARGIN = 24; // esconde também a sombra da barra

const OVERLAP_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
    Meta.WindowType.TOOLBAR,
    Meta.WindowType.SPLASHSCREEN,
];

/**
 * Modos: 'always-visible' (reserva espaço), 'autohide' (some quando o mouse sai)
 * e 'intellihide' (some só quando alguma janela ocupa o espaço da dock).
 * "Bloqueios" (hover, menus, popups, arrasto de arquivo) mantêm a dock visível.
 */
var Autohide = class {
    constructor(dock) {
        this.dock = dock;
        this._blockers = new Set();
        this._shown = true;
        this._hideId = 0;
        this._checkId = 0;
        this._revealId = 0;
        this._revealed = false;

        this._hotZone = new St.Widget({ reactive: true, track_hover: true, visible: false, name: 'projetoDockHotZone' });
        Main.layoutManager.addChrome(this._hotZone);
        this._hotZone.connect('notify::hover', () => {
            if (this._hotZone.hover)
                this.reveal();
        });

        dock.box.connect('notify::hover', () => {
            this.setBlocked('hover', dock.box.hover);
            if (!dock.box.hover)
                this._revealed = false;
        });

        dock.settings.connectObject('changed::autohide-mode', () => this._applyMode(), this);

        // intellihide: reagir a janelas se mexendo/aparecendo
        global.display.connectObject(
            'window-created', (d, w) => this._watchWindow(w),
            'restacked', () => this.queueCheck(),
            'grab-op-end', () => this.queueCheck(), this);
        global.workspace_manager.connectObject('active-workspace-changed', () => this.queueCheck(), this);
        global.window_manager.connectObject(
            'minimize', () => this.queueCheck(),
            'unminimize', () => this.queueCheck(),
            'size-change', () => this.queueCheck(), this);
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);

        this._applyMode();
    }

    get mode() {
        return this.dock.settings.get_string('autohide-mode');
    }

    get shown() {
        return this._shown;
    }

    _watchWindow(metaWindow) {
        metaWindow.connectObject(
            'position-changed', () => this.queueCheck(),
            'size-changed', () => this.queueCheck(),
            'unmanaged', () => {
                metaWindow.disconnectObject(this);
                this.queueCheck();
            }, this);
    }

    _applyMode() {
        // só o modo "sempre visível" reserva espaço na tela (struts)
        const container = this.dock.container;
        Main.layoutManager.untrackChrome(container);
        Main.layoutManager.trackChrome(container, {
            affectsStruts: this.mode === 'always-visible',
            trackFullscreen: true,
        });
        this.update();
    }

    setBlocked(reason, blocked) {
        if (this.dock.destroying)
            return;
        if (blocked)
            this._blockers.add(reason);
        else
            this._blockers.delete(reason);
        this.update();
    }

    /** Mostra a dock ao encostar o mouse na borda inferior. */
    reveal() {
        this._revealed = true;
        this.update();
        // se o mouse não entrar na dock logo, esconde de novo
        if (this._revealId)
            GLib.source_remove(this._revealId);
        this._revealId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._revealId = 0;
            if (!this.dock.box.hover && !this._hotZone.hover) {
                this._revealed = false;
                this.update();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    queueCheck() {
        if (this._checkId || this.mode !== 'intellihide')
            return;
        this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._checkId = 0;
            this.update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _windowOverlaps() {
        const rect = this.dock.getShownRect();
        const monitorIndex = this.dock.monitorIndex;
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().some(w => {
            if (w.minimized || this.dock.isHiddenWindow(w) || !w.showing_on_its_workspace())
                return false;
            if (!OVERLAP_TYPES.includes(w.get_window_type()) || w.get_monitor() !== monitorIndex)
                return false;
            const f = w.get_frame_rect();
            return f.x < rect.x + rect.width && f.x + f.width > rect.x &&
                f.y < rect.y + rect.height && f.y + f.height > rect.y;
        });
    }

    _wantsShown() {
        if (this._blockers.size || this._revealed)
            return true;
        switch (this.mode) {
        case 'always-visible':
            return true;
        case 'intellihide':
            return !this._windowOverlaps();
        default:
            return false;
        }
    }

    update() {
        const show = this._wantsShown();
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }
        if (show) {
            this._animate(true);
        } else if (this._shown) {
            this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY, () => {
                this._hideId = 0;
                if (!this._wantsShown())
                    this._animate(false);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _animate(show) {
        const container = this.dock.container;
        this._shown = show;
        container.remove_transition('translation-y');
        container.ease({
            translation_y: show ? 0 : container.height + SHADOW_MARGIN,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this.syncHotZone();
    }

    /** Faixa fina na borda inferior que revela a dock quando ela está escondida. */
    syncHotZone() {
        const rect = this.dock.getShownRect();
        const monitor = this.dock.monitor;
        if (!monitor)
            return;
        this._hotZone.set_position(rect.x, monitor.y + monitor.height - HOT_ZONE_HEIGHT);
        this._hotZone.set_size(rect.width, HOT_ZONE_HEIGHT);
        this._hotZone.visible = !this._shown && !Main.overview.visible;
    }

    destroy() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        if (this._checkId)
            GLib.source_remove(this._checkId);
        if (this._revealId)
            GLib.source_remove(this._revealId);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        this.dock.settings.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.meta_window.disconnectObject(this);
        this._hotZone.destroy();
    }
};
