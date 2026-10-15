/* exported LauncherEntryModel */
const { Gio } = imports.gi;

/**
 * Implementa a API com.canonical.Unity.LauncherEntry: apps (Chrome, Telegram,
 * Thunderbird, VS Code...) enviam contador, progresso e "urgente" para a dock.
 */
var LauncherEntryModel = class {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._entries = new Map(); // appId -> {count, countVisible, progress, progressVisible, urgent}
        this._senders = new Map(); // dbus sender -> Set(appId)

        this._updateId = Gio.DBus.session.signal_subscribe(null,
            'com.canonical.Unity.LauncherEntry', 'Update', null, null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => this._onUpdate(sender, ...params.deep_unpack()));

        this._ownerId = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name, , newOwner] = params.deep_unpack();
                if (!newOwner && this._senders.has(name))
                    this._clearSender(name);
            });

        // libunity só envia atualizações se alguém tiver esse nome no barramento
        this._nameId = Gio.bus_own_name(Gio.BusType.SESSION, 'com.canonical.Unity',
            Gio.BusNameOwnerFlags.ALLOW_REPLACEMENT | Gio.BusNameOwnerFlags.REPLACE,
            null, null, null);
    }

    get(appId) {
        return this._entries.get(appId) ?? null;
    }

    _onUpdate(sender, appUri, props) {
        const appId = appUri.replace(/^application:\/\//, '');
        const entry = this._entries.get(appId) ?? {
            count: 0, countVisible: false, progress: 0, progressVisible: false, urgent: false,
        };
        const value = key => props[key]?.deep_unpack?.() ?? props[key];

        if ('count' in props)
            entry.count = Number(value('count'));
        if ('count-visible' in props)
            entry.countVisible = value('count-visible');
        if ('progress' in props)
            entry.progress = value('progress');
        if ('progress-visible' in props)
            entry.progressVisible = value('progress-visible');
        if ('urgent' in props)
            entry.urgent = value('urgent');

        this._entries.set(appId, entry);
        if (!this._senders.has(sender))
            this._senders.set(sender, new Set());
        this._senders.get(sender).add(appId);
        this._onChanged(appId);
    }

    _clearSender(sender) {
        for (const appId of this._senders.get(sender)) {
            this._entries.delete(appId);
            this._onChanged(appId);
        }
        this._senders.delete(sender);
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._updateId);
        Gio.DBus.session.signal_unsubscribe(this._ownerId);
        Gio.bus_unown_name(this._nameId);
        this._entries.clear();
    }
};
