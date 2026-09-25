const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

function resolveLnkTargets(lnkPaths) {
  const unique = [...new Set((lnkPaths || []).filter((item) => /\.lnk$/i.test(item)))];
  const map = new Map();
  if (!unique.length) return map;

  try {
    const jsonB64 = Buffer.from(JSON.stringify(unique), 'utf8').toString('base64');
    const script = [
      "$ProgressPreference='SilentlyContinue'",
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
      `$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${jsonB64}'))`,
      '$paths=$json | ConvertFrom-Json',
      'foreach($p in $paths){ try{ $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p); $t=$s.TargetPath }catch{ $t="" }; Write-Output ($p + [char]9 + $t) }'
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 }
    );

    for (const line of String(out || '').split(/\r?\n/)) {
      const index = line.indexOf('\t');
      if (index <= 0) continue;
      const source = line.slice(0, index).trim();
      const target = line.slice(index + 1).trim();
      if (source && target && target !== source) {
        map.set(source.toLowerCase(), target);
      }
    }
  } catch (_) {
    // keep empty map; callers fall back to the original path
  }
  return map;
}

function resolveIconTarget(filePath) {
  if (!/\.lnk$/i.test(filePath)) return filePath;
  const target = resolveLnkTargets([filePath]).get(filePath.toLowerCase());
  return target && fs.existsSync(target) ? target : filePath;
}

function normalizeScope(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

async function makeAppEntry(store, filePath, options = {}) {
  const name = options.name || path.basename(filePath, path.extname(filePath));
  const groupId = options.groupId || 'default';
  const iconSource = options.iconSource || resolveIconTarget(filePath);
  const appEntry = {
    id: id(),
    name,
    path: filePath,
    groupId,
    workspaceId: normalizeScope(options.workspaceId),
    iconFile: '',
    sort: Date.now(),
    createdAt: new Date().toISOString(),
    lastLaunched: null,
    launchCount: 0
  };

  try {
    const icon = await app.getFileIcon(iconSource, { size: 'large' });
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
  const targets = resolveLnkTargets(candidates);
  const added = [];
  for (const filePath of candidates) {
    if (existing.has(filePath.toLowerCase())) continue;
    const iconSource = targets.get(filePath.toLowerCase()) || filePath;
    const entry = await makeAppEntry(store, filePath, { groupId, iconSource });
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

function iconNeedsRepair(store, entry) {
  if (!/\.lnk$/i.test(entry.path)) return false;
  if (entry.iconRepaired) return false;
  if (!entry.iconFile) return true;
  try {
    const iconPath = path.join(store.appThumbsDir, entry.iconFile);
    if (!fs.existsSync(iconPath)) return true;
    return fs.statSync(iconPath).size < 2048;
  } catch (_) {
    return true;
  }
}

async function ensureIcons(store) {
  const apps = readApps(store);
  const needs = apps.filter((entry) => iconNeedsRepair(store, entry));
  if (!needs.length) return;

  const targets = resolveLnkTargets(needs.map((item) => item.path));
  let processed = false;
  for (const entry of needs) {
    processed = true;
    const iconSource = targets.get(entry.path.toLowerCase()) || entry.path;
    try {
      const icon = await app.getFileIcon(iconSource, { size: 'large' });
      const buffer = icon.toPNG();
      if (buffer && buffer.length) {
        const iconFile = entry.iconFile || `${entry.id}.png`;
        fs.writeFileSync(path.join(store.appThumbsDir, iconFile), buffer);
        entry.iconFile = iconFile;
      }
    } catch (_) {
      // keep existing icon
    }
    entry.iconRepaired = true;
  }

  if (processed) writeApps(store, apps);
}

function collectCandidates(dirs) {
  const candidates = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const ext = path.extname(name).toLowerCase();
        if (ext !== '.lnk' && ext !== '.exe') continue;
        candidates.push(path.join(dir, name));
      }
    } catch (_) {}
  }
  return candidates;
}

function defaultScanDirs() {
  const dirs = new Set();
  try {
    dirs.add(app.getPath('desktop'));
  } catch (_) {}
  try {
    dirs.add(path.join(app.getPath('home'), 'Desktop'));
  } catch (_) {}
  dirs.add('C:\\Users\\Public\\Desktop');
  return [...dirs];
}

async function scanCandidates(store, folderPath) {
  const dirs = folderPath ? [folderPath] : defaultScanDirs();
  const candidates = collectCandidates(dirs);
  const existing = new Set(readApps(store).map((item) => item.path.toLowerCase()));
  const fresh = candidates.filter((item) => !existing.has(item.toLowerCase()));
  const targets = resolveLnkTargets(fresh);

  const result = [];
  for (const filePath of fresh) {
    const iconSource = targets.get(filePath.toLowerCase()) || filePath;
    let iconDataUrl = '';
    try {
      const icon = await app.getFileIcon(iconSource, { size: 'large' });
      const buffer = icon.toPNG();
      if (buffer && buffer.length) {
        iconDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch (_) {}
    result.push({
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      iconSource,
      iconDataUrl
    });
  }
  return result;
}

async function addBatch(store, candidates, groupId) {
  const apps = readApps(store);
  const existing = new Set(apps.map((item) => item.path.toLowerCase()));
  const added = [];
  for (const candidate of candidates || []) {
    const filePath = candidate && candidate.path;
    if (!filePath || existing.has(filePath.toLowerCase())) continue;
    const entry = await makeAppEntry(store, filePath, {
      groupId: groupId || 'default',
      name: candidate.name || undefined,
      iconSource: candidate.iconSource
    });
    apps.push(entry);
    existing.add(filePath.toLowerCase());
    added.push(hydrateApp(store, entry));
  }
  writeApps(store, apps);
  return added;
}
module.exports = {
  readApps,
  readGroups,
  writeGroups,
  addApp,
  scanDesktop,
  reorderApps,
  hydrateApp,
  ensureIcons,
  scanCandidates,
  addBatch
};