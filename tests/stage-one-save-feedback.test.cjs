/**
 * 阶段一 · 任务一（P1-02）：复盘与设置的保存结果反馈。
 *
 * 覆盖两层：
 * 1. 渲染层判定逻辑（src/renderer/src/composables/save-result.js）——
 *    这是 UI 决定"要不要提示成功"的唯一入口，直接 import 真实模块，不复制实现。
 * 2. 真实 IPC 链路（review:update / settings:update）——
 *    正常保存、主进程业务失败、磁盘写入失败，全部用隔离的临时数据目录。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { boot, breakDataDir, restoreDataDir } = require('./helpers/electron-harness.cjs');

/**
 * 渲染层的保存判定模块是 ESM，这里用动态 import 直接加载【真实实现】，
 * 不把逻辑复制到测试里重写一遍。
 */
const SAVE_RESULT_HREF = pathToFileURL(
  path.join(__dirname, '..', 'src', 'renderer', 'src', 'composables', 'save-result.js')
).href;
const saveResultModule = import(SAVE_RESULT_HREF);

async function loadSaveResult() {
  return saveResultModule;
}

/* ------------------------------------------------------------------ *
 * 1. 保存结果判定：只有真实成功才允许显示成功提示
 * ------------------------------------------------------------------ */

test('阶段一-01 保存成功时 ok=true，并回传写入结果', async () => {
  const { runSave } = await loadSaveResult();
  const outcome = await runSave(async () => ({ date: '2026-01-01', answers: { whatDid: '写代码' } }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.error, '');
  assert.equal(outcome.data.answers.whatDid, '写代码');
});

test('阶段一-02 主进程返回业务失败（{ok:false}）绝不能算成功', async () => {
  const { runSave } = await loadSaveResult();
  const outcome = await runSave(async () => ({ ok: false, error: '磁盘写入失败' }));
  assert.equal(outcome.ok, false, '业务失败不能被当成保存成功');
  assert.match(outcome.error, /磁盘写入失败/);
});

test('阶段一-03 保存函数返回 null/undefined 时视为失败（P1-02 的原始返回形态）', async () => {
  const { runSave, isConfirmedSave } = await loadSaveResult();
  assert.equal(isConfirmedSave(null), false);
  assert.equal(isConfirmedSave(undefined), false);
  const outcome = await runSave(async () => null);
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /没有确认写入/);
});

test('阶段一-04 IPC 调用失败（reject）时返回失败与可读原因', async () => {
  const { runSave } = await loadSaveResult();
  const outcomeBoom = await runSave(async () => {
    throw new Error('EACCES: permission denied');
  });
  assert.equal(outcomeBoom.ok, false);
  assert.match(outcomeBoom.error, /EACCES/);

  const outcomeThrowString = await runSave(async () => {
    throw '写入失败';
  });
  assert.equal(outcomeThrowString.ok, false);
  assert.match(outcomeThrowString.error, /写入失败/);

  const outcomeEmpty = await runSave(async () => {
    throw new Error('');
  });
  assert.equal(outcomeEmpty.ok, false);
  assert.equal(outcomeEmpty.error, '保存失败，请重试', '没有消息时必须给默认中文提示');
});

test('阶段一-05 磁盘写入失败的可控模拟：真实 data 目录不可写', async () => {
  const { runSave } = await loadSaveResult();
  const ctx = await boot('xb-stage1-review-');
  try {
    const before = await ctx.invoke('review:get', '2026-01-01');
    assert.equal(before.answers.whatDid, '');

    // 让 data 目录本身变成一个文件：任何写盘都会失败
    breakDataDir(ctx);

    const raw = await ctx.raw('review:update', '2026-01-01', { answers: { whatDid: '写盘会失败' } });
    assert.equal(raw.ok, false, '写盘失败必须如实返回 ok:false');
    assert.ok(raw.error, '必须带可读的错误原因');

    // 走 preload 的调用链时表现为 reject，组件必须据此显示失败而不是成功
    const outcome = await runSave(() => ctx.invoke('review:update', '2026-01-01', { answers: { whatDid: 'x' } }));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.data, undefined);

    restoreDataDir(ctx);

    // 再次尝试保存必须成功（失败后允许重新保存）
    const retry = await runSave(() => ctx.invoke('review:update', '2026-01-01', { answers: { whatDid: '重试成功' } }));
    assert.equal(retry.ok, true);
    const reloaded = await ctx.invoke('review:get', '2026-01-01');
    assert.equal(reloaded.answers.whatDid, '重试成功', '重试成功后数据必须真的落盘');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-06 复盘正常保存后能读回，且历史列表包含该天', async () => {
  const ctx = await boot('xb-stage1-review-ok-');
  try {
    const saved = await ctx.invoke('review:update', '2026-02-02', {
      readingMinutes: 30,
      focusMinutes: 45,
      answers: { whatDid: '完成登录接口', whatLearned: 'JWT', whatImprove: '早点睡' }
    });
    assert.equal(saved.date, '2026-02-02');
    assert.equal(saved.readingMinutes, 30);

    const reloaded = await ctx.invoke('review:get', '2026-02-02');
    assert.equal(reloaded.focusMinutes, 45);
    assert.equal(reloaded.answers.whatDid, '完成登录接口');

    const history = await ctx.invoke('review:list');
    assert.ok(history.some((item) => item.date === '2026-02-02'));
  } finally {
    ctx.teardown();
  }
});

