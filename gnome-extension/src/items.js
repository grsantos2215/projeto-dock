/* exported DockAppIcon, DockPinnedItem, ShowAppsButton, showInFileManager */
const { Clutter, Gio, GLib, GObject, Pango, St } = imports.gi;
const Main = imports.ui.main;
const BoxPointer = imports.ui.boxpointer;
const PopupMenu = imports.ui.popupMenu;
const { AppMenu } = imports.ui.appMenu;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Launcher = Me.imports.src.launcher;
const Recents = Me.imports.src.recents;

const MAX_DOTS = 3;

/** Base de todos os itens: ícone + indicadores, tooltip, menu e drop. */
var DockItem = GObject.registerClass({
    GTypeName: 'ProjetoDockItem',
}, class DockItem extends St.Button {
    _init(dock) {
        super._init({
            style_class: 'projeto-dock-item',
            reactive: true,
            track_hover: true,
            can_focus: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });
        this.dock = dock;
        this._menu = null;

        this._overlay = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this._iconBin = new St.Bin();
        this._overlay.add_child(this._iconBin);

        this._dots = new St.BoxLayout({
            style_class: 'projeto-dock-dots',
            x_align: Clutter.ActorAlign.CENTER,
        });

        const layout = new St.BoxLayout({ vertical: true });
        layout.add_child(this._overlay);
        layout.add_child(this._dots);
        this.set_child(layout);

        this.connect('notify::hover', () => this.dock.onItemHover(this));
        this.connect('clicked', (actor, button) => {
            this.dock.previews.hide();
            this.dock.hideTooltip();
            this.activate(button);
        });
        this.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this.dock.previews.hide();
            this.dock.hideTooltip();
            this.openMenu();
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', () => this._onDestroy());
    }

    setIcon(actor) {
        this._iconBin.set_child(actor);
    }

    get tooltipText() {
        return '';
    }

    setDropHover(hovered) {
        if (hovered)
            this.add_style_pseudo_class('drop');
        else
            this.remove_style_pseudo_class('drop');
    }

    /** Arquivos soltos sobre o item. mods = {alt, ctrl, shift} */
    acceptExternalDrop(_uris, _mods) {
        return false;
    }

    activate(_button) {
    }

    openMenu() {
    }

    _setupMenu(menu) {
        this._menu = menu;
        Main.uiGroup.add_actor(menu.actor);
        menu.actor.hide();
        this.dock.menuManager.addMenu(menu);
        menu.connect('open-state-changed', (m, open) => {
            this.dock.autohide.setBlocked(`menu-${this}`, open);
            if (open)
                this.add_style_pseudo_class('active');
            else
                this.remove_style_pseudo_class('active');
        });
    }

    _openMenu() {
        this._menu.open(BoxPointer.PopupAnimation.FULL);
        this.dock.menuManager.ignoreRelease();
    }

    _onDestroy() {
        this.dock.autohide.setBlocked(`menu-${this}`, false);
        this._menu?.destroy();
        this._menu = null;
    }
});

