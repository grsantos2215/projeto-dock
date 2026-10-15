/* exported init enable disable */
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { Dock } = Me.imports.src.dock;

let dock = null;

function init() {
}

function enable() {
    dock = new Dock();
}

function disable() {
    dock?.destroy();
    dock = null;
}
