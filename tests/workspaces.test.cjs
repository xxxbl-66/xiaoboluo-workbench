const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DataStore } = require('../electron/store.cjs');
const workspaceService = require('../electron/services/workspaces.cjs');
const sessionService = require('../electron/services/sessions.cjs');
const overviewService = require('../electron/services/overview.cjs');
const { localDateKey, dateKeyToDate } = require('../electron/dates.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-ws-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function withStore(fn) {
  const dir = tempDir();
  try {
    return fn(new DataStore(dir), dir);
  } finally {
    cleanup(dir);
  }
}

test('本地日期键不会因为 UTC 而错一天', () => {
  // 本地 00:30 —— 若用 toISOString().slice(0,10)，在 UTC+8 下会得到前一天
  const earlyMorning = new Date(2026, 0, 2, 0, 30, 0);
  assert.equal(localDateKey(earlyMorning), '2026-01-02');

  const lateNight = new Date(2026, 0, 2, 23, 45, 0);
  assert.equal(localDateKey(lateNight), '2026-01-02');

  assert.equal(localDateKey(dateKeyToDate('2026-03-01')), '2026-03-01');
  assert.equal(localDateKey('2026-12-31T16:30:00.000Z'), localDateKey(new Date('2026-12-31T16:30:00.000Z')));
});

test('创建 Workspace：补齐默认字段且 id 为 UUID', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: '  程序设计大赛  ' });
    assert.equal(ws.name, '程序设计大赛');
    assert.match(ws.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(ws.archived, false);
    assert.equal(ws.resumeWorkflowId, null);
    assert.deepEqual(ws.workflowIds, []);
    assert.equal(ws.lastOpenedAt, null);
    assert.equal(ws.createdAt, ws.updatedAt);
  });
});

test('创建 Workspace：空名称被拒绝', () => {
  withStore((store) => {
    assert.throws(() => workspaceService.createWorkspace(store, { name: '   ' }), /名称/);
  });
});

test('resumeWorkflowId 必须属于 workflowIds，否则被置空', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, {
      name: 'A',
      workflowIds: ['w1', 'w2'],
      resumeWorkflowId: 'w3'
    });
    assert.equal(ws.resumeWorkflowId, null);

    const fixed = workspaceService.updateWorkspace(store, ws.id, { resumeWorkflowId: 'w2' });
    assert.equal(fixed.resumeWorkflowId, 'w2');

    const unbound = workspaceService.updateWorkspace(store, ws.id, { workflowIds: ['w1'] });
    assert.equal(unbound.resumeWorkflowId, null, '工作流被解绑后默认工作流必须一起失效');
  });
});

test('update 禁止修改 id / createdAt', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A' });
    const updated = workspaceService.updateWorkspace(store, ws.id, {
      id: 'hacked',
      createdAt: '1999-01-01T00:00:00.000Z',
      name: 'B'
    });
    assert.equal(updated.id, ws.id);
    assert.equal(updated.createdAt, ws.createdAt);
    assert.equal(updated.name, 'B');
  });
});

test('归档：默认列表不显示，includeArchived 能查到，数据仍保留', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A' });
    workspaceService.archiveWorkspace(store, ws.id);

    assert.equal(workspaceService.listWorkspaces(store).length, 0);
    const all = workspaceService.listWorkspaces(store, { includeArchived: true });
    assert.equal(all.length, 1);
    assert.equal(all[0].archived, true);

    workspaceService.archiveWorkspace(store, ws.id, false);
    assert.equal(workspaceService.listWorkspaces(store).length, 1);
  });
});

test('touch 更新 lastOpenedAt，其余字段不变', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A', description: 'd' });
    const touched = workspaceService.touchWorkspace(store, ws.id);
    assert.ok(touched.lastOpenedAt);
    assert.equal(touched.name, 'A');
    assert.equal(touched.description, 'd');
    assert.equal(touched.createdAt, ws.createdAt);
  });
});

