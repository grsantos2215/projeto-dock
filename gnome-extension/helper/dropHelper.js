#!/usr/bin/env gjs
/*
 * Janela GTK4 transparente que a extensão posiciona sobre a dock durante um
 * arrasto. O GNOME Shell não consegue ler os dados de um arrasto vindo de
 * outro app (Nautilus, navegador...), mas uma janela comum consegue: ela recebe
 * o drop e repassa as URIs para a extensão pela saída padrão.
 *
 * Protocolo (uma linha por evento, em stdout):
 *   @@READY
 *   @@ENTER / @@LEAVE
 *   @@DROP {"uris": [...], "x": n, "y": n, "alt": b, "ctrl": b, "shift": b}
 */
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
const { Gdk, Gio, GLib, GObject, Gtk } = imports.gi;

const DEBUG = GLib.getenv('PROJETO_DOCK_DEBUG') === '1';

// stdout é um pipe: escrever sem buffer para a extensão receber na hora
const stdout = new Gio.DataOutputStream({
    base_stream: new Gio.UnixOutputStream({ fd: 1, close_fd: false }),
});

function send(kind, payload) {
    const line = payload === undefined ? `@@${kind}` : `@@${kind} ${JSON.stringify(payload)}`;
    try {
        stdout.put_string(`${line}\n`, null);
        stdout.flush(null);
    } catch (e) {
        app.quit(); // a extensão sumiu
    }
}

/** A extensão mantém nosso stdin aberto; EOF = Shell reiniciou ou extensão desligada. */
function watchParent() {
    const stdin = new Gio.UnixInputStream({ fd: 0, close_fd: false });
    const readMore = () => stdin.read_bytes_async(64, GLib.PRIORITY_DEFAULT, null, (s, res) => {
        try {
            if (s.read_bytes_finish(res).get_size() > 0) {
                readMore();
                return;
            }
        } catch (e) {}
        app.quit();
    });
    readMore();
}

function urisFromValue(value) {
    if (value instanceof Gdk.FileList)
        return value.get_files().map(f => f.get_uri());
    if (typeof value === 'string') {
        // text/uri-list ou um link solto (ex.: arrastado do navegador)
        return value.split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#') && /^[a-z][a-z0-9+.-]*:/i.test(l));
    }
    return [];
}

const app = new Gtk.Application({
    application_id: 'io.github.projetodock.DropHelper',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    const css = new Gtk.CssProvider();
    css.load_from_data(DEBUG
        ? 'window { background: rgba(255, 0, 0, 0.25); }'
        : 'window { background: none; box-shadow: none; }');
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const win = new Gtk.ApplicationWindow({
        application: app,
        title: 'projeto-dock-drop-target',
        decorated: false,
        resizable: true,
        default_width: 600,
        default_height: 80,
    });
    const area = new Gtk.Box({ hexpand: true, vexpand: true });
    win.set_child(area);

    // Só COPY: assim o app de origem nunca apaga o arquivo depois do drop.
    const target = new Gtk.DropTarget({ actions: Gdk.DragAction.COPY });
    target.set_gtypes([Gdk.FileList.$gtype, GObject.TYPE_STRING]);
    target.connect('enter', () => {
        send('ENTER');
        return Gdk.DragAction.COPY;
    });
    target.connect('leave', () => send('LEAVE'));
    target.connect('drop', (t, value, x, y) => {
        const uris = urisFromValue(value);
        if (!uris.length)
            return false;
        const state = t.get_current_event_state();
        send('DROP', {
            uris,
            x: Math.round(x),
            y: Math.round(y),
            alt: (state & Gdk.ModifierType.ALT_MASK) !== 0,
            ctrl: (state & Gdk.ModifierType.CONTROL_MASK) !== 0,
            shift: (state & Gdk.ModifierType.SHIFT_MASK) !== 0,
        });
        return true;
    });
    area.add_controller(target);

    // compositor caiu (Shell reiniciou): sair em vez de ficar órfão
    Gdk.Display.get_default().connect('closed', () => app.quit());

    win.present();
    watchParent();
    send('READY');
});

app.run([]);
