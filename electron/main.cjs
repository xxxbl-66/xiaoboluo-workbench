const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell, session, nativeImage, Notification } = require('electron');
const { DataStore } = require('./store.cjs');
const { defaultSettings, id } = require('./defaults.cjs');
const appService = require('./services/apps.cjs');
const fileService = require('./services/files.cjs');
const noteService = require('./services/notes.cjs');
const launcherService = require('./services/launcher.cjs');
const backupService = require('./services/backup.cjs');
const migrations = require('./migrations.cjs');
const workspaceService = require('./services/workspaces.cjs');
const sessionService = require('./services/sessions.cjs');
const overviewService = require('./services/overview.cjs');
const { todayKey: localTodayKey } = require('./dates.cjs');

let mainWindow = null;
let store = null;
let pendingSecondInstanceFocus = false;
let migrationState = { schemaVersion: 0, ranAt: null, error: null, repaired: [], fatal: false };

/**
 * 启动时的数据安全闸门。
 *
 * 会做两件事：
 * 1. 结构校验与安全修复（根类型错误 / JSON 损坏的表被隔离并重建默认值）
 * 2. 数据版本迁移
 *
 * 任何一环不可恢复地失败时返回 { fatal: true }：
 * 调用方必须【停止】继续启动，绝不能进入会写数据的普通链路。
 * 这样就不会出现"schemaVersion 已更新、紧接着 syncGoalRecurringTasks 崩溃"的情况。
 */
function runStartupMigrations() {
  try {
    const result = migrations.runMigrations(store);

    // 数据由更新版本创建：当前程序既不能迁移也不能降级，
    // 必须原样保留数据并停止启动，绝不进入会写数据的普通链路。
    if (result.futureSchema) {
      migrationState = {
        schemaVersion: result.from,
        ranAt: new Date().toISOString(),
        error: 'UNSUPPORTED_FUTURE_SCHEMA',
        repaired: [],
        fatal: true,
        futureSchema: true
      };
      console.error(
        `[migration] 数据由更新版本创建（schemaVersion ${result.from} > ${result.current}），已停止启动`
      );
      try {
        dialog.showErrorBox(
          '数据由更新版本的四一四工作台创建',
          `当前版本识别不了这份数据（数据版本 ${result.from}，本程序支持到 ${result.current}）。\n\n` +
            `请使用更新版本的四一四工作台打开。\n\n` +
            `为避免损坏数据，工作台没有做任何修改，你的文件保持原样。\n` +
            `数据目录：${store.baseDir}\n` +
            `备份目录：${store.backupsDir}`
        );
      } catch (_) {}
      return migrationState;
    }

    migrationState = {
      schemaVersion: result.to,
      ranAt: new Date().toISOString(),
      error: null,
      skipped: result.skipped,
      repaired: result.repaired || [],
      backupPath: result.backupPath || null,
      fatal: false
    };

    if (migrationState.repaired.length) {
      const list = migrationState.repaired.map((item) => item.name).join('、');
      console.error('[migration] 检测到结构异常的数据表并已安全修复：', list);
      try {
        dialog.showErrorBox(
          '检测到损坏的数据文件',
          `以下数据文件的结构不合法，工作台已把它们重置为空白并保留了原始文件：\n\n${list}\n\n` +
            `原始文件保存在数据目录下，文件名以 .broken- 结尾，可以手工检查或恢复。\n` +
            `数据目录：${store.baseDir}`
        );
      } catch (_) {}
    }

    if (!result.skipped) {
      console.log('[migration] 数据迁移完成', JSON.stringify({
        from: result.from,
        to: result.to,
        applied: result.applied,
        repaired: migrationState.repaired.length
      }));
    }
    return migrationState;
  } catch (error) {
    const reason = error.message || String(error);
    migrationState = {
      schemaVersion: migrations.readMeta(store).schemaVersion,
      ranAt: new Date().toISOString(),
      error: reason,
      repaired: [],
      fatal: true
    };
    console.error('[migration] 数据迁移失败：', reason);
    try {
      dialog.showErrorBox(
        '无法安全启动',
        `工作台在检查本地数据时遇到无法自动处理的问题，为避免破坏数据已经停止启动。\n\n` +
          `原因：${reason}\n\n` +
          `你的数据文件没有被删除。数据目录：${store.baseDir}\n` +
          `备份目录：${store.backupsDir}`
      );
    } catch (_) {}
    return migrationState;
  }
}

