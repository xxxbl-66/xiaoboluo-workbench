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

function dataRoot() {
  return path.join(app.getPath('documents'), '小菠萝的工作台');
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

function addBookFromPath(filePath) {
  const items = readBooks();
  const existing = items.find((item) => item.path === filePath);
  if (existing) return existing;
  const entry = {
    id: id(),
    title: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    ext: path.extname(filePath).toLowerCase(),
    addedAt: new Date().toISOString()
  };
  items.unshift(entry);
  writeBooks(items);
  return entry;
}
function registerIpc() {
  safeHandle('app:info', () => ({
    version: app.getVersion(),
    dataDir: store.baseDir,
    dataRoot: store.dataDir
  }));

  safeHandle('settings:get', () => store.read('settings.json', defaultSettings()));
  safeHandle('settings:update', (patch) => {
    const settings = store.read('settings.json', defaultSettings());
    const next = {
      ...settings,
      ...patch,
      extensions: { ...settings.extensions, ...(patch.extensions || {}) },
      chatProviders: { ...settings.chatProviders, ...(patch.chatProviders || {}) }
    };
    if (typeof next.launchAtStartup === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: next.launchAtStartup });
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

  safeHandle('apps:list', () => appService.readApps(store).map((item) => appService.hydrateApp(store, item)));
  safeHandle('apps:launch', async (appId) => {
    const result = await launcherService.launchApp(store, appId);
    if (!result.ok) throw new Error(result.error || '启动失败');
    return result;
  });
  safeHandle('apps:add', async (filePath, options) => appService.addApp(store, filePath, options || {}));
  safeHandle('apps:scan-desktop', (groupId) => appService.scanDesktop(store, groupId || 'default'));
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

  safeHandle('goals:list', () => readGoals());
  safeHandle('goals:create', (goal) => {
    const items = readGoals();
    const entry = {
      id: id(),
      title: goal.title || '未命名目标',
      description: goal.description || '',
      progress: Math.max(0, Math.min(100, Number(goal.progress) || 0)),
      note: goal.note || '',
      period: goal.period || 'month',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    items.push(entry);
    writeGoals(items);
    return entry;
  });
  safeHandle('goals:update', (goalId, patch) => {
    const items = readGoals();
    const index = items.findIndex((item) => item.id === goalId);
    if (index === -1) throw new Error('目标不存在');
    const current = items[index];
    if (typeof patch.progress === 'number') patch.progress = Math.max(0, Math.min(100, patch.progress));
    items[index] = { ...current, ...patch, updatedAt: new Date().toISOString() };
    writeGoals(items);
    return items[index];
  });
  safeHandle('goals:delete', (goalId) => {
    const items = readGoals().filter((item) => item.id !== goalId);
    writeGoals(items);
    return items;
  });

  safeHandle('todos:list', () => readTodos());
  safeHandle('todos:create', (todo) => {
    const items = readTodos();
    const entry = {
      id: id(),
      title: todo.title || '未命名任务',
      priority: todo.priority || 'medium',
      dueDate: todo.dueDate || null,
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
    items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
    writeTodos(items);
    return items[index];
  });
  safeHandle('todos:delete', (todoId) => {
    const items = readTodos().filter((item) => item.id !== todoId);
    writeTodos(items);
    return items;
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
  safeHandle('workflows:run', (workflowId) => launcherService.runWorkflow(store, workflowId));

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
  safeHandle('books:remove', (bookId) => {
    const items = readBooks().filter((item) => item.id !== bookId);
    writeBooks(items);
    return items;
  });
  safeHandle('books:open', (bookId) => {
    const book = readBooks().find((item) => item.id === bookId);
    if (!book) throw new Error('书籍不存在');
    return launcherService.openPath(book.path);
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
    backgroundColor: '#f5f7fb',
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

  const allowedChatHosts = ['doubao.com', 'deepseek.com', 'chatgpt.com', '10000txt.com'];

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;

    try {
      const url = new URL(params.src || '');
      const allowed = allowedChatHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
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
