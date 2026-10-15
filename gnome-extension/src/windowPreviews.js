/* exported PreviewPopup */
const { Clutter, GLib, Pango, St } = imports.gi;
const Main = imports.ui.main;

const THUMB_W = 220;
const THUMB_H = 140;
const HIDE_DELAY = 250;

/** Miniaturas das janelas de um app, mostradas acima do ícone no hover. */
var PreviewPopup = class {
    constructor(dock) {
        this.dock = dock;
        this._item = null;
        this._hideId = 0;

        this.actor = new St.BoxLayout({
            style_class: 'projeto-dock-previews',
            reactive: true,
            track_hover: true,
            visible: false,
        });
        Main.layoutManager.addTopChrome(this.actor);
        this.actor.connect('notify::hover', () => this.hideSoon());
    }

    get item() {
        return this._item;
    }

    showFor(item) {
        this._cancelHide();
        this._item = item;
        this._rebuild();
    }

    /** Chamado quando as janelas do app mudam enquanto o popup está aberto. */
    refresh(item) {
        if (this.actor.visible && item === this._item)
            this._rebuild();
    }

    _rebuild() {
        const windows = this._item.getWindows();
        this.actor.destroy_all_children();
        if (!windows.length) {
            this.hide();
            return;
        }
        for (const w of windows)
            this.actor.add_child(this._buildPreview(w));

        this.actor.show();
        this.dock.autohide.setBlocked('previews', true);
        this._position();
    }

    _buildPreview(metaWindow) {
        const button = new St.Button({ style_class: 'projeto-dock-preview', can_focus: true });
        const box = new St.BoxLayout({ vertical: true, style_class: 'projeto-dock-preview-box' });

        const header = new St.BoxLayout({ style_class: 'projeto-dock-preview-header' });
        const title = new St.Label({
            text: metaWindow.get_title() ?? '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'projeto-dock-preview-title',
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const close = new St.Button({
            style_class: 'projeto-dock-preview-close',
            child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 12 }),
        });
        close.connect('clicked', () => metaWindow.delete(global.get_current_time()));
        header.add_child(title);
        header.add_child(close);

        const thumbBin = new St.Bin({
            width: THUMB_W,
            height: THUMB_H,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const windowActor = metaWindow.get_compositor_private();
        if (windowActor && !metaWindow.minimized) {
            const [w, h] = windowActor.get_size();
            const scale = Math.min(THUMB_W / w, THUMB_H / h, 1);
            thumbBin.set_child(new Clutter.Clone({
                source: windowActor,
                width: Math.round(w * scale),
                height: Math.round(h * scale),
            }));
        } else {
            thumbBin.set_child(this._item.app.create_icon_texture(64));
            thumbBin.add_style_class_name('minimized');
        }

        box.add_child(header);
        box.add_child(thumbBin);
        button.set_child(box);
        button.connect('clicked', () => {
            Main.activateWindow(metaWindow);
            this.hide();
        });
        return button;
    }

    _position() {
        const item = this._item;
        const monitor = this.dock.monitor;
        const [ix] = item.get_transformed_position();
        const [iw] = item.get_transformed_size();
        const [, natW] = this.actor.get_preferred_width(-1);
        const [, natH] = this.actor.get_preferred_height(natW);
        const dockTop = this.dock.getShownRect().y;

        const x = Math.max(monitor.x + 8,
            Math.min(ix + iw / 2 - natW / 2, monitor.x + monitor.width - natW - 8));
        this.actor.set_position(Math.round(x), Math.round(dockTop - natH - 8));
    }

    /** Esconde se o mouse não voltar ao ícone ou ao popup. */
    hideSoon() {
        this._cancelHide();
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY, () => {
            this._hideId = 0;
            if (!this.actor.hover && !this._item?.hover)
                this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelHide() {
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }
    }

    hide() {
        this._cancelHide();
        this.actor.hide();
        this.actor.destroy_all_children();
        this._item = null;
        this.dock.autohide.setBlocked('previews', false);
    }

    destroy() {
        this._cancelHide();
        this.actor.destroy();
    }
};
