const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell, session, nativeImage } = require('electron');
const { DataStore } = require('./store.cjs');
const { defaultSettings, id } = require('./defaults.cjs');
const appService = require('./services/apps.cjs');
const fileService = require('./services/files.cjs');
const launcherService = require('./services/launcher.cjs');
const backupService = require('./services/backup.cjs');

let mainWindow = null;
let store = null;

function configRoot() {
  return path.join(app.getPath('documents'), '小菠萝的工作台');
}

function configFile() {
  return path.join(configRoot(), 'config.json');
}

function configuredDataRoot() {
  try {
    if (!fs.existsSync(configFile())) return '';
    const value = JSON.parse(fs.readFileSync(configFile(), 'utf8')).dataRoot;
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  } catch (_) {
    return '';
  }
}

function dataRoot() {
  return configuredDataRoot() || configRoot();
}

function writeDataRootConfig(root) {
  fs.mkdirSync(configRoot(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ dataRoot: root }, null, 2), 'utf8');
}

function isSameOrNested(left, right) {
  const a = path.resolve(left).toLowerCase();
  const b = path.resolve(right).toLowerCase();
  if (a === b) return true;
  return a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`);
}

function safeHandle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  });
}

function applyLaunchAtStartup(enabled) {
  if (process.platform !== 'win32') return;
  const settings = {
    openAtLogin: Boolean(enabled),
    path: process.execPath
  };
  if (!app.isPackaged) settings.args = [app.getAppPath()];
  app.setLoginItemSettings(settings);
}

function readGoals() {
  return store.read('goals.json', []);
}

function writeGoals(items) {
  store.write('goals.json', items);
}

function readTodos() {
  return store.read('todos.json', []);
}

function writeTodos(items) {
  store.write('todos.json', items);
}

function getQuickNote() {
  const notes = fileService.readNotes(store);
  let quick = notes.find((item) => item.type === 'quick');
  if (!quick) {
    quick = {
      id: id(),
      title: '快速便签',
      content: '',
      type: 'quick',
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    notes.unshift(quick);
    fileService.writeNotes(store, notes);
  }
  return quick;
}

function saveQuickNote(content) {
  const notes = fileService.readNotes(store);
  let quick = notes.find((item) => item.type === 'quick');
  if (!quick) {
    quick = {
      id: id(),
      title: '快速便签',
      content: String(content || ''),
      type: 'quick',
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    notes.unshift(quick);
  } else {
    quick.content = String(content || '');
    quick.updatedAt = new Date().toISOString();
  }
  fileService.writeNotes(store, notes);
  return quick;
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readCheckins() {
  return store.read('checkins.json', []);
}

function writeCheckins(items) {
  store.write('checkins.json', items);
}

function computeStreak(dates) {
  const set = new Set(dates);
  const cursor = new Date();
  let streak = 0;
  if (!set.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(todayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function readBookmarks() {
  return store.read('bookmarks.json', []);
}

function writeBookmarks(items) {
  store.write('bookmarks.json', items);
}

function readCalendarEvents() {
  return store.read('calendar-events.json', []);
}

function writeCalendarEvents(items) {
  store.write('calendar-events.json', items);
}

function recurrenceInfo(goal) {
  const recurrence = goal && goal.recurrence;
  if (!recurrence || !recurrence.type || recurrence.type === 'none') return null;
  return {
    type: recurrence.type,
    days: Array.isArray(recurrence.days) ? recurrence.days.map((day) => Number(day)) : []
  };
}

function recurrenceMatches(goal, date) {
  const recurrence = recurrenceInfo(goal);
  if (!recurrence) return false;
  if (recurrence.type === 'daily') return true;
  if (recurrence.type === 'weekly') return recurrence.days.includes(date.getDay());
  return false;
}

function goalScheduleKeys(goal) {
  const recurrence = recurrenceInfo(goal);
  if (!recurrence) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = goal.targetDate
    ? new Date(`${goal.targetDate}T00:00:00`)
    : new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(end.getTime()) || end < start) return [];
  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (recurrenceMatches(goal, cursor)) keys.push(todayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function goalProgressInfo(goal) {
  const keys = goalScheduleKeys(goal);
  const completed = new Set(Array.isArray(goal.completedDates) ? goal.completedDates : []);
  const checkinCount = keys.filter((key) => completed.has(key)).length;
  const scheduledCount = keys.length;
  const progress = scheduledCount ? Math.round((checkinCount / scheduledCount) * 100) : 0;
  return { checkinCount, scheduledCount, progress };
}

function goalsWithProgress(items) {
  return items.map((goal) => ({ ...goal, ...goalProgressInfo(goal) }));
}

function updateGoalCheckin(goalId, date, completed) {
  const goals = readGoals();
  const goal = goals.find((item) => item.id === goalId);
  if (!goal) return;
  const set = new Set(Array.isArray(goal.completedDates) ? goal.completedDates : []);
  if (completed) set.add(date);
  else set.delete(date);
  goal.completedDates = [...set].sort();
  writeGoals(goals);
}

function syncGoalRecurringTasks() {
  const goals = readGoals();
  const todos = readTodos();
  const events = readCalendarEvents();
  const todayDate = new Date();
  const today = todayKey(todayDate);

  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const desiredTodos = new Map();

  for (const goal of goals) {
    if (!recurrenceMatches(goal, todayDate)) continue;
    const key = `${goal.id}:${today}`;
    const existing = todos.find((todo) => (
      todo.generated && todo.sourceGoalId === goal.id && todo.sourceDate === today
    ));
    desiredTodos.set(key, existing || null);
  }

  const nextTodos = todos.filter((todo) => {
    if (!todo.generated || !todo.sourceGoalId) return true;
    return desiredTodos.has(`${todo.sourceGoalId}:${todo.sourceDate}`);
  });

  for (const [key, existing] of desiredTodos.entries()) {
    if (existing) continue;
    const [goalId, sourceDate] = key.split(':');
    const goal = goalById.get(goalId);
    if (!goal) continue;
    nextTodos.push({
      id: id(),
      title: goal.recurrenceTask || goal.title || '长期目标任务',
      priority: 'medium',
      importance: 'high',
      urgency: 'low',
      dueDate: sourceDate,
      reminderAt: null,
      reminderFired: false,
      completed: false,
      sort: Date.now() + nextTodos.length,
      generated: true,
      sourceGoalId: goalId,
      sourceDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  const desiredEvents = new Set();
  for (const goal of goals) {
    if (!recurrenceInfo(goal)) continue;
    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      if (!recurrenceMatches(goal, date)) continue;
      const key = `${goal.id}:${todayKey(date)}`;
      desiredEvents.add(key);
    }
  }

  const nextEvents = events.filter((event) => {
    if (!event.generated || !event.sourceGoalId) return true;
    return desiredEvents.has(`${event.sourceGoalId}:${event.sourceDate}`);
  });

  for (const key of desiredEvents) {
    if (events.some((event) => event.generated && `${event.sourceGoalId}:${event.sourceDate}` === key)) continue;
    const [goalId, sourceDate] = key.split(':');
    const goal = goalById.get(goalId);
    if (!goal) continue;
    nextEvents.push({
      id: id(),
      date: sourceDate,
      title: goal.recurrenceTask || goal.title || '长期目标任务',
      note: '来自长期目标',
      generated: true,
      sourceGoalId: goalId,
      sourceDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  if (JSON.stringify(nextTodos) !== JSON.stringify(todos)) writeTodos(nextTodos);
  if (JSON.stringify(nextEvents) !== JSON.stringify(events)) writeCalendarEvents(nextEvents);
}

function readReviews() {
  return store.read('daily-review.json', []);
}

function writeReviews(items) {
  store.write('daily-review.json', items);
}

function getReviewRecord(date) {
  const items = readReviews();
  let record = items.find((item) => item.date === date);
  if (!record) {
    record = {
      date,
      readingMinutes: 0,
      focusMinutes: 0,
      answers: { whatDid: '', whatLearned: '', whatImprove: '' },
      updatedAt: new Date().toISOString()
    };
    items.push(record);
    writeReviews(items);
  }
  return record;
}
function readBooks() {
  return store.read('books.json', []);
}

function writeBooks(items) {
  store.write('books.json', items);
}

function readBookCategories() {
  return store.read('book-categories.json', []);
}

function writeBookCategories(items) {
  store.write('book-categories.json', items);
}

const DEFAULT_BOOK_STORES = [
  { id: '10000txt', name: '10000txt', url: 'https://www.10000txt.com/', builtin: true },
  { id: 'fanqie', name: '番茄小说', url: 'https://fanqienovel.com/', builtin: true }
];

function readBookStores() {
  const items = store.read('book-stores.json', []);
  const stored = Array.isArray(items) ? items : [];
  const defaults = DEFAULT_BOOK_STORES.map((item) => ({ ...item, builtin: true }));
  const defaultIds = new Set(defaults.map((item) => item.id));
  const merged = [
    ...defaults,
    ...stored.filter((item) => item && !defaultIds.has(item.id))
  ];
  if (JSON.stringify(merged) !== JSON.stringify(stored)) {
    writeBookStores(merged);
  }
  return merged;
}

function writeBookStores(items) {
  store.write('book-stores.json', items);
}

function normalizeStoreUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('请输入网址');
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    try {
      parsed = new URL(`https://${value}`);
    } catch (_) {
      throw new Error('网址格式不正确');
    }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('只支持 http 或 https 网址');
  }
  return parsed;
}

