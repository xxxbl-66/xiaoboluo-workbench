const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');
const { id } = require('../defaults.cjs');

function listDrives() {
  const drives = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) drives.push({ name: `${letter}:`, path: root });
    } catch (_) {}
  }
  return drives;
}

function normalizeDir(dir) {
  if (!dir || typeof dir !== 'string') return '';
  try {
    return path.resolve(dir);
  } catch (_) {
    return '';
  }
}

function browseDirectory(dir) {
  const current = normalizeDir(dir);
  if (!current || !fs.existsSync(current)) {
    return { path: current, parent: null, entries: [], error: '目录不存在' };
  }

  let stat;
  try {
    stat = fs.statSync(current);
  } catch (_) {
    return { path: current, parent: null, entries: [], error: '无法读取目录' };
  }

  if (!stat.isDirectory()) {
    return { path: current, parent: null, entries: [], error: '不是文件夹' };
  }

  const parent = path.dirname(current);
  const entries = [];
  for (const name of fs.readdirSync(current)) {
    const full = path.join(current, name);
    try {
      const itemStat = fs.statSync(full);
      entries.push({
        name,
        path: full,
        isDirectory: itemStat.isDirectory(),
        isFile: itemStat.isFile(),
        ext: path.extname(name).toLowerCase(),
        size: itemStat.size,
        mtime: itemStat.mtimeMs
      });
    } catch (_) {}
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return {
    path: current,
    parent: parent === current ? null : parent,
    entries,
    error: null
  };
}

function readFavorites(store) {
  return store.read('files.json', []);
}

function writeFavorites(store, items) {
  store.write('files.json', items);
}

function favoriteLabel(filePath, isDirectory) {
  if (!isDirectory) return path.basename(filePath);
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const name = path.basename(trimmed);
  return name || filePath;
}

function addFavorite(store, filePath) {
  const items = readFavorites(store);
  const normalized = path.resolve(filePath);
  if (items.some((item) => item.path === normalized)) {
    return items;
  }
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(normalized).isDirectory();
  } catch (_) {}
  const entry = {
    id: id(),
    path: normalized,
    name: favoriteLabel(normalized, isDirectory),
    type: isDirectory ? 'folder' : 'file',
    createdAt: new Date().toISOString()
  };
  items.unshift(entry);
  writeFavorites(store, items);
  return items;
}

function removeFavorite(store, entryId) {
  const items = readFavorites(store).filter((item) => item.id !== entryId);
  writeFavorites(store, items);
  return items;
}

function readImages(store) {
  return store.read('images.json', []);
}

function writeImages(store, items) {
  store.write('images.json', items);
}

function imageThumbPath(store, entry) {
  return entry.thumbFile ? path.join(store.imageThumbsDir, entry.thumbFile) : '';
}

function thumbnailToDataUrl(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch (_) {
    return '';
  }
}

function hydrateImage(store, entry) {
  const thumb = imageThumbPath(store, entry);
  return {
    ...entry,
    thumbnailDataUrl: thumbnailToDataUrl(thumb)
  };
}

function addImage(store, filePath) {
  const items = readImages(store);
  const entry = {
    id: id(),
    path: filePath,
    name: path.basename(filePath),
    thumbFile: '',
    createdAt: new Date().toISOString()
  };

  try {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      const resized = image.resize({ width: 360 });
      const buffer = resized.toPNG();
      if (buffer && buffer.length) {
        const thumbFile = `${entry.id}.png`;
        fs.writeFileSync(path.join(store.imageThumbsDir, thumbFile), buffer);
        entry.thumbFile = thumbFile;
      }
    }
  } catch (_) {}

  items.unshift(entry);
  writeImages(store, items);
  return hydrateImage(store, entry);
}

function removeImage(store, entryId) {
  const items = readImages(store);
  const entry = items.find((item) => item.id === entryId);
  if (entry) {
    const thumb = imageThumbPath(store, entry);
    if (thumb) {
      try {
        fs.rmSync(thumb, { force: true });
      } catch (_) {}
    }
  }
  const next = items.filter((item) => item.id !== entryId);
  writeImages(store, next);
  return next;
}

function readNotes(store) {
  return store.read('notes.json', []);
}

function writeNotes(store, items) {
  store.write('notes.json', items);
}

function addNote(store, note) {
  const items = readNotes(store);
  const entry = {
    id: id(),
    title: note.title || '无标题便签',
    content: note.content || '',
    pinned: Boolean(note.pinned),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  items.unshift(entry);
  writeNotes(store, items);
  return entry;
}

function updateNote(store, noteId, patch) {
  const items = readNotes(store);
  const index = items.findIndex((item) => item.id === noteId);
  if (index === -1) return null;
  items[index] = {
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  writeNotes(store, items);
  return items[index];
}

function deleteNote(store, noteId) {
  const items = readNotes(store).filter((item) => item.id !== noteId);
  writeNotes(store, items);
  return items;
}

module.exports = {
  listDrives,
  browseDirectory,
  readFavorites,
  addFavorite,
  removeFavorite,
  readImages,
  addImage,
  removeImage,
  hydrateImage,
  readNotes,
  addNote,
  updateNote,
  deleteNote
};
