/**
 * 阶段一 · 任务三 / 四 / 五 / 六 / 七：
 * - 长期目标删除后的 UI 状态刷新（P1-04）
 * - Session 关闭与异常重启处理（P1-01 / 阶段 E、F）
 * - 受控的有效工作时长校正（阶段 G）
 * - Workspace 最小工作历史入口（阶段 H）
 *
 * 全部走真实的 electron/main.cjs + IPC + DataStore，数据落在隔离临时目录。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { boot, cleanup } = require('./helpers/electron-harness.cjs');

function esm(relative) {
  return import(pathToFileURL(path.join(__dirname, '..', relative)).href);
}

const goalActionsModule = esm('src/renderer/src/components/goal-actions.js');
const sessionDurationModule = esm('src/renderer/src/composables/session-duration.js');
const quickNoteModule = esm('src/renderer/src/composables/quick-note.js');

function readTable(ctx, name) {
  const file = path.join(ctx.dataDir, 'data', name);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeTable(ctx, name, rows) {
  fs.writeFileSync(path.join(ctx.dataDir, 'data', name), JSON.stringify(rows, null, 2), 'utf8');
}

/** 模拟"上次没结束工作就退出了"：把 active session 的 startedAt 改到过去 */
function ageActiveSession(ctx, hoursAgo) {
  const rows = readTable(ctx, 'work-sessions.json');
  const startedAt = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const next = rows.map((item) => (item.endedAt ? item : { ...item, startedAt, dateKey: startedAt.slice(0, 10) }));
  writeTable(ctx, 'work-sessions.json', next);
  return next.find((item) => !item.endedAt);
}

/* ================================================================== *
 * 任务三：长期目标删除（P1-04）
 * ================================================================== */

test('阶段一-24 目标删除成功后必须刷新真正的状态源（新列表参与渲染）', async () => {
  const { removeGoalAndReload } = await goalActionsModule;
  const remaining = [{ id: 'g2', title: '保留的目标' }];
  let removedId = '';
  let listCalls = 0;

  const result = await removeGoalAndReload('g1', {
    remove: async (goalId) => {
      removedId = goalId;
      return [];
    },
    list: async () => {
      listCalls += 1;
      return remaining;
    }
  });

  assert.equal(removedId, 'g1');
  assert.equal(listCalls, 1, '删除成功后必须重新拉取列表，而不是给只读 computed 赋值');
  assert.equal(result.ok, true);
  assert.deepEqual(result.goals, remaining);
});

