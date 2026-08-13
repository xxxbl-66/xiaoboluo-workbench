const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, shell } = require('electron');
const { id, defaultGroups } = require('../defaults.cjs');

function readApps(store) {
  return store.read('apps.json', []);
}

function writeApps(store, apps) {
  store.write('apps.json', apps);
}

function readGroups(store) {
  let groups = store.read('app-groups.json', []);
  if (!groups.length) {
    groups = defaultGroups();
    store.write('app-groups.json', groups);
  }
  return groups;
}

function writeGroups(store, groups) {
  store.write('app-groups.json', groups);
}

function iconToDataUrl(filePath) {
  if (!filePath) return '';
  try {
    const absolute = path.isAbsolute(filePath) ? filePath : path.join(app.getPath('documents'), '..', filePath);
    if (!fs.existsSync(absolute)) return '';
    return `data:image/png;base64,${fs.readFileSync(absolute).toString('base64')}`;
  } catch (_) {
    return '';
  }
}

async function makeAppEntry(store, filePath, options = {}) {
  const name = options.name || path.basename(filePath, path.extname(filePath));
  const groupId = options.groupId || 'default';
  const appEntry = {
    id: id(),
    name,
    path: filePath,
    groupId,
    iconFile: '',
    sort: Date.now(),
    createdAt: new Date().toISOString(),
    lastLaunched: null,
    launchCount: 0
  };

  try {
    const icon = await app.getFileIcon(filePath, { size: 'large' });
    const buffer = icon.toPNG();
    if (buffer && buffer.length) {
      const iconFile = `${appEntry.id}.png`;
      fs.writeFileSync(path.join(store.appThumbsDir, iconFile), buffer);
      appEntry.iconFile = iconFile;
    }
  } catch (_) {
    appEntry.iconFile = '';
  }

  return appEntry;
}

function hydrateApp(store, entry) {
  return {
    ...entry,
    iconDataUrl: entry.iconFile
      ? iconToDataUrl(path.join(store.appThumbsDir, entry.iconFile))
      : ''
  };
}

async function addApp(store, filePath, options = {}) {
  const apps = readApps(store);
  const entry = await makeAppEntry(store, filePath, options);
  apps.push(entry);
  writeApps(store, apps);
  return hydrateApp(store, entry);
}

async function scanDesktop(store, groupId = 'default') {
  const desktopDirs = new Set();
  try {
    desktopDirs.add(app.getPath('desktop'));
  } catch (_) {}
  try {
    desktopDirs.add(path.join(app.getPath('home'), 'Desktop'));
  } catch (_) {}
  desktopDirs.add('C:\\Users\\Public\\Desktop');

  const candidates = [];
  for (const dir of desktopDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const ext = path.extname(name).toLowerCase();
        if (ext !== '.lnk' && ext !== '.exe') continue;
        candidates.push(path.join(dir, name));
      }
    } catch (_) {}
  }

  const apps = readApps(store);
  const existing = new Set(apps.map((item) => item.path.toLowerCase()));
  const added = [];
  for (const filePath of candidates) {
    if (existing.has(filePath.toLowerCase())) continue;
    const entry = await makeAppEntry(store, filePath, { groupId });
    apps.push(entry);
    existing.add(filePath.toLowerCase());
    added.push(hydrateApp(store, entry));
  }
  writeApps(store, apps);
  return added;
}

function reorderApps(store, groupId, orderedIds) {
  const apps = readApps(store);
  const orderMap = new Map(orderedIds.map((value, index) => [value, index]));
  for (const item of apps) {
    if (item.groupId === groupId && orderMap.has(item.id)) {
      item.sort = orderMap.get(item.id);
    }
  }
  writeApps(store, apps);
  return apps.filter((item) => item.groupId === groupId).map((item) => hydrateApp(store, item));
}

module.exports = {
  readApps,
  readGroups,
  writeGroups,
  addApp,
  scanDesktop,
  reorderApps,
  hydrateApp
};