function allowedWebviewHosts() {
  const chatHosts = ['doubao.com', 'deepseek.com', 'qwen.ai', 'chatgpt.com'];
  const storeHosts = readBookStores()
    .map((item) => {
      try {
        return new URL(item.url).hostname.replace(/^www\./, '');
      } catch (_) {
        return '';
      }
    })
    .filter(Boolean);
  return [...chatHosts, ...storeHosts];
}

function addBookFromPath(filePath) {
  const items = readBooks();
  const existing = items.find((item) => item.path === filePath);
  if (existing) return existing;
  const entry = {
    id: id(),
    title: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    ext: path.extname(filePath).toLowerCase(),
    categoryId: null,
    favorite: false,
    coverDataUrl: '',
    addedAt: new Date().toISOString()
  };
  items.unshift(entry);
  writeBooks(items);
  return entry;
}

const READER_DEFAULTS = {
  prefs: {
    fontSize: 18,
    lineHeight: 1.9,
    fontFamily: 'system',
    theme: 'light'
  },
  progress: {}
};

function readReaderState() {
  const state = store.read('reader.json', READER_DEFAULTS);
  return {
    prefs: { ...READER_DEFAULTS.prefs, ...(state.prefs || {}) },
    progress: state.progress && typeof state.progress === 'object' ? state.progress : {}
  };
}