test('reorder 按给定顺序写入 sort', () => {
  withStore((store) => {
    const a = workspaceService.createWorkspace(store, { name: 'A' });
    const b = workspaceService.createWorkspace(store, { name: 'B' });
    const c = workspaceService.createWorkspace(store, { name: 'C' });

    const ordered = workspaceService.reorderWorkspaces(store, [c.id, a.id, b.id]);
    assert.deepEqual(ordered.map((item) => item.name), ['C', 'A', 'B']);
  });
});

test('会话：同一时间只允许一个 active session', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A' });
    const first = sessionService.startSession(store, ws.id);
    assert.equal(first.started, true);
    assert.equal(first.session.endedAt, null);

    const second = sessionService.startSession(store, ws.id);
    assert.equal(second.started, false);
    assert.equal(second.reason, 'active-exists');
    assert.equal(second.session.id, first.session.id);

    assert.equal(sessionService.readSessions(store).length, 1, '不能静默创建第二条');
  });
});

test('结束会话：durationSeconds 由 startedAt 与当前时间真实计算', () => {
  withStore((store) => {
    const started = sessionService.startSession(store, null);
    const items = sessionService.readSessions(store);
    items[0].startedAt = new Date(Date.now() - 90 * 1000).toISOString();
    sessionService.writeSessions(store, items);

    const ended = sessionService.endSession(store, started.session.id, {
      note: '登录接口基本完成',
      nextStep: '完成 Token 刷新与权限测试',
      completedTodoIds: ['t1', 't1', 't2']
    });

    assert.ok(ended.endedAt);
    assert.ok(ended.durationSeconds >= 89 && ended.durationSeconds <= 95, `实际 ${ended.durationSeconds}`);
    assert.equal(ended.note, '登录接口基本完成');
    assert.equal(ended.nextStep, '完成 Token 刷新与权限测试');
    assert.deepEqual(ended.completedTodoIds, ['t1', 't2'], '应去重');
    assert.equal(sessionService.getActiveSession(store), null);
  });
});

test('会话：durationSeconds 不受前端计时器影响，即使写入 0 也会被覆盖', () => {
  withStore((store) => {
    const { session } = sessionService.startSession(store, null);
    const items = sessionService.readSessions(store);
    items[0].startedAt = new Date(Date.now() - 3600 * 1000).toISOString();
    items[0].durationSeconds = 0;
    sessionService.writeSessions(store, items);

    const ended = sessionService.endSession(store, session.id, {});
    assert.ok(ended.durationSeconds >= 3595, `应接近 3600，实际 ${ended.durationSeconds}`);
  });
});

test('会话：endedAt 为 undefined 的旧记录也视为进行中', () => {
  withStore((store) => {
    store.write('work-sessions.json', [{ id: 'old', startedAt: new Date().toISOString(), workspaceId: null }]);
    assert.ok(sessionService.getActiveSession(store));
    const result = sessionService.startSession(store, null);
    assert.equal(result.started, false);
  });
});

test('会话 list 支持 workspaceId / dateKey / limit 过滤', () => {
  withStore((store) => {
    const wsA = workspaceService.createWorkspace(store, { name: 'A' });
    const wsB = workspaceService.createWorkspace(store, { name: 'B' });
    store.write('work-sessions.json', [
      { id: 's1', workspaceId: wsA.id, dateKey: '2026-01-01', startedAt: '2026-01-01T01:00:00.000Z', endedAt: '2026-01-01T02:00:00.000Z', durationSeconds: 3600 },
      { id: 's2', workspaceId: wsB.id, dateKey: '2026-01-02', startedAt: '2026-01-02T01:00:00.000Z', endedAt: '2026-01-02T02:00:00.000Z', durationSeconds: 3600 },
      { id: 's3', workspaceId: wsA.id, dateKey: '2026-01-03', startedAt: '2026-01-03T01:00:00.000Z', endedAt: '2026-01-03T02:00:00.000Z', durationSeconds: 1800 },
      { id: 's4', workspaceId: null, dateKey: '2026-01-04', startedAt: '2026-01-04T01:00:00.000Z', endedAt: '2026-01-04T02:00:00.000Z', durationSeconds: 600 }
    ]);

    assert.deepEqual(sessionService.listSessions(store, { workspaceId: wsA.id }).map((s) => s.id), ['s3', 's1']);
    assert.deepEqual(sessionService.listSessions(store, { workspaceId: null }).map((s) => s.id), ['s4']);
    assert.deepEqual(sessionService.listSessions(store, { dateKey: '2026-01-02' }).map((s) => s.id), ['s2']);
    assert.deepEqual(sessionService.listSessions(store, { limit: 1 }).map((s) => s.id), ['s4']);
    assert.equal(sessionService.listSessions(store).length, 4);
  });
});

