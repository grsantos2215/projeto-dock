/* exported StackMenu */
const { Clutter, Gio, Pango, St } = imports.gi;
const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Launcher = Me.imports.src.launcher;
const { showInFileManager } = Me.imports.src.items;

const COLUMNS = 5;
const MAX_ITEMS = 20;
const MAX_SCAN = 2000;
const ICON_SIZE = 48;

/** Lista os itens mais recentes da pasta (como a pilha de Downloads do macOS). */
function _listFolder(folder) {
    const entries = [];
    let total = 0;
    try {
        const enumerator = folder.enumerate_children(
            'standard::name,standard::display-name,standard::icon,standard::is-hidden,' +
            'standard::is-backup,time::modified,thumbnail::path',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) && total < MAX_SCAN) {
            if (info.get_is_hidden() || info.get_is_backup())
                continue;
            total++;
            entries.push(info);
        }
        enumerator.close(null);
    } catch (e) {
        logError(e, '[projeto-dock] falha ao ler pasta');
    }
    const mtime = i => i.get_attribute_uint64('time::modified');
    entries.sort((a, b) => mtime(b) - mtime(a));
    return { entries: entries.slice(0, MAX_ITEMS), total };
}

function _iconFor(info) {
    const thumb = info.get_attribute_byte_string('thumbnail::path');
    const gicon = thumb ? new Gio.FileIcon({ file: Gio.File.new_for_path(thumb) }) : info.get_icon();
    return new St.Icon({ gicon, icon_size: ICON_SIZE });
}

var StackMenu = class {
    constructor(item) {
        this._item = item;
        this.menu = new PopupMenu.PopupMenu(item, 0.5, St.Side.BOTTOM);
        this.menu.actor.add_style_class_name('projeto-dock-stack-menu');
        Main.uiGroup.add_actor(this.menu.actor);
        this.menu.actor.hide();
        item.dock.menuManager.addMenu(this.menu);
        this.menu.connect('open-state-changed', (m, open) =>
            item.dock.autohide.setBlocked('stack', open));
    }

    open() {
        this._fill();
        this.menu.open(BoxPointer.PopupAnimation.FULL);
        this._item.dock.menuManager.ignoreRelease();
    }

    _fill() {
        this.menu.removeAll();
        const folder = this._item.file;
        const { entries, total } = _listFolder(folder);

        const gridItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const grid = new St.Widget({
            style_class: 'projeto-dock-stack-grid',
            layout_manager: new Clutter.GridLayout({ column_spacing: 4, row_spacing: 4 }),
            x_expand: true,
        });
        const layout = grid.layout_manager;

        if (!entries.length) {
            grid.add_child(new St.Label({ text: 'Pasta vazia', style_class: 'projeto-dock-stack-empty' }));
        }

        entries.forEach((info, i) => {
            const child = folder.get_child(info.get_name());
            const box = new St.BoxLayout({ vertical: true, style_class: 'projeto-dock-stack-cell' });
            const label = new St.Label({
                text: info.get_display_name(),
                style_class: 'projeto-dock-stack-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            const icon = _iconFor(info);
            icon.x_align = Clutter.ActorAlign.CENTER;
            box.add_child(icon);
            box.add_child(label);

            const button = new St.Button({ style_class: 'projeto-dock-stack-button', child: box, can_focus: true });
            button.connect('clicked', () => {
                this.menu.close();
                Launcher.openUri(child.get_uri());
            });
            layout.attach(button, i % COLUMNS, Math.floor(i / COLUMNS), 1, 1);
        });
        gridItem.add_child(grid);
        this.menu.addMenuItem(gridItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const more = total > entries.length ? ` (${total} itens)` : '';
        this.menu.addAction(`Abrir "${this._item.tooltipText}"${more}`,
            () => Launcher.openUri(folder.get_uri()));
        this.menu.addAction('Mostrar no gerenciador de arquivos', () => showInFileManager(folder.get_uri()));
    }

    destroy() {
        this.menu.destroy();
    }
};