function writeReaderState(state) {
  store.write('reader.json', state);
}

function decodeBookBuffer(buffer) {
  if (!buffer || !buffer.length) return { encoding: 'utf8', text: '' };
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf8-bom', text: buffer.toString('utf8', 3) };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { encoding: 'utf16-be', text: buffer.toString('utf16le').replace(/^\uFEFF/, '') };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { encoding: 'utf16-le', text: buffer.toString('utf16le').replace(/^\uFEFF/, '') };
  }
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) {
    return { encoding: 'utf8', text: utf8 };
  }
  try {
    const gb = new TextDecoder('gb18030').decode(buffer);
    if (gb.length && !gb.includes('\uFFFD')) {
      return { encoding: 'gb18030', text: gb };
    }
  } catch (_) {
    // 退回 utf8
  }
  return { encoding: 'utf8', text: utf8 };
}

function parseBookChapters(text) {
  if (!text) return [{ index: 0, title: '全文', start: 0, end: 0 }];
  const re = /^[ \t]*(第[0-9０-９一二三四五六七八九十百千万零〇两]+[卷部篇章回节集话]|序章|序言|楔子|番外|后记|尾声)[^\n]*$/gm;
  const marks = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    marks.push({ title: match[0].trim(), start: match.index });
  }
  if (!marks.length) {
    return [{ index: 0, title: '全文', start: 0, end: text.length }];
  }
  const chapters = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].start;
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    chapters.push({ index: i, title: marks[i].title, start, end });
  }
  if (chapters[0].start > 0) {
    const preface = text.slice(0, chapters[0].start).trim();
    const meaningful = preface.replace(/[\s\-—=*_·.。，,、:：;；"“”'‘’（）()【】\[\]<>《》]/g, '');
    if (meaningful.length) {
      chapters.unshift({ index: -1, title: '前言', start: 0, end: chapters[0].start });
    } else {
      chapters[0].start = 0;
    }
  }
  chapters.forEach((item, i) => { item.index = i; });
  return chapters;
}

function readBookFile(book) {
  const ext = (book.ext || path.extname(book.path) || '').toLowerCase();
  const supported = ['.txt', '.md', '.markdown', '.text', '.log', '.json'].includes(ext);
  if (!supported) {
    return { supported: false, title: book.title, path: book.path, ext };
  }
  const stat = fs.statSync(book.path);
  if (stat.size > 30 * 1024 * 1024) {
    throw new Error('文件过大，暂不支持内置阅读');
  }
  const decoded = decodeBookBuffer(fs.readFileSync(book.path));
  return {
    supported: true,
    id: book.id,
    title: book.title,
    encoding: decoded.encoding,
    text: decoded.text,
    chapters: parseBookChapters(decoded.text),
    size: stat.size
  };
}

function registerIpc() {
  safeHandle('app:info', () => ({
    version: app.getVersion(),
    dataDir: store.baseDir,
    dataRoot: store.dataDir
  }));

  safeHandle('settings:get', () => store.read('settings.json', defaultSettings()));
  safeHandle('settings:clear-data', () => {
    fs.rmSync(store.dataDir, { recursive: true, force: true });
    store.ensureDirs();
    return true;
  });

  safeHandle('settings:update', (patch) => {
    const settings = store.read('settings.json', defaultSettings());
    const next = {
      ...settings,
      ...patch,
      extensions: { ...settings.extensions, ...(patch.extensions || {}) },
      chatProviders: { ...settings.chatProviders, ...(patch.chatProviders || {}) }
    };
    if (typeof next.launchAtStartup === 'boolean') {
      applyLaunchAtStartup(next.launchAtStartup);
    }
    store.write('settings.json', next);
    return next;
  });

  safeHandle('system:select-app', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择应用程序',
      properties: ['openFile'],
      filters: [
        { name: '应用程序与快捷方式', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  safeHandle('system:select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件',
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  safeHandle('system:select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  safeHandle('system:select-avatar', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择头像',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return '';
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return '';
    return image.resize({ width: 128, height: 128 }).toDataURL();
  });

  safeHandle('system:select-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择铃声',
      properties: ['openFile'],
      filters: [
        { name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    if (stat.size > 15 * 1024 * 1024) throw new Error('铃声文件不能超过 15MB');
    const mimeByExt = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac'
    };
    const ext = path.extname(filePath).toLowerCase();
    const mime = mimeByExt[ext] || 'audio/mpeg';
    return {
      name: path.basename(filePath),
      dataUrl: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`,
      size: stat.size
    };
  });

  safeHandle('system:select-book', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择书籍',
      properties: ['openFile'],
      filters: [
        { name: '电子书', extensions: ['txt', 'pdf', 'epub', 'mobi', 'azw3', 'docx'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  safeHandle('system:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件夹',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  safeHandle('system:open-path', (filePath) => launcherService.openPath(filePath));
  safeHandle('system:open-data-dir', () => launcherService.openPath(store.baseDir));
  safeHandle('system:open-logs-dir', () => launcherService.openPath(store.logsDir));
  safeHandle('system:open-external', (url) => launcherService.openExternal(url));
  safeHandle('settings:change-data-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择新的数据目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    const next = path.resolve(result.filePaths[0]);
    if (isSameOrNested(next, store.baseDir)) {
      throw new Error('新目录不能与当前数据目录相同或互相包含');
    }
    try {
      if (fs.existsSync(next) && fs.readdirSync(next).length) {
        throw new Error('目标文件夹必须为空');
      }
      fs.cpSync(store.baseDir, next, { recursive: true, force: false });
    } catch (error) {
      throw new Error(error.message || '迁移数据失败，请选择空文件夹或新文件夹');
    }

    writeDataRootConfig(next);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 400);
    return { canceled: false, dataDir: next };
  });

  safeHandle('apps:list', async () => {
  await appService.ensureIcons(store);
  return appService.readApps(store).map((item) => appService.hydrateApp(store, item));
});
  safeHandle('apps:launch', async (appId) => {
    const result = await launcherService.launchApp(store, appId);
    if (!result.ok) throw new Error(result.error || '启动失败');
    return result;
  });
  safeHandle('apps:add', async (filePath, options) => appService.addApp(store, filePath, options || {}));
  safeHandle('apps:scan-desktop', (groupId) => appService.scanDesktop(store, groupId || 'default'));
  safeHandle('apps:scan-candidates', (folderPath) => appService.scanCandidates(store, folderPath || ''));
  safeHandle('apps:add-batch', (candidates, groupId) => appService.addBatch(store, candidates, groupId || 'default'));
  safeHandle('apps:update', (appId, patch) => {
    const apps = appService.readApps(store);
    const entry = apps.find((item) => item.id === appId);
    if (!entry) throw new Error('应用不存在');
    if (typeof patch.name === 'string' && patch.name.trim()) entry.name = patch.name.trim();
    if (typeof patch.groupId === 'string') entry.groupId = patch.groupId;
    store.write('apps.json', apps);
    return appService.hydrateApp(store, entry);
  });
  safeHandle('apps:delete', (appId) => {
    const apps = appService.readApps(store);
    const entry = apps.find((item) => item.id === appId);
    if (entry && entry.iconFile) {
      try {
        fs.rmSync(path.join(store.appThumbsDir, entry.iconFile), { force: true });
      } catch (_) {}
    }
    const next = apps.filter((item) => item.id !== appId);
    store.write('apps.json', next);
    return next.map((item) => appService.hydrateApp(store, item));
  });
  safeHandle('apps:reorder', (groupId, orderedIds) => appService.reorderApps(store, groupId, orderedIds));

  safeHandle('groups:list', () => appService.readGroups(store));
  safeHandle('groups:create', (name) => {
    const groups = appService.readGroups(store);
    const group = { id: id(), name: String(name || '未命名分组'), sort: Date.now(), createdAt: new Date().toISOString() };
    groups.push(group);
    appService.writeGroups(store, groups);
    return group;
  });
  safeHandle('groups:update', (groupId, name) => {
    const groups = appService.readGroups(store);
    const group = groups.find((item) => item.id === groupId);
    if (!group) throw new Error('分组不存在');
    group.name = String(name || group.name);
    appService.writeGroups(store, groups);
    return group;
  });
  safeHandle('groups:delete', (groupId) => {
    if (groupId === 'default') throw new Error('默认分组不能删除');
    const groups = appService.readGroups(store).filter((item) => item.id !== groupId);
    appService.writeGroups(store, groups);
    const apps = appService.readApps(store).map((item) => (item.groupId === groupId ? { ...item, groupId: 'default' } : item));
    store.write('apps.json', apps);
    return groups;
  });

  safeHandle('goals:list', () => goalsWithProgress(readGoals()));
  safeHandle('goals:create', (goal) => {
    const items = readGoals();
    const entry = {
      id: id(),
      title: String(goal.title || '').trim() || '未命名目标',
      description: goal.description || '',
      progress: 0,
      note: goal.note || '',
      period: goal.period || 'month',
      targetDate: goal.targetDate || null,
      recurrence: goal.recurrence || { type: 'none', days: [] },
      recurrenceTask: goal.recurrenceTask || goal.title || '',
      completedDates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.push(entry);
    writeGoals(items);
    try { syncGoalRecurringTasks(); } catch (_) {}
    return goalsWithProgress(readGoals()).find((item) => item.id === entry.id) || entry;
  });
  safeHandle('goals:update', (goalId, patch) => {
    const items = readGoals();
    const index = items.findIndex((item) => item.id === goalId);
    if (index === -1) throw new Error('目标不存在');
    const current = items[index];
    if (patch.targetDate !== undefined) patch.targetDate = patch.targetDate || null;
    if (patch.recurrenceTask !== undefined) patch.recurrenceTask = patch.recurrenceTask || current.title || '';
    items[index] = { ...current, ...patch, updatedAt: new Date().toISOString() };
    writeGoals(items);
    try { syncGoalRecurringTasks(); } catch (_) {}
    return goalsWithProgress(readGoals()).find((item) => item.id === goalId) || items[index];
  });
  safeHandle('goals:checkin', (goalId) => {
    const goals = readGoals();
    const goal = goals.find((item) => item.id === goalId);
    if (!goal) throw new Error('目标不存在');
    const today = todayKey();
    const dates = new Set(Array.isArray(goal.completedDates) ? goal.completedDates : []);
    const completed = !dates.has(today);
    if (completed) dates.add(today);
    else dates.delete(today);
    goal.completedDates = [...dates].sort();
    writeGoals(goals);
    const todos = readTodos();
    const todayTodo = todos.find((item) => (
      item.generated && item.sourceGoalId === goalId && item.sourceDate === today
    ));
    if (todayTodo) {
      todayTodo.completed = completed;
      writeTodos(todos);
    }
    try { syncGoalRecurringTasks(); } catch (_) {}
    return goalsWithProgress(readGoals()).find((item) => item.id === goalId) || goal;
  });
  safeHandle('goals:delete', (goalId) => {
    const items = readGoals().filter((item) => item.id !== goalId);
    writeGoals(items);
    try { syncGoalRecurringTasks(); } catch (_) {}
    return items;
  });

  safeHandle('todos:list', () => readTodos());
  safeHandle('todos:create', (todo) => {
    const items = readTodos();
    const priority = todo.priority || 'medium';
    const entry = {
      id: id(),
      title: String(todo.title || '').trim() || '未命名任务',
      priority,
      importance: todo.importance || (priority === 'low' ? 'low' : 'high'),
      urgency: todo.urgency || (priority === 'high' ? 'high' : 'low'),
      dueDate: todo.dueDate || null,
      reminderAt: todo.reminderAt || null,
      reminderFired: false,
      completed: false,
      sort: Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.push(entry);
    writeTodos(items);
    return entry;
  });
  safeHandle('todos:update', (todoId, patch) => {
    const items = readTodos();
    const index = items.findIndex((item) => item.id === todoId);
    if (index === -1) throw new Error('待办不存在');
    if (patch.dueDate !== undefined) patch.dueDate = patch.dueDate || null;
    if (patch.reminderAt !== undefined) patch.reminderAt = patch.reminderAt || null;
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    const updated = items[index];
    writeTodos(items);
    if (updated.generated && updated.sourceGoalId && typeof updated.completed === 'boolean') {
      updateGoalCheckin(updated.sourceGoalId, updated.sourceDate || todayKey(), updated.completed);
    }
    try { syncGoalRecurringTasks(); } catch (_) {}
    return updated;
  });
  safeHandle('todos:delete', (todoId) => {
    const items = readTodos();
    const todo = items.find((item) => item.id === todoId);
    const next = items.filter((item) => item.id !== todoId);
    writeTodos(next);
    if (todo && todo.generated && todo.sourceGoalId) {
      updateGoalCheckin(todo.sourceGoalId, todo.sourceDate || todayKey(), false);
    }
    try { syncGoalRecurringTasks(); } catch (_) {}
    return next;
  });
  safeHandle('todos:reorder', (orderedIds) => {
    const items = readTodos();
    const map = new Map(orderedIds.map((value, index) => [value, index]));
    for (const item of items) {
      if (map.has(item.id)) item.sort = map.get(item.id);
    }
    writeTodos(items);
    return items;
  });

  safeHandle('files:drives', () => fileService.listDrives());
  safeHandle('files:browse', (dir) => fileService.browseDirectory(dir));
  safeHandle('files:open', (filePath) => launcherService.openPath(filePath));
  safeHandle('files:reveal', (filePath) => launcherService.revealPath(filePath));
  safeHandle('files:favorites:list', () => fileService.readFavorites(store));
  safeHandle('files:favorites:add', (filePath) => fileService.addFavorite(store, filePath));
  safeHandle('files:favorites:remove', (entryId) => fileService.removeFavorite(store, entryId));
  safeHandle('files:images:list', () => fileService.readImages(store).map((item) => fileService.hydrateImage(store, item)));
  safeHandle('files:images:add', (filePath) => fileService.addImage(store, filePath));
  safeHandle('files:images:remove', (entryId) => fileService.removeImage(store, entryId));
  safeHandle('files:notes:list', () => fileService.readNotes(store));
  safeHandle('files:notes:create', (note) => fileService.addNote(store, note));
  safeHandle('files:notes:update', (noteId, patch) => fileService.updateNote(store, noteId, patch));
  safeHandle('files:notes:delete', (noteId) => fileService.deleteNote(store, noteId));
  safeHandle('files:notes:get-quick', () => getQuickNote());
  safeHandle('files:notes:save-quick', (content) => saveQuickNote(content));

  safeHandle('workflows:list', () => launcherService.readWorkflows(store));
  safeHandle('workflows:create', (workflow) => {
    const items = launcherService.readWorkflows(store);
    const entry = {
      id: id(),
      name: workflow.name || '未命名工作流',
      steps: Array.isArray(workflow.steps) ? workflow.steps : [],
      sort: Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.push(entry);
    launcherService.writeWorkflows(store, items);
    return entry;
  });
  safeHandle('workflows:update', (workflowId, patch) => {
    const items = launcherService.readWorkflows(store);
    const index = items.findIndex((item) => item.id === workflowId);
    if (index === -1) throw new Error('工作流不存在');
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    launcherService.writeWorkflows(store, items);
    return items[index];
  });
  safeHandle('workflows:delete', (workflowId) => {
    const items = launcherService.readWorkflows(store).filter((item) => item.id !== workflowId);
    launcherService.writeWorkflows(store, items);
    return items;
  });
  safeHandle('workflows:reorder', (orderedIds) => {
    const items = launcherService.readWorkflows(store);
    const map = new Map(orderedIds.map((value, index) => [value, index]));
    for (const item of items) {
      if (map.has(item.id)) item.sort = map.get(item.id);
    }
    launcherService.writeWorkflows(store, items);
    return items;
  });
  safeHandle('workflows:run', async (workflowId) => {
    const result = await launcherService.runWorkflow(store, workflowId);
    if (result && result.ok === false) {
      throw new Error(result.error || '工作流执行失败');
    }
    return result;
  });

  safeHandle('checkins:get', () => {
    const dates = readCheckins();
    return {
      dates,
      today: todayKey(),
      todayChecked: dates.includes(todayKey()),
      streak: computeStreak(dates),
      total: dates.length
    };
  });
  safeHandle('checkins:toggle', () => {
    const today = todayKey();
    const items = readCheckins();
    const next = items.includes(today) ? items.filter((item) => item !== today) : [...items, today];
    writeCheckins(next);
    return {
      dates: next,
      today,
      todayChecked: next.includes(today),
      streak: computeStreak(next),
      total: next.length
    };
  });

  safeHandle('bookmarks:list', () => readBookmarks());
  safeHandle('bookmarks:create', (bookmark) => {
    const items = readBookmarks();
    const entry = {
      id: id(),
      type: bookmark.type || 'article',
      url: bookmark.url || '',
      title: bookmark.title || '',
      note: bookmark.note || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.unshift(entry);
    writeBookmarks(items);
    return entry;
  });
  safeHandle('bookmarks:update', (bookmarkId, patch) => {
    const items = readBookmarks();
    const index = items.findIndex((item) => item.id === bookmarkId);
    if (index === -1) throw new Error('收藏不存在');
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    writeBookmarks(items);
    return items[index];
  });
  safeHandle('bookmarks:delete', (bookmarkId) => {
    const items = readBookmarks().filter((item) => item.id !== bookmarkId);
    writeBookmarks(items);
    return items;
  });

  safeHandle('calendar:list', () => readCalendarEvents());
  safeHandle('calendar:create', (event) => {
    const items = readCalendarEvents();
    const entry = {
      id: id(),
      date: event.date || todayKey(),
      title: event.title || '日程',
      note: event.note || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.push(entry);
    writeCalendarEvents(items);
    return entry;
  });
  safeHandle('calendar:update', (eventId, patch) => {
    const items = readCalendarEvents();
    const index = items.findIndex((item) => item.id === eventId);
    if (index === -1) throw new Error('日程不存在');
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    writeCalendarEvents(items);
    return items[index];
  });
  safeHandle('calendar:delete', (eventId) => {
    const items = readCalendarEvents().filter((item) => item.id !== eventId);
    writeCalendarEvents(items);
    return items;
  });

  safeHandle('review:list', () => readReviews().slice().sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || '')));
  safeHandle('review:get', (date) => getReviewRecord(date || todayKey()));
  safeHandle('review:update', (date, patch) => {
    const items = readReviews();
    const record = items.find((item) => item.date === date);
    if (!record) {
      const created = {
        date,
        readingMinutes: 0,
        focusMinutes: 0,
        answers: { whatDid: '', whatLearned: '', whatImprove: '' },
        updatedAt: new Date().toISOString(),
        ...patch
      };
      items.push(created);
      writeReviews(items);
      return created;
    }
    const answers = { ...record.answers, ...(patch.answers || {}) };
    const next = {
      ...record,
      ...patch,
      answers,
      updatedAt: new Date().toISOString()
    };
    items[items.findIndex((item) => item.date === date)] = next;
    writeReviews(items);
    return next;
  });
  safeHandle('books:list', () => readBooks());
  safeHandle('books:add', (filePath) => addBookFromPath(filePath));
  safeHandle('books:update', (bookId, patch) => {
    const items = readBooks();
    const book = items.find((item) => item.id === bookId);
    if (!book) throw new Error('书籍不存在');
    if (typeof patch.title === 'string' && patch.title.trim()) {
      book.title = patch.title.trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'categoryId')) {
      book.categoryId = patch.categoryId ? String(patch.categoryId) : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'favorite')) {
      book.favorite = Boolean(patch.favorite);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'coverDataUrl')) {
      book.coverDataUrl = typeof patch.coverDataUrl === 'string' ? patch.coverDataUrl : '';
    }
    book.updatedAt = new Date().toISOString();
    writeBooks(items);
    return book;
  });
  safeHandle('books:select-cover', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择书籍封面',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
    });
    if (result.canceled || !result.filePaths.length) return '';
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return '';
    return image.resize({ width: 360 }).toDataURL();
  });
  safeHandle('books:remove', (bookId) => {
    const items = readBooks().filter((item) => item.id !== bookId);
    writeBooks(items);
    return items;
  });
  safeHandle('books:categories:list', () => readBookCategories());
  safeHandle('books:categories:create', (name) => {
    const items = readBookCategories();
    const category = {
      id: id(),
      name: String(name || '未命名分类').trim() || '未命名分类',
      createdAt: new Date().toISOString()
    };
    items.push(category);
    writeBookCategories(items);
    return category;
  });
  safeHandle('books:categories:update', (categoryId, name) => {
    const items = readBookCategories();
    const category = items.find((item) => item.id === categoryId);
    if (!category) throw new Error('分类不存在');
    category.name = String(name || category.name).trim() || category.name;
    writeBookCategories(items);
    return category;
  });
  safeHandle('books:categories:delete', (categoryId) => {
    const categories = readBookCategories().filter((item) => item.id !== categoryId);
    writeBookCategories(categories);
    const books = readBooks().map((item) => (
      item.categoryId === categoryId ? { ...item, categoryId: null } : item
    ));
    writeBooks(books);
    return categories;
  });
  safeHandle('books:stores:list', () => readBookStores());
  safeHandle('books:stores:add', (store) => {
    const parsed = normalizeStoreUrl(store && store.url);
    const items = readBookStores();
    const entry = {
      id: id(),
      name: String(store && store.name || parsed.hostname).trim() || parsed.hostname,
      url: parsed.href,
      builtin: false,
      createdAt: new Date().toISOString()
    };
    items.push(entry);
    writeBookStores(items);
    return entry;
  });
  safeHandle('books:stores:remove', (storeId) => {
    const items = readBookStores();
    const item = items.find((entry) => entry.id === storeId);
    if (!item) throw new Error('书城不存在');
    if (item.builtin) throw new Error('内置书城不能删除');
    const next = items.filter((entry) => entry.id !== storeId);
    writeBookStores(next);
    return next;
  });
  safeHandle('books:open', (bookId) => {
    const book = readBooks().find((item) => item.id === bookId);
    if (!book) throw new Error('书籍不存在');
    return launcherService.openPath(book.path);
  });
  safeHandle('books:read', (bookId) => {
    const book = readBooks().find((item) => item.id === bookId);
    if (!book) throw new Error('书籍不存在');
    return readBookFile(book);
  });
  safeHandle('reader:get', () => readReaderState());
  safeHandle('reader:update', (patch) => {
    const current = readReaderState();
    const next = {
      prefs: { ...current.prefs, ...(patch && patch.prefs ? patch.prefs : {}) },
      progress: { ...current.progress, ...(patch && patch.progress ? patch.progress : {}) }
    };
    writeReaderState(next);
    return next;
  });
  safeHandle('backup:export', () => backupService.exportBackup(store));
  safeHandle('backup:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      properties: ['openFile'],
      filters: [{ name: '工作台备份', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return backupService.importBackup(store, result.filePaths[0]);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#f2f2f7',
    title: '小菠萝的工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;

    try {
      const url = new URL(params.src || '');
      const allowed = allowedWebviewHosts().some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
      if (!allowed) event.preventDefault();
    } catch (_) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }
});

app.whenReady().then(() => {
  store = new DataStore(dataRoot());
  applyLaunchAtStartup(Boolean(store.read('settings.json', defaultSettings()).launchAtStartup));
  syncGoalRecurringTasks();
  setInterval(syncGoalRecurringTasks, 60 * 60 * 1000);

  const booksSession = session.fromPartition('persist:bookshelf');
  booksSession.on('will-download', (event, item) => {
    try {
      const filename = item.getFilename() || `book-${Date.now()}.txt`;
      const savePath = path.join(store.booksDir, filename);
      item.setSavePath(savePath);
      item.once('done', (_doneEvent, state) => {
        if (state === 'completed') {
          const book = addBookFromPath(savePath);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('books:changed', book);
          }
        }
      });
    } catch (_) {
      event.preventDefault();
    }
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