test('会话汇总：按日期统计总时长、去重完成数、按 Workspace 分组', () => {
  withStore((store) => {
    const wsA = workspaceService.createWorkspace(store, { name: '程序设计大赛' });
    const wsB = workspaceService.createWorkspace(store, { name: 'Java 学习' });
    const today = localDateKey(new Date());
    store.write('work-sessions.json', [
      { id: 's1', workspaceId: wsA.id, dateKey: today, startedAt: `${today}T01:00:00.000Z`, endedAt: `${today}T03:13:00.000Z`, durationSeconds: 7980, completedTodoIds: ['t1', 't2'] },
      { id: 's2', workspaceId: wsB.id, dateKey: today, startedAt: `${today}T04:00:00.000Z`, endedAt: `${today}T05:08:00.000Z`, durationSeconds: 4080, completedTodoIds: ['t2'] },
      { id: 's3', workspaceId: wsA.id, dateKey: '2000-01-01', startedAt: '2000-01-01T01:00:00.000Z', endedAt: '2000-01-01T02:00:00.000Z', durationSeconds: 3600, completedTodoIds: ['t9'] }
    ]);

    const summary = sessionService.summarizeSessions(store, { dateKey: today });
    assert.equal(summary.totalSeconds, 7980 + 4080);
    assert.equal(summary.sessionCount, 2);
    assert.equal(summary.completedTodoCount, 2, 't2 重复出现应只算一次');
    assert.deepEqual(summary.completedTodoIds.sort(), ['t1', 't2']);
    const byA = summary.byWorkspace.find((item) => item.workspaceId === wsA.id);
    assert.equal(byA.seconds, 7980);
    assert.equal(byA.sessionCount, 1);
  });
});

test('会话汇总：进行中的会话不计入时长', () => {
  withStore((store) => {
    const today = localDateKey(new Date());
    store.write('work-sessions.json', [
      { id: 's1', workspaceId: null, dateKey: today, startedAt: `${today}T01:00:00.000Z`, endedAt: null, durationSeconds: 0 }
    ]);
    const summary = sessionService.summarizeSessions(store, { dateKey: today });
    assert.equal(summary.totalSeconds, 0);
    assert.equal(summary.activeSessionCount, 1);
  });
});

test('lastFinishedSession 只返回该 Workspace 最近一条已结束的会话', () => {
  withStore((store) => {
    const wsA = workspaceService.createWorkspace(store, { name: 'A' });
    const wsB = workspaceService.createWorkspace(store, { name: 'B' });
    store.write('work-sessions.json', [
      { id: 'new', workspaceId: wsA.id, startedAt: '2026-02-01T01:00:00.000Z', endedAt: '2026-02-01T02:00:00.000Z', durationSeconds: 3600 },
      { id: 'old', workspaceId: wsA.id, startedAt: '2026-01-01T01:00:00.000Z', endedAt: '2026-01-01T02:00:00.000Z', durationSeconds: 600 },
      { id: 'running', workspaceId: wsA.id, startedAt: '2026-03-01T01:00:00.000Z', endedAt: null, durationSeconds: 0 },
      { id: 'other', workspaceId: wsB.id, startedAt: '2026-04-01T01:00:00.000Z', endedAt: '2026-04-01T02:00:00.000Z', durationSeconds: 60 }
    ]);

    assert.equal(sessionService.lastFinishedSession(store, wsA.id).id, 'new');
    assert.equal(sessionService.lastFinishedSession(store, wsB.id).id, 'other');
  });
});

