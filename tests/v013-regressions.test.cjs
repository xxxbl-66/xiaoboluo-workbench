const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./helpers/electron-harness.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('关闭确认等待期间重复关闭不能绕过用户决定，旧回执不能处理新请求', async () => {
  const ctx = await boot('v013-close-repeat-');
  try {
    await ctx.invoke('sessions:start', null);
    const window = ctx.electronMock.__windows[0];
    assert.equal(window.close(), false);
    const first = ctx.electronMock.__sentToRenderer.at(-1);
    assert.equal(first.channel, 'sessions:close-request');
    assert.equal(typeof first.payload.requestId, 'string');

    assert.equal(window.close(), false);
    await tick();
    assert.equal(window.destroyed, false);
    assert.equal(ctx.electronMock.__sentToRenderer.length, 1);

    ctx.send('sessions:close-response', { action: 'cancel', requestId: first.payload.requestId });
    await tick();
    assert.equal(window.destroyed, false);

    assert.equal(window.close(), false);
    const second = ctx.electronMock.__sentToRenderer.at(-1);
    assert.notEqual(second.payload.requestId, first.payload.requestId);
    ctx.send('sessions:close-response', { action: 'exit', requestId: first.payload.requestId });
    await tick();
    assert.equal(window.destroyed, false);
    ctx.send('sessions:close-response', { action: 'cancel', requestId: second.payload.requestId });
  } finally {
    ctx.teardown();
  }
});

test('确认框已经显示后，三秒无最终选择不得强制退出', { timeout: 6000 }, async () => {
  const ctx = await boot('v013-close-shown-');
  try {
    await ctx.invoke('sessions:start', null);
    const window = ctx.electronMock.__windows[0];
    window.close();
    const requestId = ctx.electronMock.__sentToRenderer.at(-1).payload.requestId;
    ctx.send('sessions:close-response', { action: 'shown', requestId });
    await new Promise((resolve) => setTimeout(resolve, 3200));
    assert.equal(window.destroyed, false);
    ctx.send('sessions:close-response', { action: 'cancel', requestId });
    await tick();
    assert.equal(window.destroyed, false);
  } finally {
    ctx.teardown();
  }
});

test('结束并校正由一次写盘完成，非法时长不结束原会话', async () => {
  const ctx = await boot('v013-atomic-adjust-');
  try {
    const running = (await ctx.invoke('sessions:start', null)).session;
    const file = path.join(ctx.dataDir, 'data', 'work-sessions.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows[0].startedAt = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(rows), 'utf8');

    const bad = await ctx.raw('sessions:end-and-adjust', running.id, 9 * 24 * 3600, { reason: '无效' });
    assert.equal(bad.ok, false);
    assert.equal((await ctx.invoke('sessions:get-active')).id, running.id);

    const ended = await ctx.invoke('sessions:end-and-adjust', running.id, 3600, { reason: '实际一小时' });
    assert.equal(ended.durationSeconds, 3600);
    assert.ok(ended.originalDurationSeconds > 7 * 24 * 3600);
    assert.equal(ended.durationAdjustmentCount, 1);
    assert.equal(ended.durationAdjustmentReason, '实际一小时');
    assert.equal(await ctx.invoke('sessions:get-active'), null);
    assert.equal((await ctx.invoke('sessions:list')).length, 1);
  } finally {
    ctx.teardown();
  }
});

test('暂不处理后的既有会话返回保持入口，曾恢复过的会话下次启动仍需提示', async () => {
  const active = {
    id: 'old-session', workspaceId: 'w', startedAt: '2025-01-01T00:00:00.000Z', endedAt: null
  };
  let stored = active;
  global.window = {
    workbench: {
      sessions: {
        getActive: async () => stored,
        start: async () => ({ started: false, reason: 'active-exists', session: stored }),
        resume: async () => {
          stored = { ...stored, resumedAt: new Date().toISOString(), resumeCount: 1 };
          return stored;
        },
        end: async () => {
          const ended = { ...stored, endedAt: new Date().toISOString() };
          stored = null;
          return ended;
        }
      }
    }
  };
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src/renderer/src/composables/useWorkSession.js')).href;
  const first = (await import(`${moduleUrl}?boot=first`)).useWorkSession();
  try {
    await first.initialize();
    assert.equal(first.needsRestoreDecision.value, true);
    first.dismissRestorePrompt();
    assert.equal(first.restorePromptDismissed.value, true);
    await first.startSession('another-workspace');
    assert.equal(first.restorePromptDismissed.value, true);

    await first.resumeSession();
    const second = (await import(`${moduleUrl}?boot=second`)).useWorkSession();
    try {
      await second.initialize();
      assert.equal(second.needsRestoreDecision.value, true);
    } finally {
      await second.endSession({});
    }
  } finally {
    if (first.activeSession.value) await first.endSession({});
    delete global.window;
  }
});

test('复盘旧保存回执不能覆盖保存期间继续输入的内容', async () => {
  const url = pathToFileURL(path.join(__dirname, '..', 'src/renderer/src/composables/review-save-controller.js')).href;
  const { createReviewSaveController } = await import(url);
  const draft = { answers: { whatDid: '第一版' } };
  const writes = [];
  let resolveFirst;
  const controller = createReviewSaveController({
    getDraft: () => ({ answers: { ...draft.answers } }),
    write: (payload) => {
      writes.push(payload);
      if (writes.length === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(payload);
    },
    applySaved: (saved) => { draft.answers.whatDid = saved.answers.whatDid; }
  });
  controller.markChanged();
  const first = controller.save();
  draft.answers.whatDid = '第二版';
  controller.markChanged();
  resolveFirst({ answers: { whatDid: '第一版' } });
  assert.equal((await first).ok, true);
  assert.equal(draft.answers.whatDid, '第二版');
  await controller.save();
  assert.equal(writes.at(-1).answers.whatDid, '第二版');
});

test('自定义铃声保存失败后不能再显示成功提示', async () => {
  const url = pathToFileURL(path.join(__dirname, '..', 'src/renderer/src/composables/settings-actions.js')).href;
  const { saveCustomTone } = await import(url);
  const messages = [];
  const audio = { name: '提示音', dataUrl: 'data:audio/mp3;base64,YQ==' };
  const failed = await saveCustomTone(audio, async () => ({ ok: false, error: '磁盘写入失败' }),
    (message) => messages.push(message));
  assert.equal(failed.ok, false);
  assert.deepEqual(messages, []);
  const saved = await saveCustomTone(audio, async () => ({ ok: true }),
    (message) => messages.push(message));
  assert.equal(saved.ok, true);
  assert.deepEqual(messages, ['自定义铃声已保存']);
});
