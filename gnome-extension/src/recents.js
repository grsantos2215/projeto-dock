/* exported getRecents */
const { Gio, GLib } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();

const MAX_ITEMS = 8;

function _isVSCode(app) {
    return /vscode|^code(-oss|-insiders)?\.desktop$|codium/i.test(app.get_id() ?? '');
}

function _vscodeRecents(callback) {
    const script = GLib.build_filenamev([Me.path, 'helper', 'vscode_recents.py']);
    try {
        const proc = Gio.Subprocess.new(['python3', script],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                callback(JSON.parse(stdout).slice(0, MAX_ITEMS));
            } catch (e) {
                callback([]);
            }
        });
    } catch (e) {
        callback([]);
    }
}

function _matchesApp(app, names, execs) {
    const info = app.get_app_info();
    const id = (app.get_id() ?? '').replace(/\.desktop$/, '').toLowerCase();
    const exe = GLib.path_get_basename(info?.get_executable() ?? '').toLowerCase();
    const name = (app.get_name() ?? '').toLowerCase();
    return names.some(n => {
        const l = n.toLowerCase();
        return l === id || l === exe || l === name || id.endsWith(`.${l}`);
    }) || (exe && execs.some(e => GLib.path_get_basename(e.replace(/^'|'$/g, '').split(' ')[0]) === exe));
}

function _unescapeXml(text) {
    return text.replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Arquivos recentes registrados em ~/.local/share/recently-used.xbel para o app.
 * (GLib.BookmarkFile não é construível no GJS do Ubuntu 22.04, então lemos o XML.)
 */
function _xbelRecents(app) {
    let xml;
    try {
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
        const [, bytes] = GLib.file_get_contents(path);
        xml = new TextDecoder().decode(bytes);
    } catch (e) {
        return [];
    }

    const items = [];
    for (const block of xml.split('<bookmark ').slice(1)) {
        const uri = _unescapeXml(block.match(/href="([^"]*)"/)?.[1] ?? '');
        if (!uri.startsWith('file://'))
            continue;
        const apps = [...block.matchAll(/<bookmark:application name="([^"]*)" exec="([^"]*)"(?:[^>]*modified="([^"]*)")?/g)];
        const names = apps.map(m => _unescapeXml(m[1]));
        const execs = apps.map(m => _unescapeXml(m[2]));
        if (!_matchesApp(app, names, execs))
            continue;
        if (!Gio.File.new_for_uri(uri).query_exists(null))
            continue;
        const modified = block.match(/modified="([^"]*)"/)?.[1];
        const stamp = modified ? Date.parse(modified) || 0 : 0;
        items.push({ uri, label: null, stamp });
    }
    return items.sort((a, b) => b.stamp - a.stamp).slice(0, MAX_ITEMS);
}

/** Chama callback([{uri, label}]) com os recentes do app (assíncrono para o VS Code). */
function getRecents(app, callback) {
    if (_isVSCode(app)) {
        _vscodeRecents(items => callback(items.length ? items : _xbelRecents(app)));
        return;
    }
    callback(_xbelRecents(app));
}
