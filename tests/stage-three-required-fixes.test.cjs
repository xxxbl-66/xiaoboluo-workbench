const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./helpers/electron-harness.cjs');

function sessionsFile(ctx) {
  return path.join(ctx.dataDir, 'data', 'work-sessions.json');
}

function readSessions(ctx) {
  return JSON.parse(fs.readFileSync(sessionsFile(ctx), 'utf8'));
}

test('S3-P1-01 update cannot move a Session or carry A snapshots into B', async () => {
  const ctx = await boot('xb-required-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const b = await ctx.invoke('workspaces:create', { name: 'B' });
    const own = await ctx.invoke('todos:create', { title: 'A 的任务', workspaceId: a.id });
    const foreign = await ctx.invoke('todos:create', { title: 'B 的任务', workspaceId: b.id });
    const started = await ctx.invoke('sessions:start', a.id);
    const ended = await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [own.id] });
    const before = fs.readFileSync(sessionsFile(ctx), 'utf8');

    for (const patch of [
      { workspaceId: b.id },
      { workspaceId: b.id, completedTodoIds: [own.id] },
      { workspaceId: b.id, completedTodoIds: [foreign.id] },
      { completedTodoIds: [foreign.id], note: '不得部分写入' }
    ]) {
      await assert.rejects(ctx.invoke('sessions:update', ended.id, patch), /工作空间|不属于/);
      assert.equal(fs.readFileSync(sessionsFile(ctx), 'utf8'), before);
    }
    assert.equal(readSessions(ctx)[0].workspaceId, a.id);
    assert.deepEqual(readSessions(ctx)[0].completedTodoSnapshots, [{ id: own.id, title: 'A 的任务' }]);
    assert.equal((await ctx.invoke('sessions:history', { workspaceId: b.id })).length, 0);
  } finally { ctx.teardown(); }
});

test('S3-P1-01 updating completed IDs rebuilds real titles; text edits and duration retain snapshots', async () => {
  const ctx = await boot('xb-required-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const first = await ctx.invoke('todos:create', { title: '原题', workspaceId: a.id });
    const second = await ctx.invoke('todos:create', { title: '新题', workspaceId: a.id });
    const started = await ctx.invoke('sessions:start', a.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [first.id] });
    await ctx.invoke('todos:update', first.id, { title: '现题' });

    const changed = await ctx.invoke('sessions:update', started.session.id, {
      completedTodoIds: [first.id, second.id],
      completedTodoSnapshots: [{ id: first.id, title: '伪造历史' }]
    });
    const expected = [{ id: first.id, title: '现题' }, { id: second.id, title: '新题' }];
    assert.deepEqual(changed.completedTodoSnapshots, expected);
    assert.deepEqual(readSessions(ctx)[0].completedTodoSnapshots, expected);
    await ctx.invoke('todos:delete', second.id);
    const beforeMissingTodo = fs.readFileSync(sessionsFile(ctx), 'utf8');
    await assert.rejects(ctx.invoke('sessions:update', started.session.id, {
      completedTodoIds: [first.id, second.id], note: '不应写入'
    }), /待办不存在/);
    assert.equal(fs.readFileSync(sessionsFile(ctx), 'utf8'), beforeMissingTodo);
    await ctx.invoke('sessions:update', started.session.id, { note: '备注' });
    await ctx.invoke('sessions:update', started.session.id, { nextStep: '下一步' });
    await ctx.invoke('sessions:update', started.session.id, {
      completedTodoSnapshots: [{ id: first.id, title: '再次伪造' }]
    });
    await ctx.invoke('sessions:adjust-duration', started.session.id, 65, { reason: '校正' });
    assert.deepEqual(readSessions(ctx)[0].completedTodoSnapshots, expected);
  } finally { ctx.teardown(); }
});

test('S3-P1-01 old Session accepts text edits and builds snapshot only when completed IDs change', async () => {
  const ctx = await boot('xb-required-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const todo = await ctx.invoke('todos:create', { title: '真实任务', workspaceId: a.id });
    const started = await ctx.invoke('sessions:start', a.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [] });
    const rows = readSessions(ctx);
    delete rows[0].completedTodoSnapshots;
    fs.writeFileSync(sessionsFile(ctx), JSON.stringify(rows));
    const noted = await ctx.invoke('sessions:update', started.session.id, { note: '旧记录备注' });
    assert.equal(noted.completedTodoSnapshots, undefined);
    assert.equal((await ctx.invoke('sessions:update', started.session.id, { nextStep: '继续' })).completedTodoSnapshots, undefined);
    const updated = await ctx.invoke('sessions:update', started.session.id, { completedTodoIds: [todo.id] });
    assert.deepEqual(updated.completedTodoSnapshots, [{ id: todo.id, title: '真实任务' }]);
  } finally { ctx.teardown(); }
});

test('S3-P1-02 archive IPC rejects own active Session and preserves Workspace and Session', async () => {
  const ctx = await boot('xb-required-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const started = await ctx.invoke('sessions:start', a.id);
    const before = fs.readFileSync(path.join(ctx.dataDir, 'data', 'workspaces.json'), 'utf8');
    const error = '当前工作空间还有正在进行的工作，请先结束工作后再归档';
    await assert.rejects(ctx.invoke('workspaces:archive', a.id, true), new RegExp(error));
    await assert.rejects(ctx.invoke('workspaces:update', a.id, { archived: true }), new RegExp(error));
    assert.equal(fs.readFileSync(path.join(ctx.dataDir, 'data', 'workspaces.json'), 'utf8'), before);
    assert.equal((await ctx.invoke('workspaces:get', a.id)).archived, false);
    assert.equal((await ctx.invoke('sessions:get-active')).id, started.session.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [] });
    await ctx.invoke('workspaces:archive', a.id, true);
    assert.equal((await ctx.invoke('sessions:history', { workspaceId: a.id })).length, 1);
    await assert.rejects(ctx.invoke('sessions:start', a.id), /已归档/);
    await ctx.invoke('workspaces:archive', a.id, false);
    assert.equal((await ctx.invoke('sessions:start', a.id)).started, true);
  } finally { ctx.teardown(); }
});

test('S3-P1-02 archive permits no active or another Workspace active; old archived active remains endable', async () => {
  const ctx = await boot('xb-required-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const b = await ctx.invoke('workspaces:create', { name: 'B' });
    await ctx.invoke('workspaces:archive', a.id, true);
    await ctx.invoke('workspaces:archive', a.id, false);
    const started = await ctx.invoke('sessions:start', b.id);
    await ctx.invoke('workspaces:archive', a.id, true);
    assert.equal((await ctx.invoke('sessions:get-active')).id, started.session.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [] });

    // Simulate a record written by an older version: archive plus unfinished Session.
    const rows = readSessions(ctx);
    rows[0].endedAt = null;
    rows[0].workspaceId = a.id;
    fs.writeFileSync(sessionsFile(ctx), JSON.stringify(rows));
    assert.equal((await ctx.invoke('sessions:get-active')).workspaceId, a.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [] });
    assert.equal(await ctx.invoke('sessions:get-active'), null);
    assert.equal((await ctx.invoke('workspaces:get', a.id)).archived, true);
  } finally { ctx.teardown(); }
});
