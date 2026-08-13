const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result || result.ok === false) {
    throw new Error((result && result.error) || '操作失败');
  }
  return result.data;
}

const api = {
  app: {
    info: () => invoke('app:info')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch)
  },
  system: {
    selectApp: () => invoke('system:select-app'),
    selectFile: () => invoke('system:select-file'),
    selectImage: () => invoke('system:select-image'),
    selectAvatar: () => invoke('system:select-avatar'),
    selectBook: () => invoke('system:select-book'),
    selectDirectory: () => invoke('system:select-directory'),
    openPath: (filePath) => invoke('system:open-path', filePath),
    openDataDir: () => invoke('system:open-data-dir'),
    openLogsDir: () => invoke('system:open-logs-dir'),
    openExternal: (url) => invoke('system:open-external', url)
  },
  apps: {
    list: () => invoke('apps:list'),
    launch: (appId) => invoke('apps:launch', appId),
    add: (filePath, options) => invoke('apps:add', filePath, options),
    scanDesktop: (groupId) => invoke('apps:scan-desktop', groupId),
    update: (appId, patch) => invoke('apps:update', appId, patch),
    remove: (appId) => invoke('apps:delete', appId),
    reorder: (groupId, orderedIds) => invoke('apps:reorder', groupId, orderedIds)
  },
  groups: {
    list: () => invoke('groups:list'),
    create: (name) => invoke('groups:create', name),
    update: (groupId, name) => invoke('groups:update', groupId, name),
    remove: (groupId) => invoke('groups:delete', groupId)
  },
  goals: {
    list: () => invoke('goals:list'),
    create: (goal) => invoke('goals:create', goal),
    update: (goalId, patch) => invoke('goals:update', goalId, patch),
    remove: (goalId) => invoke('goals:delete', goalId)
  },
  todos: {
    list: () => invoke('todos:list'),
    create: (todo) => invoke('todos:create', todo),
    update: (todoId, patch) => invoke('todos:update', todoId, patch),
    remove: (todoId) => invoke('todos:delete', todoId),
    reorder: (orderedIds) => invoke('todos:reorder', orderedIds)
  },
  files: {
    drives: () => invoke('files:drives'),
    browse: (dir) => invoke('files:browse', dir),
    open: (filePath) => invoke('files:open', filePath),
    reveal: (filePath) => invoke('files:reveal', filePath),
    favorites: {
      list: () => invoke('files:favorites:list'),
      add: (filePath) => invoke('files:favorites:add', filePath),
      remove: (entryId) => invoke('files:favorites:remove', entryId)
    },
    images: {
      list: () => invoke('files:images:list'),
      add: (filePath) => invoke('files:images:add', filePath),
      remove: (entryId) => invoke('files:images:remove', entryId)
    },
    notes: {
      list: () => invoke('files:notes:list'),
      create: (note) => invoke('files:notes:create', note),
      update: (noteId, patch) => invoke('files:notes:update', noteId, patch),
      remove: (noteId) => invoke('files:notes:delete', noteId),
      getQuick: () => invoke('files:notes:get-quick'),
      saveQuick: (content) => invoke('files:notes:save-quick', content)
    }
  },
  workflows: {
    list: () => invoke('workflows:list'),
    create: (workflow) => invoke('workflows:create', workflow),
    update: (workflowId, patch) => invoke('workflows:update', workflowId, patch),
    remove: (workflowId) => invoke('workflows:delete', workflowId),
    reorder: (orderedIds) => invoke('workflows:reorder', orderedIds),
    run: (workflowId) => invoke('workflows:run', workflowId)
  },
  checkins: {
    get: () => invoke('checkins:get'),
    toggle: () => invoke('checkins:toggle')
  },
  bookmarks: {
    list: () => invoke('bookmarks:list'),
    create: (bookmark) => invoke('bookmarks:create', bookmark),
    update: (bookmarkId, patch) => invoke('bookmarks:update', bookmarkId, patch),
    remove: (bookmarkId) => invoke('bookmarks:delete', bookmarkId)
  },
  calendar: {
    list: () => invoke('calendar:list'),
    create: (event) => invoke('calendar:create', event),
    update: (eventId, patch) => invoke('calendar:update', eventId, patch),
    remove: (eventId) => invoke('calendar:delete', eventId)
  },
  review: {
    get: (date) => invoke('review:get', date),
    update: (date, patch) => invoke('review:update', date, patch)
  },  books: {
    list: () => invoke('books:list'),
    add: (filePath) => invoke('books:add', filePath),
    remove: (bookId) => invoke('books:remove', bookId),
    open: (bookId) => invoke('books:open', bookId),
    onChanged: (callback) => {
      const listener = (_event, book) => callback(book);
      ipcRenderer.on('books:changed', listener);
      return () => ipcRenderer.removeListener('books:changed', listener);
    }
  },
  backup: {
    export: () => invoke('backup:export'),
    import: () => invoke('backup:import')
  }
};

contextBridge.exposeInMainWorld('workbench', api);
