/* exported Dock */
const { Gio, GLib, Shell, St } = imports.gi;
const Main = imports.ui.main;
const AppFavorites = imports.ui.appFavorites;
const BoxPointer = imports.ui.boxpointer;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const { Autohide } = Me.imports.src.autohide;
const { LauncherEntryModel } = Me.imports.src.badges;
const { DropTarget } = Me.imports.src.dropTarget;
const { DockAppIcon, DockPinnedItem, ShowAppsButton } = Me.imports.src.items;
const Launcher = Me.imports.src.launcher;
const { StackMenu } = Me.imports.src.stacks;
const { PreviewPopup } = Me.imports.src.windowPreviews;

const PREVIEW_DELAY = 400;
const MAX_OPEN_WITH = 10;

var Dock = class {
    constructor() {
        this.settings = ExtensionUtils.getSettings();
        this.appSystem = Shell.AppSystem.get_default();
        this.tracker = Shell.WindowTracker.get_default();
        this.favorites = AppFavorites.getAppFavorites();

        this._appIcons = new Map(); // appId -> DockAppIcon
        this._pinnedItems = new Map(); // uri -> DockPinnedItem
        this._stacks = new Map(); // uri -> StackMenu
        this._runningOrder = [];
        this._redisplayId = 0;
        this._previewId = 0;
        this._dropMode = false;
        this.destroying = false;

        this._buildActors();

        this.menuManager = new PopupMenu.PopupMenuManager(this.box);
        this.autohide = new Autohide(this);
        this.previews = new PreviewPopup(this);
        this.badges = new LauncherEntryModel(appId => this._appIcons.get(appId)?.syncBadge());
        this.dropTarget = new DropTarget(this);

        this.appSystem.connectObject(
            'app-state-changed', () => this.queueRedisplay(),
            'installed-changed', () => this.queueRedisplay(), this);
        this.favorites.connectObject('changed', () => this.queueRedisplay(), this);
        global.display.connectObject('window-created', () => this.queueRedisplay(), this);
        this.settings.connectObject(
            'changed::pinned-items', () => this.queueRedisplay(),
            'changed::icon-size', () => this._rebuildAll(),
            'changed::bottom-margin', () => this._syncMargin(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._reposition(), this);
        Main.overview.connectObject(
            'showing', () => this._onOverview(true),
            'hidden', () => this._onOverview(false), this);

        this._rebuildAll();
    }

    _buildActors() {
        // container encostado na borda (para os struts), com a barra flutuando dentro
        this.container = new St.Bin({ name: 'projetoDock', style_class: 'projeto-dock-container' });
        this.box = new St.BoxLayout({ style_class: 'projeto-dock', reactive: true, track_hover: true });
        this.container.set_child(this.box);

        this.appsBox = new St.BoxLayout({ style_class: 'projeto-dock-section' });
        this.pinnedSeparator = new St.Widget({ style_class: 'projeto-dock-separator', y_expand: true });
        this.pinnedBox = new St.BoxLayout({ style_class: 'projeto-dock-section' });
        this.showAppsSeparator = new St.Widget({ style_class: 'projeto-dock-separator', y_expand: true });
        this.box.add_child(this.appsBox);
        this.box.add_child(this.pinnedSeparator);
        this.box.add_child(this.pinnedBox);
        this.box.add_child(this.showAppsSeparator);

        this._tooltip = new St.Label({ style_class: 'projeto-dock-tooltip', visible: false });
        Main.uiGroup.add_actor(this._tooltip);

        Main.layoutManager.addChrome(this.container, { trackFullscreen: true });
        this.container.connect('notify::width', () => this._reposition());
        this.container.connect('notify::height', () => this._reposition());
        this._syncMargin();
    }

    // ---- geometria ----

    get monitor() {
        return Main.layoutManager.primaryMonitor;
    }

    get monitorIndex() {
        return Main.layoutManager.primaryIndex;
    }

    get iconSize() {
        return this.settings.get_int('icon-size');
    }

    get menuOpen() {
        return !!this.menuManager.activeMenu;
    }

    _syncMargin() {
        this.container.style = `padding-bottom: ${this.settings.get_int('bottom-margin')}px;`;
    }

    _reposition() {
        const m = this.monitor;
        if (!m)
            return;
        const [, natW] = this.container.get_preferred_width(-1);
        const [, natH] = this.container.get_preferred_height(natW);
        this.container.set_position(
            Math.round(m.x + (m.width - natW) / 2),
            Math.round(m.y + m.height - natH));
        this.autohide?.syncHotZone();
        this.autohide?.queueCheck();
    }

    /** Retângulo da barra quando visível (ignora a animação de esconder). */
    getShownRect() {
        const [x, y] = this.box.get_transformed_position();
        const [width, height] = this.box.get_transformed_size();
        return {
            x: Math.round(x),
            y: Math.round(y - this.container.translation_y),
            width: Math.round(width),
            height: Math.round(height),
        };
    }

    get items() {
        return [...this.appsBox.get_children(), ...this.pinnedBox.get_children(), this.showAppsButton]
            .filter(i => i);
    }

    /** Item sob o ponto (coordenadas de tela) e se o ponto está na barra. */
    itemAt(x, y) {
        const r = this.getShownRect();
        const inDock = x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
        const ty = this.container.translation_y;
        for (const item of this.items) {
            const [ix, iy] = item.get_transformed_position();
            const [w, h] = item.get_transformed_size();
            if (x >= ix && x <= ix + w && y >= iy - ty && y <= iy - ty + h)
                return { item, inDock: true };
        }
        return { item: null, inDock };
    }

    isHiddenWindow(metaWindow) {
        return metaWindow.skip_taskbar || !!this.dropTarget?.isHelperWindow(metaWindow);
    }

    _onOverview(showing) {
        this.box.visible = !showing;
        this.previews.hide();
        this.hideTooltip();
        this.autohide.syncHotZone();
    }

    // ---- conteúdo ----

    queueRedisplay() {
        if (this._redisplayId)
            return;
        this._redisplayId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._redisplayId = 0;
            this._redisplay();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildAll() {
        for (const icon of this._appIcons.values())
            icon.destroy();
        this._appIcons.clear();
        for (const item of this._pinnedItems.values())
            item.destroy();
        this._pinnedItems.clear();
        this.showAppsButton?.destroy();
        this.showAppsButton = new ShowAppsButton(this);
        this.box.add_child(this.showAppsButton);
        this._redisplay();
    }

    _redisplay() {
        const favorites = this.favorites.getFavorites();
        const favIds = favorites.map(a => a.get_id());
        const running = this.appSystem.get_running()
            .filter(app => app.get_windows().some(w => !this.isHiddenWindow(w)));
        const runningIds = running.map(a => a.get_id());

        // apps abertos mantêm a ordem em que apareceram
        this._runningOrder = this._runningOrder.filter(id => runningIds.includes(id));
        for (const id of runningIds) {
            if (!this._runningOrder.includes(id))
                this._runningOrder.push(id);
        }
        const apps = [
            ...favorites,
            ...this._runningOrder.filter(id => !favIds.includes(id))
                .map(id => running.find(a => a.get_id() === id)),
        ];

        this._reconcile(this.appsBox, this._appIcons, apps.map(app => [app.get_id(), app]),
            (app, icon) => icon.app === app, app => new DockAppIcon(this, app));

        const uris = this.settings.get_strv('pinned-items');
        this._reconcile(this.pinnedBox, this._pinnedItems, uris.map(uri => [uri, uri]),
            () => true, uri => new DockPinnedItem(this, uri));
        for (const [uri, stack] of this._stacks) {
            if (!this._pinnedItems.has(uri)) {
                stack.destroy();
                this._stacks.delete(uri);
            }
        }

        this.pinnedSeparator.visible = uris.length > 0;
        this.showAppsSeparator.visible = apps.length > 0 || uris.length > 0;
    }

    /** Sincroniza os filhos de `box` com a lista `wanted` reaproveitando atores. */
    _reconcile(box, cache, wanted, matches, create) {
        const wantedMap = new Map(wanted);
        for (const [key, actor] of cache) {
            if (!wantedMap.has(key) || !matches(wantedMap.get(key), actor)) {
                actor.destroy();
                cache.delete(key);
            }
        }
        wanted.forEach(([key, value], index) => {
            let actor = cache.get(key);
            if (!actor) {
                actor = create(value);
                cache.set(key, actor);
                box.insert_child_at_index(actor, index);
            } else if (box.get_child_at_index(index) !== actor) {
                box.set_child_at_index(actor, index);
            }
        });
    }

    pinUris(uris) {
        const current = this.settings.get_strv('pinned-items');
        const added = uris.filter(u => u.startsWith('file://') && !current.includes(u));
        if (added.length)
            this.settings.set_strv('pinned-items', [...current, ...added]);
    }

    unpinUri(uri) {
        this.settings.set_strv('pinned-items',
            this.settings.get_strv('pinned-items').filter(u => u !== uri));
    }

    openStack(item) {
        let stack = this._stacks.get(item.uri);
        if (!stack) {
            stack = new StackMenu(item);
            this._stacks.set(item.uri, stack);
        }
        stack.open();
    }

    // ---- hover: tooltip e miniaturas ----

    onItemHover(item) {
        if (this._dropMode)
            return;
        this._cancelPreview();

        if (!item.hover) {
            this.hideTooltip(item);
            if (this.previews.item === item)
                this.previews.hideSoon();
            return;
        }

        const wantsPreview = item instanceof DockAppIcon &&
            this.settings.get_boolean('show-previews') &&
            item.getWindows().length > 0 && !this.menuOpen;

        if (wantsPreview && this.previews.actor.visible) {
            // já há miniaturas abertas: troca na hora
            this.previews.showFor(item);
            return;
        }
        if (this.previews.actor.visible)
            this.previews.hideSoon();

        this.showTooltip(item);
        if (wantsPreview) {
            this._previewId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PREVIEW_DELAY, () => {
                this._previewId = 0;
                if (item.hover && !this.menuOpen) {
                    this.hideTooltip();
                    this.previews.showFor(item);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _cancelPreview() {
        if (this._previewId) {
            GLib.source_remove(this._previewId);
            this._previewId = 0;
        }
    }

    showTooltip(item) {
        if (!item.tooltipText || this.menuOpen)
            return;
        this._tooltipItem = item;
        this._tooltip.text = item.tooltipText;
        this._tooltip.show();
        const [ix] = item.get_transformed_position();
        const [iw] = item.get_transformed_size();
        const [, tw] = this._tooltip.get_preferred_width(-1);
        const [, th] = this._tooltip.get_preferred_height(tw);
        const m = this.monitor;
        const x = Math.max(m.x + 4, Math.min(ix + (iw - tw) / 2, m.x + m.width - tw - 4));
        this._tooltip.set_position(Math.round(x), Math.round(this.getShownRect().y - th - 8));
    }

    hideTooltip(item = null) {
        if (item && item !== this._tooltipItem)
            return;
        this._tooltip.hide();
        this._tooltipItem = null;
    }

    // ---- arrastar e soltar ----

    setDropMode(enabled) {
        this._dropMode = enabled;
        for (const item of this.items)
            item.reactive = !enabled;
        this.box.reactive = !enabled;
        if (enabled) {
            this._cancelPreview();
            this.previews.hide();
            this.hideTooltip();
            this.box.add_style_class_name('drop-mode');
        } else {
            this.box.remove_style_class_name('drop-mode');
            this.box.sync_hover();
        }
    }

    handleExternalDrop({ item, inDock }, uris, mods) {
        if (item instanceof ShowAppsButton || (!item && inDock))
            this.pinUris(uris);
        else if (item)
            item.acceptExternalDrop(uris, mods);
    }

    /** Alt + soltar: escolher com qual app abrir. */
    openWithMenu(icon, uris) {
        const menu = new PopupMenu.PopupMenu(icon, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_actor(menu.actor);
        this.menuManager.addMenu(menu);

        const title = uris.length === 1
            ? `Abrir "${Launcher.displayNameOf(uris[0])}" com`
            : `Abrir ${uris.length} itens com`;
        const header = new PopupMenu.PopupMenuItem(title, { reactive: false });
        header.label.add_style_class_name('projeto-dock-menu-title');
        menu.addMenuItem(header);

        const apps = [icon.app, ...Launcher.appsForUris(uris).filter(a => a !== icon.app)]
            .slice(0, MAX_OPEN_WITH);
        for (const app of apps) {
            const item = new PopupMenu.PopupImageMenuItem(app.get_name(), app.get_icon());
            item.connect('activate', () => Launcher.openWithApp(app, uris));
            menu.addMenuItem(item);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (Launcher.newWindowAppInfo(icon.app)) {
            menu.addAction(`Abrir em nova janela do ${icon.app.get_name()}`,
                () => Launcher.openWithApp(icon.app, uris, { newWindow: true }));
        }
        menu.addAction('Fixar na dock', () => this.pinUris(uris));
        menu.addAction('Copiar caminho', () => {
            const paths = uris.map(u => Gio.File.new_for_uri(u).get_path() ?? u);
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, paths.join('\n'));
        });

        menu.connect('open-state-changed', (m, open) => {
            this.autohide.setBlocked('open-with', open);
            if (!open) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this.menuManager.removeMenu(menu);
                    menu.destroy();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    destroy() {
        this.destroying = true;
        if (this._redisplayId)
            GLib.source_remove(this._redisplayId);
        this._cancelPreview();

        this.appSystem.disconnectObject(this);
        this.favorites.disconnectObject(this);
        global.display.disconnectObject(this);
        this.settings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        this.dropTarget.destroy();
        this.previews.destroy();
        for (const stack of this._stacks.values())
            stack.destroy();
        this._stacks.clear();

        Main.layoutManager.removeChrome(this.container);
        this.container.destroy();
        this._appIcons.clear();
        this._pinnedItems.clear();
        this.autohide.destroy();
        this.badges.destroy();
        this._tooltip.destroy();
    }
};