var DockAppIcon = GObject.registerClass({
    GTypeName: 'ProjetoDockAppIcon',
}, class DockAppIcon extends DockItem {
    _init(dock, app) {
        super._init(dock);
        this.app = app;
        this.setIcon(app.create_icon_texture(dock.iconSize));

        this._badge = new St.Label({
            style_class: 'projeto-dock-badge',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        this._progressTrack = new St.Widget({
            style_class: 'projeto-dock-progress',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
            width: Math.round(dock.iconSize * 0.8),
            visible: false,
        });
        this._progressFill = new St.Widget({
            style_class: 'projeto-dock-progress-fill',
            x_align: Clutter.ActorAlign.START,
            y_expand: true,
        });
        this._progressTrack.add_child(this._progressFill);
        this._overlay.add_child(this._progressTrack);
        this._overlay.add_child(this._badge);

        app.connectObject(
            'windows-changed', () => this.sync(),
            'notify::state', () => this.sync(), this);
        dock.tracker.connectObject('notify::focus-app', () => this.sync(), this);
        this.sync();
    }

    get tooltipText() {
        return this.app.get_name();
    }

    getWindows() {
        return this.app.get_windows().filter(w => !this.dock.isHiddenWindow(w));
    }

    sync() {
        const count = this.getWindows().length;
        this._dots.destroy_all_children();
        for (let i = 0; i < Math.min(count, MAX_DOTS); i++)
            this._dots.add_child(new St.Widget({ style_class: 'projeto-dock-dot' }));

        if (this.dock.tracker.focus_app === this.app)
            this.add_style_class_name('focused');
        else
            this.remove_style_class_name('focused');

        this.syncBadge();
        this.dock.previews.refresh(this);
    }

    syncBadge() {
        const entry = this.dock.badges.get(this.app.get_id());
        const showCount = entry?.countVisible && entry.count > 0;
        this._badge.visible = !!showCount;
        if (showCount)
            this._badge.text = entry.count > 99 ? '99+' : `${entry.count}`;

        const showProgress = entry?.progressVisible;
        this._progressTrack.visible = !!showProgress;
        if (showProgress) {
            const p = Math.max(0, Math.min(1, entry.progress));
            this._progressFill.width = Math.round(this._progressTrack.width * p);
        }

        if (entry?.urgent)
            this.add_style_class_name('urgent');
        else
            this.remove_style_class_name('urgent');
    }

    activate(button) {
        const event = Clutter.get_current_event();
        const mods = event ? event.get_state() : 0;
        const ctrl = (mods & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const windows = this.getWindows();

        if ((button === Clutter.BUTTON_MIDDLE || ctrl) && this.app.can_open_new_window()) {
            this.app.open_new_window(-1);
            return;
        }

        if (!windows.length) {
            this.app.activate();
            return;
        }

        if (this.dock.tracker.focus_app === this.app) {
            if (windows.length === 1)
                windows[0].minimize();
            else // a lista é MRU: ativar a última faz o ciclo por todas
                Main.activateWindow(windows[windows.length - 1]);
        } else {
            Main.activateWindow(windows[0]);
        }
    }

    acceptExternalDrop(uris, mods) {
        if (mods.alt)
            this.dock.openWithMenu(this, uris);
        else
            Launcher.openWithApp(this.app, uris);
        return true;
    }

    openMenu() {
        if (!this._menu) {
            const menu = new AppMenu(this, St.Side.BOTTOM, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            menu.setApp(this.app);
            this._recentsSection = new PopupMenu.PopupMenuSection();
            menu.addMenuItem(this._recentsSection, 0);
            this._setupMenu(menu);
        }
        this._fillRecents();
        this._openMenu();
    }

    _fillRecents() {
        this._recentsSection.removeAll();
        if (!this.dock.settings.get_boolean('show-recents'))
            return;

        Recents.getRecents(this.app, items => {
            if (!this._recentsSection || !items.length)
                return;
            this._recentsSection.removeAll();
            this._recentsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recentes'));
            for (const { uri, label } of items) {
                const name = label?.split(' [')[0] || Launcher.displayNameOf(uri);
                const item = this._recentsSection.addAction(name,
                    () => Launcher.openWithApp(this.app, [uri]));
                item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            }
            this._recentsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        });
    }

    _onDestroy() {
        this._recentsSection = null;
        super._onDestroy();
    }
});

/** Pasta (pilha) ou arquivo fixado na dock. */
var DockPinnedItem = GObject.registerClass({
    GTypeName: 'ProjetoDockPinnedItem',
}, class DockPinnedItem extends DockItem {
    _init(dock, uri) {
        super._init(dock);
        this.add_style_class_name('pinned');
        this.uri = uri;
        this.file = Gio.File.new_for_uri(uri);
        this.isDir = false;
        this._name = this.file.get_basename();

        let gicon = new Gio.ThemedIcon({ name: 'text-x-generic' });
        try {
            const info = this.file.query_info(
                'standard::icon,standard::display-name,standard::type',
                Gio.FileQueryInfoFlags.NONE, null);
            this.isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
            this._name = info.get_display_name();
            gicon = info.get_icon();
        } catch (e) {
            this.add_style_class_name('missing');
        }
        this.setIcon(new St.Icon({ gicon, icon_size: dock.iconSize }));
    }

    get tooltipText() {
        return this._name;
    }

    activate() {
        if (this.isDir)
            this.dock.openStack(this);
        else
            Launcher.openUri(this.uri);
    }

    acceptExternalDrop(uris, mods) {
        if (!this.isDir) {
            Main.notify(this._name, 'Solte arquivos sobre uma pasta ou sobre um aplicativo.');
            return false;
        }
        Launcher.transferInto(uris, this.uri, { copy: mods.ctrl });
        return true;
    }

    openMenu() {
        if (!this._menu) {
            const menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.BOTTOM);
            menu.addAction('Abrir', () => Launcher.openUri(this.uri));
            menu.addAction('Mostrar no gerenciador de arquivos', () => showInFileManager(this.uri));
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            menu.addAction('Remover da dock', () => this.dock.unpinUri(this.uri));
            this._setupMenu(menu);
        }
        this._openMenu();
    }
});

/** Botão da biblioteca de apps (como o do COSMIC). */
var ShowAppsButton = GObject.registerClass({
    GTypeName: 'ProjetoDockShowApps',
}, class ShowAppsButton extends DockItem {
    _init(dock) {
        super._init(dock);
        this.add_style_class_name('show-apps');
        this.setIcon(new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: Math.round(dock.iconSize * 0.6),
            style_class: 'projeto-dock-show-apps-icon',
            width: dock.iconSize,
            height: dock.iconSize,
        }));
    }

    get tooltipText() {
        return 'Mostrar aplicativos';
    }

    activate() {
        if (Main.overview.visible)
            Main.overview.hide();
        else
            Main.overview.showApps();
    }
});

function showInFileManager(uri) {
    Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1', 'ShowItems',
        new GLib.Variant('(ass)', [[uri], '']), null, Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                conn.call_finish(res);
            } catch (e) {
                Launcher.openUri(Gio.File.new_for_uri(uri).get_parent()?.get_uri() ?? uri);
            }
        });
}
