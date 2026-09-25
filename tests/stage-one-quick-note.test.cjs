/**
 * 阶段一 · 任务二（P1-03）：快速便签清空后立即离开不会丢内容。
 *
 * 覆盖两层：
 * 1. 渲染层保存控制器 src/renderer/src/composables/quick-note.js（真实实现，不是复制品）
 *    —— 卸载 / 切页、空字符串、连续编辑、失败保持未保存状态、慢请求不覆盖新内容。
 * 2. 真实 IPC 链路（files:notes:save-quick / get-quick）与 notes.json 落盘结果。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { boot, breakDataDir, restoreDataDir } = require('./helpers/electron-harness.cjs');

const QUICK_NOTE_HREF = pathToFileURL(
  path.join(__dirname, '..', 'src', 'renderer', 'src', 'composables', 'quick-note.js')
).href;
const quickNoteModule = import(QUICK_NOTE_HREF);

async function loadQuickNoteModule() {
  return quickNoteModule;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNotes(ctx) {
  const file = path.join(ctx.dataDir, 'data', 'notes.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* ------------------------------------------------------------------ *
 * 1. 控制器：空字符串是合法内容，flush 由"未保存变更"决定
 * ------------------------------------------------------------------ */

test('阶段一-12 空字符串也会被保存：flush 之后保存函数收到空串', async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  const calls = [];
  let content = '先写点东西';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: async (value) => {
      calls.push(value);
    },
    delayMs: 5
  });

  assert.equal(saver.dirty, false, '没有任何编辑时不应产生未保存状态');
  content = '';
  saver.markChanged(); // 用户把便签清空
  assert.equal(saver.dirty, true, '清空同样是一次未保存变更');

  const result = await saver.flush();
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [''], '空字符串必须真的写盘，不能因为内容为空而跳过');
  assert.equal(saver.dirty, false, '保存成功后未保存状态必须清除');
});

test('阶段一-13 清空后立即离开（卸载 flush）不会把旧内容留在盘上', async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  const stored = { value: '旧内容' };
  let content = '旧内容';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: async (value) => {
      stored.value = value;
    },
    delayMs: 10000 // 很长的防抖，模拟"用户还没等到自动保存就切页"
  });

  content = '';
  saver.markChanged();
  assert.equal(saver.hasPendingTimer, true, '防抖定时器应在等待中');

  // 组件 onBeforeUnmount 调用的就是这个入口
  const result = await saver.flushWithRetry();
  assert.equal(result.ok, true);
  assert.equal(stored.value, '', '重新打开便签必须是空内容，不能恢复旧内容');
  assert.equal(saver.hasPendingTimer, false, '卸载 flush 必须清掉未执行的防抖定时器');
  assert.equal(saver.dirty, false);
});

test('阶段一-14 输入文字后等待自动保存：防抖触发一次真实写入', async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  const calls = [];
  let content = '';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: async (value) => {
      calls.push(value);
    },
    delayMs: 10
  });

  content = '今';
  saver.markChanged();
  content = '今天';
  saver.markChanged();
  content = '今天要交周报';
  saver.markChanged();
  await sleep(60);

  assert.deepEqual(calls, ['今天要交周报'], '连续输入只应保存最终内容');
  assert.equal(saver.dirty, false);
});

test('阶段一-15 连续输入与删除：最后一次结果为准', async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  const calls = [];
  let content = '';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: async (value) => {
      calls.push(value);
    },
    delayMs: 10
  });

  content = '一二三';
  saver.markChanged();
  await sleep(30);
  content = '一二';
  saver.markChanged();
  await sleep(30);
  content = '';
  saver.markChanged();
  await sleep(30);

  assert.deepEqual(calls, ['一二三', '一二', '']);
  assert.equal(saver.dirty, false);
});

test('阶段一-16 保存失败时保持未保存状态，并可重试成功', async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  const calls = [];
  let fail = true;
  let content = '重要内容';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: async (value) => {
      calls.push(value);
      if (fail) throw new Error('磁盘写入失败');
    },
    delayMs: 5
  });

  saver.markChanged();
  const failed = await saver.flush();
  assert.equal(failed.ok, false);
  assert.match(failed.error, /磁盘写入失败/);
  assert.equal(saver.dirty, true, '保存失败绝不能清除未保存状态');
  assert.equal(saver.status, 'error', '失败必须产生可见的错误状态');

  fail = false;
  const retried = await saver.flush();
  assert.equal(retried.ok, true);
  assert.equal(saver.dirty, false);
  assert.deepEqual(calls, ['重要内容', '重要内容']);
});

test('阶段一-17 慢请求返回时不能覆盖更新的内容（过期响应保护）', { timeout: 5000 }, async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  /** 手动控制每次保存请求何时返回，模拟"慢请求" */
  const pendingSaves = [];
  const stored = [];
  let content = '第一版';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: (value) => new Promise((resolve) => {
      pendingSaves.push({ value, resolve });
    }),
    delayMs: 10000
  });

  saver.markChanged();
  const firstFlush = saver.flush();
  await sleep(5);
  assert.equal(pendingSaves.length, 1, '第一次保存请求应该已经发出');
  assert.equal(pendingSaves[0].value, '第一版');

  // 请求在飞的时候用户又改了内容
  content = '第二版';
  saver.markChanged();

  // 第一次（过期）响应现在才返回
  stored.push(pendingSaves[0].value);
  pendingSaves[0].resolve();
  await sleep(5);

  // 必须补写第二次，把最新内容写完
  assert.equal(pendingSaves.length, 2, '过期响应返回后必须补写最新内容');
  assert.equal(pendingSaves[1].value, '第二版');
  stored.push(pendingSaves[1].value);
  pendingSaves[1].resolve();

  await firstFlush;
  assert.deepEqual(stored, ['第一版', '第二版']);
  assert.equal(saver.dirty, false, '最终必须收敛到"已保存最新内容"');
  assert.equal(saver.lastSavedRevision, saver.revision, '已保存版本必须等于当前版本');
});