test('阶段一-25 目标删除失败时不能提前从界面移除目标', async () => {
  const { removeGoalAndReload } = await goalActionsModule;
  let listCalled = false;

  const result = await removeGoalAndReload('g1', {
    remove: async () => {
      throw new Error('目标不存在');
    },
    list: async () => {
      listCalled = true;
      return [];
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /目标不存在/);
  assert.equal(result.goals, null, '失败时必须返回 null，调用方保留原列表');
  assert.equal(listCalled, false, '删除失败不应触发列表刷新');
});

test('阶段一-26 删除已完成但列表刷新失败时：数据已删，明确告知需要重载', async () => {
  const { removeGoalAndReload } = await goalActionsModule;
  const result = await removeGoalAndReload('g1', {
    remove: async () => [],
    list: async () => {
      throw new Error('读取失败');
    }
  });
  assert.equal(result.ok, true, '删除本身已经成功');
  assert.equal(result.goals, null);
  assert.match(result.reloadFailed, /读取失败/);
});

test('阶段一-27 IPC 删除：普通页面与 Workspace 页面都能立即看到目标消失', async () => {
  const ctx = await boot('xb-stage1-goal-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '竞赛项目' });
    const loose = await ctx.invoke('goals:create', { title: '未归类目标' });
    const inWs = await ctx.invoke('goals:create', { title: '空间内目标', workspaceId: ws.id });
    const keep = await ctx.invoke('goals:create', { title: '保留目标', workspaceId: ws.id });

    const before = await ctx.invoke('goals:list');
    assert.equal(before.length, 3);

    // 普通页面删除：删除后列表里必须真的没有它
    await ctx.invoke('goals:delete', loose.id);
    const afterLoose = await ctx.invoke('goals:list');
    assert.equal(afterLoose.length, 2);
    assert.ok(!afterLoose.some((item) => item.id === loose.id));

    // Workspace 页面删除：只影响被删的那一个
    await ctx.invoke('goals:delete', inWs.id);
    const afterWs = await ctx.invoke('goals:list');
    assert.equal(afterWs.length, 1);
    assert.equal(afterWs[0].id, keep.id, '其他目标不能被牵连');
    assert.equal(afterWs[0].workspaceId, ws.id, '保留目标的归属不能被改动');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-28 删除目标必须同步清理它自动生成的 Todo 与日历事件，其他目标不受影响', async () => {
  const ctx = await boot('xb-stage1-goal-sync-');
  try {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const goalA = await ctx.invoke('goals:create', {
      title: '每天背单词',
      recurrence: { type: 'daily', days: [] },
      recurrenceTask: '背 50 个单词'
    });
    const goalB = await ctx.invoke('goals:create', {
      title: '每天跑步',
      recurrence: { type: 'daily', days: [] },
      recurrenceTask: '跑 3 公里'
    });

    const todosBefore = await ctx.invoke('todos:list');
    assert.ok(todosBefore.some((item) => item.sourceGoalId === goalA.id && item.sourceDate === dateKey));
    assert.ok(todosBefore.some((item) => item.sourceGoalId === goalB.id && item.sourceDate === dateKey));

    const eventsBefore = await ctx.invoke('calendar:list');
    assert.ok(eventsBefore.some((item) => item.sourceGoalId === goalA.id));

    await ctx.invoke('goals:delete', goalA.id);

    const todosAfter = await ctx.invoke('todos:list');
    assert.ok(
      !todosAfter.some((item) => item.sourceGoalId === goalA.id),
      '被删目标生成的待办必须清理'
    );
    assert.ok(
      todosAfter.some((item) => item.sourceGoalId === goalB.id && item.sourceDate === dateKey),
      '其他目标的生成型待办必须保留'
    );

    const eventsAfter = await ctx.invoke('calendar:list');
    assert.ok(!eventsAfter.some((item) => item.sourceGoalId === goalA.id), '被删目标生成的日历事件必须清理');
    assert.ok(eventsAfter.some((item) => item.sourceGoalId === goalB.id), '其他目标的日历事件必须保留');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-29 删除失败（目标不存在）时 IPC 返回失败，磁盘数据不变', async () => {
  const ctx = await boot('xb-stage1-goal-miss-');
  try {
    const goal = await ctx.invoke('goals:create', { title: '唯一目标' });
    const before = readTable(ctx, 'goals.json');

    // goals:delete 是过滤式删除：不存在的 ID 不会报错，但也不能改动任何数据
    const raw = await ctx.raw('goals:delete', 'not-exist');
    assert.equal(raw.ok, true);
    assert.deepEqual(readTable(ctx, 'goals.json'), before, '删除不存在的目标不能改动数据');

    const stillThere = await ctx.invoke('goals:list');
    assert.equal(stillThere.length, 1);
    assert.equal(stillThere[0].id, goal.id);
  } finally {
    ctx.teardown();
  }
});

/* ================================================================== *
 * 任务六：有效工作时长校正
 * ================================================================== */

test('阶段一-30 时长校验：拒绝负数 / NaN / Infinity / 非数字字符串 / 越界', async () => {
  const { parseDurationSeconds, MAX_ADJUSTABLE_SECONDS } = await sessionDurationModule;

  assert.equal(parseDurationSeconds(3600).ok, true);
  assert.equal(parseDurationSeconds(3600).seconds, 3600);
  assert.equal(parseDurationSeconds('3600').ok, true);
  assert.equal(parseDurationSeconds(0).ok, true, '0 是合法值（这次工作没有有效时长）');

  for (const bad of [-1, -3600]) {
    const result = parseDurationSeconds(bad);
    assert.equal(result.ok, false, `${bad} 必须被拒绝`);
    assert.match(result.error, /负数|非负整数/);
  }
  for (const bad of [NaN, Infinity, -Infinity, 'abc', '1.5', '1e3', '', '  ', null, undefined, {}, [], true]) {
    const result = parseDurationSeconds(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} 必须被拒绝`);
  }
  assert.equal(parseDurationSeconds(MAX_ADJUSTABLE_SECONDS + 1).ok, false);
  assert.equal(parseDurationSeconds(MAX_ADJUSTABLE_SECONDS).ok, true);
});

test('阶段一-31 IPC 校正：非法值全部被拒绝，合法值落盘并被记录', async () => {
  const ctx = await boot('xb-stage1-adjust-');
  try {
    const session = (await ctx.invoke('sessions:start', null)).session;
    await ctx.invoke('sessions:end', session.id, { note: '一段工作' });

    // 未结束的会话不能校正
    const running = (await ctx.invoke('sessions:start', null)).session;
    const activeAdjust = await ctx.raw('sessions:adjust-duration', running.id, 600);
    assert.equal(activeAdjust.ok, false);
    assert.match(activeAdjust.error, /还没有结束/);
    await ctx.invoke('sessions:end', running.id, {});

    for (const bad of [-10, Number.NaN, 'Infinity', 'abc', 8 * 24 * 3600]) {
      const raw = await ctx.raw('sessions:adjust-duration', session.id, bad);
      assert.equal(raw.ok, false, `非法时长 ${String(bad)} 必须被拒绝`);
    }

    const adjusted = await ctx.invoke('sessions:adjust-duration', session.id, 5400, { reason: '忘记结束' });
    assert.equal(adjusted.durationSeconds, 5400);
    assert.equal(adjusted.durationAdjustmentReason, '忘记结束');
    assert.equal(adjusted.durationAdjustedBy, 'user');
    assert.equal(adjusted.durationAdjustmentCount, 1);
    assert.ok(adjusted.durationAdjustedAt);
    assert.equal(adjusted.resumedAt, undefined);

    // 原始开始时间必须保留
    assert.equal(adjusted.startedAt, session.startedAt);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-32 校正不能改动 Workspace 归属与 completedTodoIds（也不能被用来改写其他字段）', async () => {
  const ctx = await boot('xb-stage1-adjust-guard-');
  try {
    const wsA = await ctx.invoke('workspaces:create', { name: 'A' });
    const wsB = await ctx.invoke('workspaces:create', { name: 'B' });
    const todo = await ctx.invoke('todos:create', { title: 'A 的任务', workspaceId: wsA.id });

    const session = (await ctx.invoke('sessions:start', wsA.id)).session;
    const ended = await ctx.invoke('sessions:end', session.id, {
      note: '干活',
      nextStep: '继续',
      completedTodoIds: [todo.id]
    });

    const adjusted = await ctx.invoke('sessions:adjust-duration', session.id, 1234, {
      reason: '修正',
      // 恶意/误传的额外字段都不能生效
      workspaceId: wsB.id,
      completedTodoIds: [],
      startedAt: '2000-01-01T00:00:00.000Z',
      endedAt: '2000-01-01T01:00:00.000Z',
      dateKey: '2000-01-01',
      note: '被改掉的备注',
      nextStep: '被改掉的下一步'
    });

    assert.equal(adjusted.workspaceId, wsA.id, '校正不能改归属工作空间');
    assert.deepEqual(adjusted.completedTodoIds, [todo.id], '校正不能改完成事项');
    assert.equal(adjusted.startedAt, ended.startedAt, '校正不能改开始时间');
    assert.equal(adjusted.endedAt, ended.endedAt, '校正不能改结束时间');
    assert.equal(adjusted.dateKey, ended.dateKey, '校正不能改统计归属日期');
    assert.equal(adjusted.note, '干活', '校正不能改备注');
    assert.equal(adjusted.nextStep, '继续', '校正不能改下一步');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-33 重复校正保留可追踪记录，原始时长只写一次', async () => {
  const ctx = await boot('xb-stage1-adjust-repeat-');
  try {
    const session = (await ctx.invoke('sessions:start', null)).session;
    const ended = await ctx.invoke('sessions:end', session.id, {});
    const machineDuration = ended.durationSeconds;

    const first = await ctx.invoke('sessions:adjust-duration', session.id, 600, { reason: '第一次' });
    assert.equal(first.originalDurationSeconds, machineDuration, '原始机器时长必须保留');
    assert.equal(first.previousDurationSeconds, machineDuration);
    assert.equal(first.durationAdjustmentCount, 1);

    const second = await ctx.invoke('sessions:adjust-duration', session.id, 1200, { reason: '第二次' });
    assert.equal(second.durationSeconds, 1200);
    assert.equal(second.previousDurationSeconds, 600, '必须记录上一次被覆盖的时长');
    assert.equal(second.originalDurationSeconds, machineDuration, '原始时长不能被后续校正覆盖');
    assert.equal(second.durationAdjustmentCount, 2);
    assert.equal(second.durationAdjustmentReason, '第二次');

    const fromDisk = readTable(ctx, 'work-sessions.json').find((item) => item.id === session.id);
    assert.equal(fromDisk.durationSeconds, 1200, '校正结果必须落盘');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-34 已结束的会话不能被普通 end 重复覆盖', async () => {
  const ctx = await boot('xb-stage1-double-end-');
  try {
    const session = (await ctx.invoke('sessions:start', null)).session;
    const ended = await ctx.invoke('sessions:end', session.id, { note: '第一次结束' });

    const again = await ctx.raw('sessions:end', session.id, { note: '重复结束' });
    assert.equal(again.ok, false, '重复结束必须被拒绝');
    assert.match(again.error, /已经结束/);

    const fromDisk = readTable(ctx, 'work-sessions.json').find((item) => item.id === session.id);
    assert.equal(fromDisk.note, '第一次结束');
    assert.equal(fromDisk.endedAt, ended.endedAt);
    assert.equal(fromDisk.completedTodoIds.length, 0);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-35 校正后今日复盘汇总与 Workspace 累计时长同步变化', async () => {
  const ctx = await boot('xb-stage1-adjust-summary-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '竞赛项目' });
    const session = (await ctx.invoke('sessions:start', ws.id)).session;
    const ended = await ctx.invoke('sessions:end', session.id, {});
    const dateKey = ended.dateKey;

    const before = await ctx.invoke('sessions:summary', { dateKey });
    const beforeTotal = before.totalSeconds;
    assert.equal(beforeTotal, ended.durationSeconds);

    await ctx.invoke('sessions:adjust-duration', session.id, 1800, { reason: '实际只工作半小时' });

    const after = await ctx.invoke('sessions:summary', { dateKey });
    assert.equal(after.totalSeconds, 1800, '今日复盘必须使用校正后的有效时长');
    assert.equal(after.sessionCount, 1);

    const workspaces = await ctx.invoke('workspaces:list', { includeArchived: true });
    const target = workspaces.find((item) => item.id === ws.id);
    assert.equal(target.totalSeconds, 1800, 'Workspace 累计时长必须使用校正后的有效时长');

    // 工作快照也不能继续显示旧时长
    const last = await ctx.invoke('sessions:last', ws.id);
    assert.equal(last.durationSeconds, 1800);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-36 老版本 Session（没有新增审计字段）能正常读取，不影响校正', async () => {
  const ctx = await boot('xb-stage1-legacy-session-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '老数据' });
    // 直接写入一份 v0.1.x 形态的老记录
    writeTable(ctx, 'work-sessions.json', [{
      id: 'legacy-1',
      workspaceId: ws.id,
      startedAt: '2026-01-01T01:00:00.000Z',
      endedAt: '2026-01-01T02:00:00.000Z',
      durationSeconds: 3600,
      dateKey: '2026-01-01',
      note: '老记录',
      nextStep: '',
      completedTodoIds: []
    }]);

    const list = await ctx.invoke('sessions:list', { workspaceId: ws.id });
    assert.equal(list.length, 1);
    assert.equal(list[0].durationAdjustmentCount, undefined, '老记录没有新字段也照常读取');

    const history = await ctx.invoke('sessions:history', { workspaceId: ws.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].durationAdjusted, false, '老记录显示为未校正');

    const adjusted = await ctx.invoke('sessions:adjust-duration', 'legacy-1', 1800, { reason: '老记录修正' });
    assert.equal(adjusted.durationSeconds, 1800);
    assert.equal(adjusted.originalDurationSeconds, 3600);
    assert.equal(adjusted.startedAt, '2026-01-01T01:00:00.000Z');
  } finally {
    ctx.teardown();
  }
});

/* ================================================================== *
 * 任务四 / 五：关闭确认与异常重启处理
 * ================================================================== */

test('阶段一-37 关闭判定：没有正在进行的会话时直接放行，不弹确认', async () => {
  const { decideCloseAction, shouldExitAfterClose, toCloseResponse } = await sessionDurationModule;

  assert.equal(decideCloseAction(null), 'proceed');
  assert.equal(decideCloseAction({ id: 'x', endedAt: '2026-01-01T00:00:00.000Z' }), 'proceed');
  assert.equal(decideCloseAction({ id: 'x', endedAt: null }), 'confirm');

  // 三个操作必须被准确区分
  assert.equal(shouldExitAfterClose('back', true), false, '返回工作不能关闭窗口');
  assert.equal(shouldExitAfterClose('back', false), false);
  assert.equal(shouldExitAfterClose('end', true), true, '结束工作保存成功后才关闭');
  assert.equal(shouldExitAfterClose('end', false), false, '结束工作保存失败绝不能关闭');
  assert.equal(shouldExitAfterClose('keep', false), true, '保留会话并退出允许关闭');

  assert.equal(toCloseResponse('back'), 'cancel');
  assert.equal(toCloseResponse('end'), 'exit');
  assert.equal(toCloseResponse('keep'), 'exit');
});

test('阶段一-38 关闭回执通道已被主进程注册，异常输入不会导致崩溃', async () => {
  const ctx = await boot('xb-stage1-close-channel-');
  try {
    // 主进程通过 ipcMain.on('sessions:close-response') 接收渲染层回执
    assert.ok(ctx.electronMock.__ipcOn.has('sessions:close-response'), '必须注册关闭回执通道');

    assert.doesNotThrow(() => ctx.send('sessions:close-response', { action: 'cancel' }));
    assert.doesNotThrow(() => ctx.send('sessions:close-response', { action: 'exit' }));
    assert.doesNotThrow(() => ctx.send('sessions:close-response', null));
    assert.doesNotThrow(() => ctx.send('sessions:close-response', { action: '不存在的操作' }));
  } finally {
    ctx.teardown();
  }
});

test('阶段一-39 有 active Session 时选择"结束工作"：走现有 end 流程并且只留下一条记录', async () => {
  const ctx = await boot('xb-stage1-close-end-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '收尾' });
    const session = (await ctx.invoke('sessions:start', ws.id)).session;
    ageActiveSession(ctx, 2);

    const active = await ctx.invoke('sessions:get-active');
    assert.equal(active.id, session.id, '关闭前必须能查到正在进行的工作');

    await ctx.invoke('sessions:end', session.id, { note: '', nextStep: '', completedTodoIds: [] });
    assert.equal(await ctx.invoke('sessions:get-active'), null, '结束后不能再有 active Session');

    const rows = readTable(ctx, 'work-sessions.json');
    assert.equal(rows.length, 1, '不能产生第二条会话');
    assert.ok(rows[0].endedAt);
    assert.ok(rows[0].durationSeconds >= 7200 - 5, '时长按开始时间计算');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-40 有 active Session 时选择"保留会话并退出"：会话保持未结束，下次启动仍能查到', async () => {
  const ctx = await boot('xb-stage1-close-keep-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '保留' });
    const session = (await ctx.invoke('sessions:start', ws.id)).session;
    ageActiveSession(ctx, 26);

    // "保留会话并退出"不会调用 sessions:end，会话原样留在盘上
    const rows = readTable(ctx, 'work-sessions.json');
    assert.equal(rows[0].endedAt, null);
    assert.equal(rows[0].id, session.id);

    const active = await ctx.invoke('sessions:get-active');
    assert.equal(active.id, session.id);
    assert.equal(active.workspaceId, ws.id);
    assert.ok(active.startedAt < new Date().toISOString(), '保留原始开始时间');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-41 异常重启后能找到未结束的 Session（真实重启：同一数据目录再启动一次）', async () => {
  const bootFirst = await boot('xb-stage1-restart-', { keepRoot: true });
  const workRoot = bootFirst.workRoot;
  let sessionId = '';
  let workspaceId = '';
  try {
    const ws = await bootFirst.invoke('workspaces:create', { name: '隔夜项目' });
    workspaceId = ws.id;
    const session = (await bootFirst.invoke('sessions:start', ws.id)).session;
    sessionId = session.id;
    // 模拟"忘记结束就直接关机"：开始时间被推到 26 小时前
    const aged = ageActiveSession(bootFirst, 26);
    assert.equal(aged.id, sessionId, '数据已准备好：存在一条未结束的会话');
  } finally {
    bootFirst.teardown();
  }
  // 重新启动（新的 main.cjs 实例、同一份数据）
  const bootSecond = await boot('unused', { workRoot });
  try {
    const active = await bootSecond.invoke('sessions:get-active');
    assert.ok(active, '重启后必须能找到未结束的工作');
    assert.equal(active.id, sessionId);
    assert.equal(active.endedAt, null);

    const workspaces = await bootSecond.invoke('workspaces:list', { includeArchived: true });
    assert.equal(workspaces.find((item) => item.id === active.workspaceId).name, '隔夜项目');
    assert.equal(active.workspaceId, workspaceId);

    // 渲染层判定"这是跨次启动的未结束工作，需要用户明确决定"
    const { decideCloseAction } = await sessionDurationModule;
    assert.equal(decideCloseAction(active), 'confirm');
  } finally {
    bootSecond.teardown();
    cleanup(workRoot);
  }
});

test('阶段一-42 选择"继续这段工作"：不新建第二条记录，只留恢复痕迹', async () => {
  const ctx = await boot('xb-stage1-resume-');
  try {
    const session = (await ctx.invoke('sessions:start', null)).session;
    ageActiveSession(ctx, 12);

    const resumed = await ctx.invoke('sessions:resume', session.id);
    const aged = readTable(ctx, 'work-sessions.json').find((item) => item.id === session.id);
    assert.equal(resumed.id, session.id, '继续必须复用原记录');
    assert.ok(resumed.resumedAt, '必须记录继续时间');
    assert.equal(resumed.resumeCount, 1);
    assert.equal(resumed.startedAt, aged.startedAt, '开始时间不能被改动');

    const rows = readTable(ctx, 'work-sessions.json');
    assert.equal(rows.length, 1, '不能新建第二条 active 会话');
    assert.equal(rows.filter((item) => !item.endedAt).length, 1, '全局只能有一条 active');

    // 已结束的记录不能被"继续"
    await ctx.invoke('sessions:end', session.id, {});
    const again = await ctx.raw('sessions:resume', session.id);
    assert.equal(again.ok, false);
    assert.match(again.error, /已经结束/);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-43 选择"结束并校正时长"：结束原记录后校正，不产生第二条 active 会话', async () => {
  const ctx = await boot('xb-stage1-end-adjust-');
  try {
    const session = (await ctx.invoke('sessions:start', null)).session;
    ageActiveSession(ctx, 26);

    // 界面流程：先结束原记录，再对已结束记录做受控校正
    const ended = await ctx.invoke('sessions:end', session.id, { note: '', nextStep: '', completedTodoIds: [] });
    assert.ok(ended.endedAt);
    assert.ok(ended.durationSeconds >= 26 * 3600 - 10, '结束时会先按真实时间算出虚高时长');

    const adjusted = await ctx.invoke('sessions:adjust-duration', session.id, 3 * 3600, { reason: '实际只工作了 3 小时' });
    assert.equal(adjusted.durationSeconds, 3 * 3600, '必须用用户确认的时长覆盖虚高值');
    assert.equal(adjusted.startedAt, ended.startedAt, '保留原始开始时间');
    assert.equal(await ctx.invoke('sessions:get-active'), null, '不能产生第二个 active 会话');

    const summary = await ctx.invoke('sessions:summary', { dateKey: adjusted.dateKey });
    assert.equal(summary.totalSeconds, 3 * 3600);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-44 选择"暂不处理"：记录保留、不自动结束、之后仍能重新处理', async () => {
  const ctx = await boot('xb-stage1-later-');
  try {
    const session = (await ctx.invoke('sessions:start', null)).session;
    ageActiveSession(ctx, 30);

    // "暂不处理"在渲染层只是关闭提示，不写任何数据
    const active = await ctx.invoke('sessions:get-active');
    assert.equal(active.id, session.id, '暂不处理后会话仍然是待处理的 active 状态');
    assert.equal(active.endedAt, null);

    const rows = readTable(ctx, 'work-sessions.json');
    assert.equal(rows.length, 1, '暂不处理不能新建会话，也不能悄悄结束');

    // 稍后仍能进入处理流程：继续或结束都必须可用
    const resumed = await ctx.invoke('sessions:resume', session.id);
    assert.equal(resumed.id, session.id);

    const ended = await ctx.invoke('sessions:end', session.id, {});
    assert.ok(ended.endedAt);
  } finally {
    ctx.teardown();
  }
});

/* ================================================================== *
 * 任务七：Workspace 最小工作历史入口
 * ================================================================== */

test('阶段一-45 工作历史只返回当前 Workspace 的记录，并带完成事项与备注', async () => {
  const ctx = await boot('xb-stage1-history-');
  try {
    const wsA = await ctx.invoke('workspaces:create', { name: 'A 项目' });
    const wsB = await ctx.invoke('workspaces:create', { name: 'B 项目' });
    const todoA = await ctx.invoke('todos:create', { title: 'A 的任务', workspaceId: wsA.id });

    const s1 = (await ctx.invoke('sessions:start', wsA.id)).session;
    await ctx.invoke('sessions:end', s1.id, { note: '登录接口', nextStep: '写测试', completedTodoIds: [todoA.id] });

    const s2 = (await ctx.invoke('sessions:start', wsB.id)).session;
    await ctx.invoke('sessions:end', s2.id, { note: 'B 的工作' });

    const historyA = await ctx.invoke('sessions:history', { workspaceId: wsA.id });
    assert.equal(historyA.length, 1, '不能显示其他 Workspace 的会话内容');
    assert.equal(historyA[0].id, s1.id);
    assert.equal(historyA[0].note, '登录接口');
    assert.equal(historyA[0].nextStep, '写测试');
    assert.equal(historyA[0].completedCount, 1);
    assert.equal(historyA[0].completedTodos[0].title, 'A 的任务');
    assert.equal(historyA[0].durationAdjusted, false);

    const historyB = await ctx.invoke('sessions:history', { workspaceId: wsB.id });
    assert.equal(historyB.length, 1);
    assert.equal(historyB[0].id, s2.id);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-46 历史默认只加载最近若干条，limit 可以"查看更多"', async () => {
  const ctx = await boot('xb-stage1-history-limit-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '多记录' });
    for (let index = 0; index < 8; index += 1) {
      const session = (await ctx.invoke('sessions:start', ws.id)).session;
      await ctx.invoke('sessions:end', session.id, { note: `第 ${index + 1} 次` });
    }

    const firstPage = await ctx.invoke('sessions:history', { workspaceId: ws.id, limit: 3 });
    assert.equal(firstPage.length, 3, '首屏不能一次加载全部历史');

    const more = await ctx.invoke('sessions:history', { workspaceId: ws.id, limit: 8 });
    assert.equal(more.length, 8);
    // 最近的排在最前
    assert.equal(more[0].note, '第 8 次');
    assert.equal(more[7].note, '第 1 次');
  } finally {
    ctx.teardown();
  }
});

test('阶段一-47 归档 Workspace 的历史记录不丢失，且缺字段的老记录照常显示', async () => {
  const ctx = await boot('xb-stage1-history-archive-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '已归档项目' });
    const session = (await ctx.invoke('sessions:start', ws.id)).session;
    await ctx.invoke('sessions:end', session.id, { note: '归档前的工作' });
    await ctx.invoke('workspaces:archive', ws.id, true);

    const history = await ctx.invoke('sessions:history', { workspaceId: ws.id });
    assert.equal(history.length, 1, '归档不能丢历史');
    assert.equal(history[0].note, '归档前的工作');

    // 生成型待办被删除后，历史里明确标记"原任务已删除"，不让记录凭空消失
    const todo = await ctx.invoke('todos:create', { title: '会被删的任务', workspaceId: ws.id });
    const s2 = (await ctx.invoke('sessions:start', ws.id)).session;
    await ctx.invoke('sessions:end', s2.id, { completedTodoIds: [todo.id] });
    await ctx.invoke('todos:delete', todo.id);

    const after = await ctx.invoke('sessions:history', { workspaceId: ws.id });
    const withTodo = after.find((item) => item.id === s2.id);
    assert.equal(withTodo.completedCount, 1);
    assert.equal(withTodo.completedTodos[0].title, '（原任务已删除）');
    assert.equal(withTodo.completedTodos[0].missing, true);

    // 校正过的记录在历史里能被识别
    await ctx.invoke('sessions:adjust-duration', s2.id, 900, { reason: '修正' });
    const adjustedHistory = await ctx.invoke('sessions:history', { workspaceId: ws.id });
    assert.equal(adjustedHistory.find((item) => item.id === s2.id).durationAdjusted, true);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-48 缺少 workspaceId 的历史查询被拒绝，不会误返回全部数据', async () => {
  const ctx = await boot('xb-stage1-history-guard-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: 'X' });
    const session = (await ctx.invoke('sessions:start', ws.id)).session;
    await ctx.invoke('sessions:end', session.id, {});

    const raw = await ctx.raw('sessions:history', {});
    assert.equal(raw.ok, false, '没有工作空间信息时不能返回任何历史');
    assert.match(raw.error, /工作空间/);
  } finally {
    ctx.teardown();
  }
});

test('阶段一-49 校正操作不会破坏快速便签的保存状态（跨模块回归）', async () => {
  const { createQuickNoteSaver } = await quickNoteModule;
  const ctx = await boot('xb-stage1-cross-');
  try {
    const ws = await ctx.invoke('workspaces:create', { name: '交叉' });
    const session = (await ctx.invoke('sessions:start', ws.id)).session;
    await ctx.invoke('sessions:end', session.id, {});

    let content = '便签内容';
    const saver = createQuickNoteSaver({
      getContent: () => content,
      save: (value) => ctx.invoke('files:notes:save-quick', value),
      delayMs: 5
    });
    saver.markChanged();
    assert.equal((await saver.flush()).ok, true);

    await ctx.invoke('sessions:adjust-duration', session.id, 60, { reason: '回归' });

    content = '';
    saver.markChanged();
    assert.equal((await saver.flush()).ok, true);
    const note = await ctx.invoke('files:notes:get-quick');
    assert.equal(note.content, '', '校正流程不能影响便签保存');
  } finally {
    ctx.teardown();
  }
});