/* ------------------------------------------------------------------ *
 * 2. 设置保存：名称与主题都必须有真实结果反馈
 * ------------------------------------------------------------------ */

test('阶段一-07 设置正常保存：用户信息与主题写盘后读回一致', async () => {
  const ctx = await boot('xb-stage1-settings-ok-');
  try {
    const next = await ctx.invoke('settings:update', {
      user: { name: '四一四', avatarDataUrl: '' },
      theme: 'dark'
    });
    assert.equal(next.user.name, '四一四');
    assert.equal(next.theme, 'dark');

    // 重新读取（模拟 App.vue 启动时读取设置）
    const reloaded = await ctx.invoke('settings:get');
    assert.equal(reloaded.user.name, '四一四');
    assert.equal(reloaded.theme, 'dark');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-08 设置保存失败必须返回失败，不能被当成成功', async () => {
  const { runSave } = await loadSaveResult();
  const ctx = await boot('xb-stage1-settings-fail-');
  try {
    breakDataDir(ctx);

    const raw = await ctx.raw('settings:update', { user: { name: '保存不了', avatarDataUrl: '' } });
    assert.equal(raw.ok, false);

    const outcome = await runSave(() => ctx.invoke('settings:update', { user: { name: '保存不了' } }));
    assert.equal(outcome.ok, false);

    restoreDataDir(ctx);

    // 失败后允许重新保存（用户输入保留由组件负责，这里验证重试链路）
    const retry = await runSave(() => ctx.invoke('settings:update', { user: { name: '第二次成功' } }));
    assert.equal(retry.ok, true);
    const reloaded = await ctx.invoke('settings:get');
    assert.equal(reloaded.user.name, '第二次成功');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-09 保存成功时才通知调用方，失败时不产生成功回调', async () => {
  const { runSave } = await loadSaveResult();
  const events = [];
  await runSave(async () => ({ ok: true, data: 1 }), { onResult: (r) => events.push(r.ok) });
  await runSave(async () => null, { onResult: (r) => events.push(r.ok) });
  await runSave(async () => { throw new Error('boom'); }, { fallback: '复盘保存失败', onResult: (r) => events.push(r.ok) });
  assert.deepEqual(events, [true, false, false]);

  // onResult 自身抛错不能反过来影响判定
  const outcome = await runSave(async () => ({ ok: true, data: 1 }), {
    onResult: () => {
      throw new Error('通知失败');
    }
  });
  assert.equal(outcome.ok, true);
});

test('阶段一-10 describeError 始终给出用户可读的中文提示', async () => {
  const { describeError } = await loadSaveResult();
  assert.equal(describeError(new Error('具体原因')), '具体原因');
  assert.equal(describeError(null, '设置保存失败'), '设置保存失败');
  assert.equal(describeError('  ', '设置保存失败'), '设置保存失败');
  assert.equal(describeError({ message: '   ' }, '设置保存失败'), '设置保存失败');
});

test('阶段一-11 复盘数据结构未被改动（无新增字段、无 migration）', async () => {
  const ctx = await boot('xb-stage1-review-shape-');
  try {
    await ctx.invoke('review:update', '2026-03-03', { answers: { whatDid: 'x' } });
    const file = path.join(ctx.dataDir, 'data', 'daily-review.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['answers', 'date', 'focusMinutes', 'readingMinutes', 'updatedAt']);
    assert.deepEqual(Object.keys(rows[0].answers).sort(), ['whatDid', 'whatLearned', 'whatImprove'].sort());
  } finally {
    ctx.teardown();
  }
});