test('阶段一-18 连续快速切换页面：多次 flush 不会丢失最后一次变更', async () => {
  const { createQuickNoteSaver } = await loadQuickNoteModule();
  const calls = [];
  let content = 'a';
  const saver = createQuickNoteSaver({
    getContent: () => content,
    save: async (value) => {
      calls.push(value);
    },
    delayMs: 10000
  });

  saver.markChanged();
  await saver.flushWithRetry();
  content = 'ab';
  saver.markChanged();
  await saver.flushWithRetry();
  content = '';
  saver.markChanged();
  await saver.flushWithRetry();

  assert.deepEqual(calls, ['a', 'ab', '']);
  assert.equal(saver.dirty, false);
});

/* ------------------------------------------------------------------ *
 * 2. 真实 IPC + notes.json：空串落盘、老数据兼容
 * ------------------------------------------------------------------ */

test('阶段一-19 通过真实 IPC 清空便签：读回是空串，不是旧内容', async () => {
  const ctx = await boot('xb-stage1-quick-');
  try {
    const first = await ctx.invoke('files:notes:save-quick', '旧内容');
    assert.equal(first.content, '旧内容');

    const cleared = await ctx.invoke('files:notes:save-quick', '');
    assert.equal(cleared.content, '', '空字符串是合法保存内容');

    const reloaded = await ctx.invoke('files:notes:get-quick');
    assert.equal(reloaded.content, '', '重新进入页面必须是空内容');

    const rows = readNotes(ctx);
    const quick = rows.find((item) => item.type === 'quick');
    assert.equal(quick.content, '');
    assert.equal(rows.length, 1, '不应产生第二条快速便签');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-20 只读取、不编辑时不写入便签内容；反复读取返回同一条记录', async () => {
  const ctx = await boot('xb-stage1-quick-read-');
  try {
    const first = await ctx.invoke('files:notes:get-quick');
    const second = await ctx.invoke('files:notes:get-quick');
    assert.equal(first.id, second.id, '反复读取不能生成不同的快速便签');
    assert.equal(first.content, '');

    // 关键语义：读操作本身不产生业务写入（不凭空造出一条快捷便签）
    const rows = readNotes(ctx);
    assert.deepEqual(rows, [], '读取快速便签不应产生记录（落盘只发生在真正保存时）');

    await ctx.invoke('files:notes:save-quick', '真正保存的内容');
    const after = readNotes(ctx);
    assert.equal(after.filter((item) => item.type === 'quick').length, 1);
    assert.equal(after[0].content, '真正保存的内容');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-21 便签写盘失败：IPC 返回失败，重试后成功', async () => {
  const ctx = await boot('xb-stage1-quick-fail-');
  try {
    await ctx.invoke('files:notes:save-quick', '先写一条正常的');

    breakDataDir(ctx);
    const raw = await ctx.raw('files:notes:save-quick', '');
    assert.equal(raw.ok, false, '写盘失败必须如实返回失败');
    assert.ok(raw.error);

    restoreDataDir(ctx);
    const retry = await ctx.invoke('files:notes:save-quick', '');
    assert.equal(retry.content, '');

    const reloaded = await ctx.invoke('files:notes:get-quick');
    assert.equal(reloaded.content, '', '重试成功后旧内容必须被清掉');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-22 老版本便签数据（无 id / content 为 null）仍能正常读取', async () => {
  const ctx = await boot('xb-stage1-quick-legacy-');
  try {
    const notesFile = path.join(ctx.dataDir, 'data', 'notes.json');
    fs.writeFileSync(notesFile, JSON.stringify([
      { title: '快速便签', content: null, type: 'quick', pinned: false, createdAt: '2025-01-01T00:00:00.000Z' },
      { id: 'n1', title: '普通便签', content: '正文', type: 'note' }
    ], null, 2), 'utf8');

    const quick = await ctx.invoke('files:notes:get-quick');
    assert.equal(quick.content, '', 'null 内容按空串读取');

    const saved = await ctx.invoke('files:notes:save-quick', '新的内容');
    assert.equal(saved.content, '新的内容');

    const rows = readNotes(ctx);
    assert.equal(rows.filter((item) => item.type === 'quick').length, 1, '不能重复创建快速便签');
    assert.equal(rows.find((item) => item.id === 'n1').content, '正文', '普通便签不能被破坏');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-23 数字 / false 等内容不被当成空值丢弃', async () => {
  const { normalizeQuickNoteContent } = await loadQuickNoteModule();
  assert.equal(normalizeQuickNoteContent(0), '0');
  assert.equal(normalizeQuickNoteContent(false), 'false');
  assert.equal(normalizeQuickNoteContent(null), '');
  assert.equal(normalizeQuickNoteContent(undefined), '');
  assert.equal(normalizeQuickNoteContent('   '), '   ', '空白字符是用户真实输入，不能裁剪');
});
