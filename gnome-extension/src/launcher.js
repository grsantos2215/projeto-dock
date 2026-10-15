/* exported openWithApp, newWindowAppInfo, appsForUris, contentTypeOf, displayNameOf, openUri, transferInto */
const { Gio, GLib, Shell } = imports.gi;
const Main = imports.ui.main;

function _launchContext() {
    // O timestamp vira um token de ativação: permite que o app (inclusive uma
    // instância já aberta) traga a janela para frente no Wayland.
    return global.create_app_launch_context(global.get_current_time(), -1);
}

function contentTypeOf(uri) {
    try {
        const info = Gio.File.new_for_uri(uri).query_info(
            'standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_content_type();
    } catch (e) {
        // URIs remotas (http...) não têm arquivo local
        return uri.startsWith('http') ? 'x-scheme-handler/https' : null;
    }
}

function displayNameOf(uri) {
    const file = Gio.File.new_for_uri(uri);
    try {
        return file.query_info('standard::display-name', Gio.FileQueryInfoFlags.NONE, null)
            .get_display_name();
    } catch (e) {
        return file.get_basename() ?? uri;
    }
}

/**
 * Procura uma ação "nova janela" do .desktop que aceite arquivos
 * (ex.: VS Code: `code --new-window %F`) e devolve um AppInfo para ela.
 */
function newWindowAppInfo(app) {
    const info = app.get_app_info();
    const filename = info?.get_filename();
    if (!filename)
        return null;

    const keyFile = new GLib.KeyFile();
    try {
        keyFile.load_from_file(filename, GLib.KeyFileFlags.NONE);
    } catch (e) {
        return null;
    }

    for (const action of info.list_actions()) {
        if (!/new.*window/i.test(action))
            continue;
        let exec;
        try {
            exec = keyFile.get_string(`Desktop Action ${action}`, 'Exec');
        } catch (e) {
            continue;
        }
        if (!/%[fFuU]/.test(exec))
            continue;

        const kf = new GLib.KeyFile();
        kf.set_string('Desktop Entry', 'Type', 'Application');
        kf.set_string('Desktop Entry', 'Name', info.get_name());
        kf.set_string('Desktop Entry', 'Exec', exec);
        return Gio.DesktopAppInfo.new_from_keyfile(kf);
    }
    return null;
}

/** Abre as URIs no app. Retorna false se o app não aceita arquivos. */
function openWithApp(app, uris, { newWindow = false } = {}) {
    const info = app.get_app_info();
    if (!info)
        return false;

    try {
        if (newWindow) {
            const nwInfo = newWindowAppInfo(app);
            if (nwInfo) {
                nwInfo.launch_uris(uris, _launchContext());
                return true;
            }
        }

        if (!info.supports_uris() && !info.supports_files()) {
            Main.notify(info.get_name(), 'Este aplicativo não aceita abrir arquivos.');
            return false;
        }

        info.launch_uris(uris, _launchContext());
        return true;
    } catch (e) {
        logError(e, '[projeto-dock] falha ao abrir arquivos');
        Main.notify(info.get_name(), e.message);
        return false;
    }
}

/** Apps capazes de abrir todas as URIs, com o app padrão primeiro. */
function appsForUris(uris) {
    const appSystem = Shell.AppSystem.get_default();
    const types = [...new Set(uris.map(contentTypeOf).filter(t => t))];
    if (!types.length)
        return [];

    const idsPerType = types.map(type => {
        const ids = [];
        const def = Gio.AppInfo.get_default_for_type(type, false);
        if (def)
            ids.push(def.get_id());
        for (const i of Gio.AppInfo.get_recommended_for_type(type))
            ids.push(i.get_id());
        for (const i of Gio.AppInfo.get_all_for_type(type))
            ids.push(i.get_id());
        return [...new Set(ids)];
    });

    // interseção: apps que servem para todos os tipos arrastados
    const [first, ...rest] = idsPerType;
    return first
        .filter(id => rest.every(ids => ids.includes(id)))
        .map(id => appSystem.lookup_app(id))
        .filter(app => app);
}

function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, _launchContext());
    } catch (e) {
        Main.notify('Não foi possível abrir', e.message);
    }
}

/** Move (ou copia) arquivos para dentro de uma pasta, sem sobrescrever nada. */
function transferInto(uris, folderUri, { copy = false } = {}) {
    const folder = Gio.File.new_for_uri(folderUri);
    const paths = uris
        .map(uri => Gio.File.new_for_uri(uri))
        .filter(src => src.get_path() && !src.equal(folder) && !folder.has_prefix(src) &&
            !src.get_parent()?.equal(folder))
        .map(src => src.get_path());
    if (!paths.length || !folder.get_path())
        return;

    // cp/mv já tratam pastas recursivamente e entre partições; -n nunca sobrescreve
    const argv = copy ? ['cp', '-rn', '--', ...paths, folder.get_path()]
        : ['mv', '-n', '--', ...paths, folder.get_path()];
    try {
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            const [, , stderr] = p.communicate_utf8_finish(res);
            if (!p.get_successful())
                Main.notify(`Não foi possível ${copy ? 'copiar' : 'mover'} os itens`, stderr ?? '');
        });
    } catch (e) {
        Main.notify(`Não foi possível ${copy ? 'copiar' : 'mover'} os itens`, e.message);
    }
}
