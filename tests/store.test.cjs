const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DataStore } = require('../electron/store.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-store-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

test('DataStore 默认值读取：文件不存在时返回默认值并落盘', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    const items = store.read('todos.json', []);
    assert.deepEqual(items, []);
    assert.ok(fs.existsSync(store.filePath('todos.json')), '默认值应被写入磁盘');

    const defaults = { theme: 'light', nested: { a: 1 } };
    assert.deepEqual(store.read('settings.json', defaults), defaults);
  } finally {
    cleanup(dir);
  }
});

test('DataStore 默认值读取：返回的是副本，修改不会污染调用方默认值', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    const defaults = [{ id: 'a', tags: [] }];
    const first = store.read('goals.json', defaults);
    first.push({ id: 'b' });
    first[0].tags.push('x');
    assert.equal(defaults.length, 1);
    assert.deepEqual(defaults[0].tags, []);
  } finally {
    cleanup(dir);
  }
});

test('DataStore 写入后重新读取内容一致', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    const payload = [
      { id: '1', title: '中文任务 ✅', completed: false, workspaceId: null },
      { id: '2', title: 'a"b\\c', completed: true, workspaceId: 'ws-1' }
    ];
    store.write('todos.json', payload);

    const reloaded = new DataStore(dir).read('todos.json', []);
    assert.deepEqual(reloaded, payload);
  } finally {
    cleanup(dir);
  }
});

test('DataStore 写入是原子替换，不留临时文件', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('notes.json', [{ id: 'n1' }]);
    store.write('notes.json', [{ id: 'n1' }, { id: 'n2' }]);
    const leftovers = fs.readdirSync(store.dataDir).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
    assert.equal(store.read('notes.json', []).length, 2);
  } finally {
    cleanup(dir);
  }
});

test('DataStore JSON 损坏自愈：改名保留坏文件并重建默认值', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    const file = store.filePath('bookmarks.json');
    fs.writeFileSync(file, '{ 这不是合法 JSON', 'utf8');

    const result = store.read('bookmarks.json', []);
    assert.deepEqual(result, [], '损坏后应返回默认值');

    const brokenFiles = fs.readdirSync(store.dataDir).filter((name) => name.includes('.broken-'));
    assert.equal(brokenFiles.length, 1, '坏文件应被改名保留');
    assert.equal(fs.readFileSync(path.join(store.dataDir, brokenFiles[0]), 'utf8'), '{ 这不是合法 JSON');

    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [], '应重建为默认值');
  } finally {
    cleanup(dir);
  }
});

test('DataStore 损坏自愈对对象型数据表同样生效（如 settings.json）', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    fs.writeFileSync(store.filePath('settings.json'), 'null,null', 'utf8');
    const settings = store.read('settings.json', { theme: 'light' });
    assert.deepEqual(settings, { theme: 'light' });
  } finally {
    cleanup(dir);
  }
});

test('DataStore 会创建全部约定目录', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    for (const target of [
      store.dataDir,
      store.appThumbsDir,
      store.imageThumbsDir,
      store.booksDir,
      store.backupsDir,
      store.logsDir
    ]) {
      assert.ok(fs.existsSync(target), `缺少目录 ${target}`);
    }
  } finally {
    cleanup(dir);
  }
});
