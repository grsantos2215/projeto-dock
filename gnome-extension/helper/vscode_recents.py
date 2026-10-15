#!/usr/bin/env python3
"""Imprime em JSON as pastas/arquivos recentes do VS Code (lê state.vscdb somente leitura)."""
import json
import os
import sqlite3
import sys

CONFIG_DIRS = ['Code', 'Code - Insiders', 'Code - OSS', 'VSCodium']


def main():
    base = os.environ.get('XDG_CONFIG_HOME', os.path.expanduser('~/.config'))
    wanted = sys.argv[1:] or CONFIG_DIRS
    for name in wanted:
        db = os.path.join(base, name, 'User', 'globalStorage', 'state.vscdb')
        if not os.path.exists(db):
            continue
        conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=1)
        row = conn.execute(
            "SELECT value FROM ItemTable WHERE key IN "
            "('history.recentlyOpenedPathsList', 'recently.opened')").fetchone()
        if not row:
            continue
        out = []
        for entry in json.loads(row[0]).get('entries', []):
            uri = (entry.get('folderUri') or entry.get('fileUri') or
                   (entry.get('workspace') or {}).get('configPath'))
            if uri and uri.startswith('file://'):
                out.append({'uri': uri, 'label': entry.get('label')})
        print(json.dumps(out))
        return
    print('[]')


if __name__ == '__main__':
    main()
