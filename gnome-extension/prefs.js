/* exported init fillPreferencesWindow */
const { Adw, Gio, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

const AUTOHIDE_MODES = [
    ['always-visible', 'Sempre visível (reserva espaço na tela)'],
    ['autohide', 'Esconder automaticamente'],
    ['intellihide', 'Esconder quando uma janela encostar (intellihide)'],
];

function init() {
}

function _spinRow(settings, key, title, subtitle, min, max) {
    const row = new Adw.ActionRow({ title, subtitle });
    const spin = Gtk.SpinButton.new_with_range(min, max, 1);
    spin.valign = Gtk.Align.CENTER;
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(spin);
    return row;
}

function _switchRow(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({ title, subtitle });
    const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    return row;
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();

    const look = new Adw.PreferencesGroup({ title: 'Aparência' });
    look.add(_spinRow(settings, 'icon-size', 'Tamanho dos ícones', 'Em pixels', 24, 96));
    look.add(_spinRow(settings, 'bottom-margin', 'Distância da borda',
        'Espaço entre a dock e a parte de baixo da tela', 0, 64));
    page.add(look);

    const behavior = new Adw.PreferencesGroup({ title: 'Comportamento' });
    const modeRow = new Adw.ComboRow({
        title: 'Esconder a dock',
        model: Gtk.StringList.new(AUTOHIDE_MODES.map(([, label]) => label)),
    });
    const syncMode = () => {
        modeRow.selected = Math.max(0,
            AUTOHIDE_MODES.findIndex(([id]) => id === settings.get_string('autohide-mode')));
    };
    syncMode();
    settings.connect('changed::autohide-mode', syncMode);
    modeRow.connect('notify::selected', () =>
        settings.set_string('autohide-mode', AUTOHIDE_MODES[modeRow.selected][0]));
    behavior.add(modeRow);
    behavior.add(_switchRow(settings, 'show-previews', 'Miniaturas das janelas',
        'Ao passar o mouse sobre um app aberto'));
    behavior.add(_switchRow(settings, 'show-recents', 'Arquivos recentes no menu',
        'Botão direito em um app mostra os arquivos/projetos usados recentemente'));
    page.add(behavior);

    const tips = new Adw.PreferencesGroup({
        title: 'Arrastar e soltar',
        description: 'Solte arquivos ou pastas sobre um app para abri-los nele (mesmo que já esteja aberto).\n' +
            'Segure Alt ao soltar para escolher com qual app abrir.\n' +
            'Solte sobre uma pasta fixada para mover (Ctrl para copiar).\n' +
            'Solte numa área vazia da dock para fixar a pasta ou o arquivo.',
    });
    page.add(tips);

    window.add(page);
}