function configRoot() {
  // 兼容性约定：这里保留 v0.1.x 时期的历史数据目录名，不做重命名。
  // 直接改成新名字会让老用户启动后看到空数据，属于不可接受的数据可见性回归。
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

/**
 * 快速便签。
 *
 * 结构决定权在 electron/services/notes.cjs（可被测试直接覆盖）：
 * - 读取不写盘（避免只打开页面就改动 notes.json）
 * - 空字符串是合法内容，与"没有变化"是两件事
 */
function getQuickNote() {
  return noteService.readQuickNote(fileService.readNotes(store));
}

function saveQuickNote(content) {
  const { notes, quick } = noteService.applyQuickNote(fileService.readNotes(store), content);
  fileService.writeNotes(store, notes);
  return quick;
}

/** 本地日期键；实现集中在 electron/dates.cjs，避免时区处理散落多处 */
function todayKey(date = new Date()) {
  return localTodayKey(date);
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

  // 下面会在原地修改 todo 对象，所以先保存"改动前"的快照用于变化检测，
  // 否则 JSON.stringify(nextTodos) 与 JSON.stringify(todos) 会因为引用相同而永远相等，
  // 导致 workspaceId 的修正只停留在内存里、没有落盘。
  const todosBefore = JSON.stringify(todos);
  const eventsBefore = JSON.stringify(events);

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

  // 生成的待办必须继承其目标的 workspaceId；目标被移动到别的 Workspace 时要跟着走。
  // 注意：手动创建的待办（非 generated）不会被这里改写，workspaceId 也不会丢失。
  for (const goal of goals) {
    const goalWorkspaceId = workspaceService.normalizeWorkspaceId(goal.workspaceId);
    for (const todo of todos) {
      if (!todo.generated || todo.sourceGoalId !== goal.id) continue;
      if (workspaceService.normalizeWorkspaceId(todo.workspaceId) === goalWorkspaceId) continue;
      todo.workspaceId = goalWorkspaceId;
      todo.updatedAt = new Date().toISOString();
    }
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
      // 继承长期目标的归属，保证 Workspace 内能看到自动生成的任务
      workspaceId: workspaceService.normalizeWorkspaceId(goal.workspaceId),
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

  if (JSON.stringify(nextTodos) !== todosBefore) writeTodos(nextTodos);
  if (JSON.stringify(nextEvents) !== eventsBefore) writeCalendarEvents(nextEvents);
}

function readReviews() {
  return store.read('daily-review.json', []);
}

function writeReviews(items) {
  store.write('daily-review.json', items);
}

/**
 * 读取某天的复盘记录。
 * 修复 P1-3：读操作不再产生副作用（原来会创建并写入空记录，污染 daily-review.json）。
 * 落盘交给 review:update。
 */
function getReviewRecord(date) {
  const items = readReviews();
  const record = items.find((item) => item.date === date);
  if (record) return record;
  return {
    date,
    readingMinutes: 0,
    focusMinutes: 0,
    answers: { whatDid: '', whatLearned: '', whatImprove: '' },
    updatedAt: null
  };
}

function saveReviewRecord(date, patch) {
  const items = readReviews();
  const index = items.findIndex((item) => item.date === date);
  const current = index === -1
    ? { date, readingMinutes: 0, focusMinutes: 0, answers: { whatDid: '', whatLearned: '', whatImprove: '' } }
    : items[index];
  const next = {
    ...current,
    ...patch,
    answers: { ...current.answers, ...(patch.answers || {}) },
    date,
    updatedAt: new Date().toISOString()
  };
  if (index === -1) items.push(next);
  else items[index] = next;
  writeReviews(items);
  return next;
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

/** webview 可以加载的主机：内置 AI 站点 + 用户自己添加的书城 */
function isAllowedWebviewUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || '');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname;
    return allowedWebviewHosts().some((item) => host === item || host.endsWith(`.${item}`));
  } catch (_) {
    return false;
  }
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
  // 关闭确认的回执通道：渲染层在确认界面里选择"返回工作 / 结束工作 / 保留会话并退出"
  ipcMain.on('sessions:close-response', (_event, payload) => {
    handleCloseResponse(payload);
  });

  safeHandle('app:info', () => ({
    version: app.getVersion(),
    dataDir: store.baseDir,
    dataRoot: store.dataDir,
    schemaVersion: migrationState.schemaVersion
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
  safeHandle('system:open-external', async (url) => {
    const result = await launcherService.openExternal(url);
    // 失败必须冒泡到渲染层，否则"网页没打开"也会被当成成功
    if (result && result.ok === false) throw new Error(result.error || '打开链接失败');
    return result;
  });  safeHandle('settings:change-data-dir', async () => {
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
    // workspaceId 与 groupId 是两个独立维度，互不影响
    if (patch.workspaceId !== undefined) {
      entry.workspaceId = workspaceService.normalizeWorkspaceId(patch.workspaceId);
    }
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
      workspaceId: workspaceService.normalizeWorkspaceId(goal.workspaceId),
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
      workspaceId: workspaceService.normalizeWorkspaceId(todo.workspaceId),
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
  safeHandle('files:favorites:add', (filePath, workspaceId) => (
    fileService.addFavorite(store, filePath, workspaceId)
  ));
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
      workspaceId: workspaceService.normalizeWorkspaceId(bookmark.workspaceId),
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
  // 写盘只发生在 review:update（修复 P1-3：读操作不再产生副作用）
  safeHandle('review:update', (date, patch) => saveReviewRecord(date, patch || {}));
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
    const imported = backupService.importBackup(store, result.filePaths[0]);
    // 导入被拒绝时必须让渲染层看到失败，不能把 {ok:false} 包成 IPC 成功
    if (imported && imported.ok === false) throw new Error(imported.error || '导入失败');
    return imported;
  });

  /* ---------------------------------------------------------------
   * Workspace（工作空间）
   * ------------------------------------------------------------- */

  safeHandle('workspaces:list', (options) => {
    const opts = options || {};
    if (opts.withStats === false) {
      return workspaceService.listWorkspaces(store, { includeArchived: Boolean(opts.includeArchived) });
    }
    return overviewService.listWorkspaceOverview(store, readTodos(), {
      includeArchived: Boolean(opts.includeArchived)
    });
  });

  safeHandle('workspaces:recent', (limit) => overviewService.recentWorkspaces(store, readTodos(), limit || 3));

  safeHandle('workspaces:get', (workspaceId) => {
    const overview = overviewService.listWorkspaceOverview(store, readTodos(), { includeArchived: true });
    return overview.find((item) => item.id === workspaceId) || null;
  });

  safeHandle('workspaces:create', (input) => workspaceService.createWorkspace(store, input || {}));

  safeHandle('workspaces:update', (workspaceId, patch) => (
    workspaceService.updateWorkspace(store, workspaceId, patch || {})
  ));

  safeHandle('workspaces:archive', (workspaceId, archived) => (
    workspaceService.archiveWorkspace(store, workspaceId, archived !== false)
  ));

  safeHandle('workspaces:reorder', (orderedIds) => workspaceService.reorderWorkspaces(store, orderedIds));

  safeHandle('workspaces:touch', (workspaceId) => workspaceService.touchWorkspace(store, workspaceId));

  // 内部能力：普通 UI 不暴露，只解绑关联数据、不删除关联数据本身。
  safeHandle('workspaces:delete', (workspaceId, options) => {
    if (!options || options.unlinkResources !== true) {
      throw new Error('出于数据安全考虑，工作空间默认只支持归档');
    }
    const result = workspaceService.deleteWorkspace(store, workspaceId);
    const detached = detachWorkspaceResources(workspaceId);
    return { ...result, detached };
  });

  /* ---------------------------------------------------------------
   * Work Session（工作会话）
   * ------------------------------------------------------------- */

  safeHandle('sessions:list', (options) => sessionService.listSessions(store, options || {}));
  safeHandle('sessions:get-active', () => sessionService.getActiveSession(store));
  safeHandle('sessions:start', (workspaceId) => sessionService.startSession(store, workspaceId));

  /**
   * 结束会话。
   * completedTodoIds 必须以【该 Session 自己的 workspaceId】为准做归属校验：
   * 界面可能正停留在另一个 Workspace 上，不能把那边加载到的 Todo 写进来。
   */
  safeHandle('sessions:end', (sessionId, patch) => {
    const session = sessionService.findSession(store, sessionId);
    if (!session) throw new Error('工作记录不存在');
    sessionService.assertTodosInScope(session, readTodos(), (patch || {}).completedTodoIds);
    return sessionService.endSession(store, sessionId, patch || {});
  });

  safeHandle('sessions:update', (sessionId, patch) => {
    const session = sessionService.findSession(store, sessionId);
    if (!session) throw new Error('工作记录不存在');
    sessionService.assertTodosInScope(session, readTodos(), (patch || {}).completedTodoIds);
    return sessionService.updateSession(store, sessionId, patch || {});
  });

  /**
   * 受控的有效工作时长校正。
   *
   * 只对已结束的会话生效，服务层校验有限性/范围，
   * 并把"校正前时长、原始时长、校正时间、说明"一并留档。
   * 不允许通过这个通道改 workspaceId / completedTodoIds / startedAt。
   */
  safeHandle('sessions:adjust-duration', (sessionId, seconds, options) => {
    const session = sessionService.findSession(store, sessionId);
    if (!session) throw new Error('工作记录不存在');
    return sessionService.adjustSessionDuration(store, sessionId, seconds, options || {});
  });

  safeHandle('sessions:end-and-adjust', (sessionId, seconds, options) => {
    const session = sessionService.findSession(store, sessionId);
    if (!session) throw new Error('工作记录不存在');
    return sessionService.endAndAdjustSessionDuration(store, sessionId, seconds, options || {});
  });

  /** 异常重启后用户选择"继续这段工作"：只留审计痕迹，不新建会话 */
  safeHandle('sessions:resume', (sessionId) => {
    const session = sessionService.findSession(store, sessionId);
    if (!session) throw new Error('工作记录不存在');
    return sessionService.resumeSession(store, sessionId);
  });

  /**
   * 某个 Workspace 的工作历史（最小历史入口）。
   *
   * - 只返回该 Workspace 自己的会话，不泄露其他空间内容
   * - 默认只取最近若干条，支持 limit 分页（"查看更多"）
   * - 归档 Workspace 的历史同样可查
   * - 补齐完成事项标题；Todo 已被删除时明确标记，不让历史凭空消失
   */
  safeHandle('sessions:history', (options) => {
    const opts = options || {};
    const workspaceId = workspaceService.normalizeWorkspaceId(opts.workspaceId);
    if (!workspaceId) throw new Error('缺少工作空间信息');

    const todos = readTodos();
    const todoById = new Map(
      todos.filter((todo) => todo && todo.id).map((todo) => [todo.id, todo])
    );

    const sessions = sessionService.listSessions(store, {
      workspaceId,
      limit: opts.limit,
      dateKey: opts.dateKey,
      from: opts.from,
      to: opts.to
    }).filter((item) => !sessionService.isActive(item));

    return sessions.map((session) => {
      const ids = Array.isArray(session.completedTodoIds) ? session.completedTodoIds : [];
      const completedTodos = ids.map((todoId) => {
        const todo = todoById.get(todoId);
        return {
          id: todoId,
          title: todo ? todo.title : '（原任务已删除）',
          missing: !todo
        };
      });
      return {
        ...session,
        completedTodos,
        completedCount: completedTodos.length,
        durationAdjusted: sessionService.wasDurationAdjusted(session)
      };
    });
  });

  safeHandle('sessions:delete', (sessionId) => sessionService.deleteSession(store, sessionId));
  safeHandle('sessions:summary', (options) => sessionService.summarizeSessions(store, options || {}));

  /** 某个 Workspace 最近一次已结束的会话（"继续上次工作"快照的数据来源） */
  safeHandle('sessions:last', (workspaceId) => {
    const session = sessionService.lastFinishedSession(store, workspaceId);
    if (!session) return null;
    const todos = readTodos();
    const completed = new Set(Array.isArray(session.completedTodoIds) ? session.completedTodoIds : []);
    return {
      ...session,
      completedTodos: todos.filter((todo) => completed.has(todo.id)),
      remainingTodos: todos.filter((todo) => (
        workspaceService.normalizeWorkspaceId(todo.workspaceId) === workspaceService.normalizeWorkspaceId(workspaceId)
        && todo.completed !== true
      ))
    };
  });

  /* ---------------------------------------------------------------
   * 资源关联辅助能力
   * ------------------------------------------------------------- */

  safeHandle('system:path-exists', (targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return false;
    try {
      return fs.existsSync(targetPath);
    } catch (_) {
      return false;
    }
  });

  // 批量预检：Workspace 中一次性判断多个应用/文件路径是否仍然存在
  safeHandle('system:path-exists-batch', (paths) => {
    const result = {};
    if (!Array.isArray(paths)) return result;
    for (const item of paths) {
      if (!item || typeof item !== 'string') continue;
      try {
        result[item] = fs.existsSync(item);
      } catch (_) {
        result[item] = false;
      }
    }
    return result;
  });

  /**
   * 待办提醒：在【主进程】弹系统通知。
   * 渲染进程的 new Notification() 在 Windows 上不会显示（构造函数也不抛错），
   * 这正是"提醒静默失效"的根因。主进程 + AppUserModelId 才是可用路径。
   * 返回 { shown } 让渲染层知道是否真的弹出，避免悄悄把 reminderFired 置为 true。
   */
  safeHandle('system:notify', (payload) => {
    const title = String((payload && payload.title) || '四一四工作台');
    const body = String((payload && payload.body) || '');
    if (!Notification.isSupported()) return { shown: false, reason: 'unsupported' };
    const notification = new Notification({ title, body, silent: false });
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
    return { shown: true };
  });

  safeHandle('workspaces:link-resource', (payload) => linkResource(payload || {}));
}

/**
 * 把一条已有资源关联到 Workspace（只更新外键，不复制资源）。
 * kind: 'todo' | 'goal' | 'note' | 'bookmark' | 'app' | 'favorite'
 */
function linkResource(payload) {
  const kind = String(payload.kind || '');
  const resourceId = String(payload.id || '');
  const workspaceId = workspaceService.normalizeWorkspaceId(payload.workspaceId);
  if (!kind || !resourceId) throw new Error('缺少资源信息');

  if (workspaceId) {
    const exists = workspaceService.findWorkspace(store, workspaceId);
    if (!exists) throw new Error('工作空间不存在');
  }

  const now = new Date().toISOString();

  if (kind === 'todo') {
    const items = readTodos();
    const index = items.findIndex((item) => item.id === resourceId);
    if (index === -1) throw new Error('待办不存在');
    items[index] = { ...items[index], workspaceId, updatedAt: now };
    writeTodos(items);
    return items[index];
  }

  if (kind === 'goal') {
    const items = readGoals();
    const index = items.findIndex((item) => item.id === resourceId);
    if (index === -1) throw new Error('目标不存在');
    items[index] = { ...items[index], workspaceId, updatedAt: now };
    writeGoals(items);
    return items[index];
  }

  if (kind === 'bookmark') {
    const items = readBookmarks();
    const index = items.findIndex((item) => item.id === resourceId);
    if (index === -1) throw new Error('收藏不存在');
    items[index] = { ...items[index], workspaceId, updatedAt: now };
    writeBookmarks(items);
    return items[index];
  }

  if (kind === 'note') {
    const items = fileService.readNotes(store);
    const index = items.findIndex((item) => item.id === resourceId);
    if (index === -1) throw new Error('便签不存在');
    items[index] = { ...items[index], workspaceId, updatedAt: now };
    fileService.writeNotes(store, items);
    return items[index];
  }

  if (kind === 'app') {
    const items = appService.readApps(store);
    const index = items.findIndex((item) => item.id === resourceId);
    if (index === -1) throw new Error('应用不存在');
    items[index] = { ...items[index], workspaceId };
    store.write('apps.json', items);
    return appService.hydrateApp(store, items[index]);
  }

  if (kind === 'favorite') {
    const items = fileService.readFavorites(store);
    const index = items.findIndex((item) => item.id === resourceId);
    if (index === -1) throw new Error('收藏的文件不存在');
    items[index] = { ...items[index], workspaceId };
    fileService.writeFavorites(store, items);
    return items[index];
  }

  throw new Error(`不支持的资源类型：${kind}`);
}

/** 仅在工作空间被物理删除时调用：把关联资源解绑回"未归类" */
function detachWorkspaceResources(workspaceId) {
  const target = workspaceService.normalizeWorkspaceId(workspaceId);
  if (!target) return 0;
  let count = 0;

  const tables = [
    { read: readTodos, write: writeTodos },
    { read: readGoals, write: writeGoals },
    { read: readBookmarks, write: writeBookmarks },
    { read: () => fileService.readNotes(store), write: (items) => fileService.writeNotes(store, items) },
    { read: () => appService.readApps(store), write: (items) => store.write('apps.json', items) }
  ];

  for (const table of tables) {
    const items = table.read();
    let changed = false;
    for (const item of items) {
      if (workspaceService.normalizeWorkspaceId(item.workspaceId) !== target) continue;
      item.workspaceId = null;
      changed = true;
      count += 1;
    }
    if (changed) table.write(items);
  }

  // 文件收藏是按 path + workspaceId 分作用域存储的，物理解绑时移除该作用域的记录
  const favorites = fileService.readFavorites(store);
  const keptFavorites = favorites.filter(
    (item) => workspaceService.normalizeWorkspaceId(item.workspaceId) !== target
  );
  count += favorites.length - keptFavorites.length;
  if (keptFavorites.length !== favorites.length) fileService.writeFavorites(store, keptFavorites);

  return count;
}

/* ------------------------------------------------------------------ *
 * 关闭窗口时的"未结束工作"确认（P1-01）
 *
 * 设计要点：
 * - 主进程先查有没有 active Session，没有就完全不介入，正常关闭
 * - 有 active Session 时 preventDefault()，把决策交给渲染层的确认界面
 * - 用一个挂起的 Promise 而不是事件循环阻塞：不会卡死关闭流程
 * - pendingCloseResolve 保证同一时间只有一个确认框；渲染层没有响应时
 *   3 秒后按"保留会话并退出"放行，绝不出现关不掉的情况
 * - forceQuit 为 true 时直接放行，避免 close → preventDefault 死循环
 * ------------------------------------------------------------------ */

const CLOSE_DECISION_TIMEOUT_MS = 3000;

let forceQuit = false;
let closeDecisionPending = false;
let closeDecisionTimer = null;
let pendingCloseResolve = null;
let pendingCloseRequestId = null;
let closeRequestSequence = 0;

function resolveCloseDecision(action) {
  if (closeDecisionTimer) {
    clearTimeout(closeDecisionTimer);
    closeDecisionTimer = null;
  }
  const resolve = pendingCloseResolve;
  pendingCloseResolve = null;
  pendingCloseRequestId = null;
  closeDecisionPending = false;
  if (resolve) resolve(action || 'exit');
}

/** 渲染层在确认界面里做出的选择 */
function handleCloseResponse(payload) {
  if (!closeDecisionPending || !payload || payload.requestId !== pendingCloseRequestId) return;
  if (payload.action === 'shown') {
    // 渲染层已显示确认框。用户作决定或保存期间不能使用无响应超时。
    if (closeDecisionTimer) clearTimeout(closeDecisionTimer);
    closeDecisionTimer = null;
    return;
  }
  if (payload.action !== 'exit' && payload.action !== 'cancel') return;
  resolveCloseDecision(payload.action);
}

/**
 * @returns {Promise<'exit'|'cancel'>} exit = 允许窗口关闭；cancel = 保持窗口
 */
function askRendererAboutActiveSession() {
  const target = mainWindow;
  if (!target || target.isDestroyed()) return Promise.resolve('exit');

  closeDecisionPending = true;
  pendingCloseRequestId = `${Date.now()}-${++closeRequestSequence}`;
  const requestId = pendingCloseRequestId;
  return new Promise((resolve) => {
    pendingCloseResolve = resolve;
    closeDecisionTimer = setTimeout(() => {
      // 渲染层异常/卡住时的安全兜底：保留会话并退出，不能把应用卡在"关不掉"的状态
      console.error('[close] 渲染层未在期限内回应关闭确认，按"保留会话并退出"处理');
      resolveCloseDecision('exit');
    }, CLOSE_DECISION_TIMEOUT_MS);
    if (typeof closeDecisionTimer.unref === 'function') closeDecisionTimer.unref();
    try {
      target.webContents.send('sessions:close-request', { requestId });
    } catch (error) {
      console.error('[close] 无法通知渲染层关闭确认：', error && error.message);
      resolveCloseDecision('exit');
    }
  });
}

/**
 * 窗口关闭前的统一入口。
 * 返回 true 表示"这次关闭已经被拦下，等用户决定"。
 */
function handleWindowClose(event) {
  if (forceQuit) return false;
  if (closeDecisionPending) {
    event.preventDefault();
    return true;
  }

  let session = null;
  try {
    session = sessionService.getActiveSession(store);
  } catch (error) {
    console.error('[close] 读取进行中的工作时出错：', error && error.message);
    return false;
  }
  if (!session) return false;

  event.preventDefault();
  askRendererAboutActiveSession().then((action) => {
    if (action === 'cancel') return;
    // 结束工作由渲染层走现有 sessions:end 流程；这里只负责放行关闭
    forceQuit = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  return true;
}

function createWindow() {
  forceQuit = false;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#f2f2f7',
    title: '四一四工作台',
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

    // 只校验首次 attach 是不够的：webview 内部还能继续导航
    if (!isAllowedWebviewUrl(params.src)) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 只允许 http/https 交给系统浏览器，避免 file: / 自定义协议被用来拉起本机程序
    launcherService.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    handleWindowClose(event);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 窗口已经真的关了：清掉可能残留的确认状态
    resolveCloseDecision('exit');
  });

  // 第二次启动发生在窗口建好之前时，这里补一次聚焦
  if (pendingSecondInstanceFocus) {
    pendingSecondInstanceFocus = false;
    focusMainWindow();
  }
}

/**
 * 把已有主窗口带到前台。
 * 窗口可能还没建立（第二次启动发生在启动早期），此时只记一个待办标记，
 * 等 createWindow() 完成后再补聚焦。
 */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingSecondInstanceFocus = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  // 弹窗一律拒绝，只有 http/https 才转交系统浏览器（修复 P1-6）
  contents.setWindowOpenHandler(({ url }) => {
    launcherService.openExternal(url);
    return { action: 'deny' };
  });

  // 首次 attach 之后 webview 内部仍然可以继续导航，这里对后续导航做同样的主机白名单校验
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedWebviewUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedWebviewUrl(url)) event.preventDefault();
  });

  // webview 里的第三方页面不应拿到摄像头/麦克风/地理位置/通知等权限
  try {
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  } catch (_) {}
});

/**
 * 单实例锁。
 *
 * 每个实例都有独立的渲染进程状态，却共用同一批 JSON 文件；DataStore 只有
 * 单文件临时替换，没有跨进程 compare-and-swap。两个实例同时运行会互相覆盖
 * 整表内容（比赛现场重复双击启动就可能触发）。
 * 桌面 MVP 的正确做法就是只允许单实例：拿不到锁的进程直接退出，
 * 不建窗口、不注册 IPC、绝不参与数据写入。
 */
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.whenReady().then(() => {
    // Windows 上系统通知必须设置 AppUserModelId，否则通知不会显示
    if (process.platform === 'win32') {
      try {
        app.setAppUserModelId('com.xiaoboluo.workbench');
      } catch (_) {}
    }
    store = new DataStore(dataRoot());

    // 数据安全闸门：结构修复 + 版本迁移。
    // 不可恢复的失败必须停止启动，绝不能进入会写数据的普通链路。
    const guard = runStartupMigrations();
    if (guard.fatal) {
      app.exit(1);
      return;
    }

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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