test('Workspace 概览：统计运行时计算且不会写回 workspaces.json', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A' });
    const rawBefore = fs.readFileSync(store.filePath('workspaces.json'), 'utf8');

    const todos = [
      { id: 't1', workspaceId: ws.id, completed: false },
      { id: 't2', workspaceId: ws.id, completed: true },
      { id: 't3', workspaceId: null, completed: false }
    ];
    sessionService.writeSessions(store, [
      { id: 's1', workspaceId: ws.id, startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:10:00.000Z', durationSeconds: 600, dateKey: '2026-01-01' },
      { id: 's2', workspaceId: ws.id, startedAt: '2026-01-02T00:00:00.000Z', endedAt: '2026-01-02T00:20:00.000Z', durationSeconds: 1200, dateKey: '2026-01-02' }
    ]);

    const overview = overviewService.listWorkspaceOverview(store, todos);
    assert.equal(overview.length, 1);
    assert.equal(overview[0].pendingTodoCount, 1);
    assert.equal(overview[0].todoCount, 2);
    assert.equal(overview[0].totalSeconds, 1800);
    assert.equal(overview[0].lastSession.id, 's2');
    assert.equal(overview[0].lastWorkedAt, '2026-01-02T00:20:00.000Z');

    const raw = JSON.parse(fs.readFileSync(store.filePath('workspaces.json'), 'utf8'));
    assert.equal(raw.length, 1);
    for (const key of ['pendingTodoCount', 'todoCount', 'totalSeconds', 'lastSession', 'progress']) {
      assert.equal(key in raw[0], false, `workspaces.json 不应出现冗余字段 ${key}`);
    }
    assert.equal(fs.readFileSync(store.filePath('workspaces.json'), 'utf8'), rawBefore);
  });
});

test('未归类数据（workspaceId: null）不会被塞进任何 Workspace', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A' });
    const todos = [
      { id: 'legacy-1', completed: false },
      { id: 'legacy-2', workspaceId: null, completed: false },
      { id: 'mine', workspaceId: ws.id, completed: false }
    ];
    const overview = overviewService.listWorkspaceOverview(store, todos);
    assert.equal(overview[0].todoCount, 1);
    assert.equal(overview[0].pendingTodoCount, 1);
  });
});

test('recentWorkspaces 按 lastOpenedAt 排序', () => {
  withStore((store) => {
    const a = workspaceService.createWorkspace(store, { name: 'A' });
    const b = workspaceService.createWorkspace(store, { name: 'B' });
    const c = workspaceService.createWorkspace(store, { name: 'C' });
    workspaceService.touchWorkspace(store, a.id);
    workspaceService.updateWorkspace(store, b.id, { lastOpenedAt: '2099-01-01T00:00:00.000Z' });

    const recent = overviewService.recentWorkspaces(store, [], 2);
    assert.deepEqual(recent.map((item) => item.name), ['B', 'A']);
    assert.ok(!recent.some((item) => item.id === c.id));
  });
});

test('物理删除：默认被拒绝，必须显式确认', () => {
  withStore((store) => {
    const ws = workspaceService.createWorkspace(store, { name: 'A' });
    workspaceService.deleteWorkspace(store, ws.id);
    assert.equal(workspaceService.listWorkspaces(store, { includeArchived: true }).length, 0);
  });
});

test('损坏的 workspaces.json 不会导致崩溃', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    fs.writeFileSync(store.filePath('workspaces.json'), '<<<broken>>>', 'utf8');
    assert.doesNotThrow(() => workspaceService.listWorkspaces(store));
    assert.deepEqual(workspaceService.listWorkspaces(store), []);
  } finally {
    cleanup(dir);
  }
});
