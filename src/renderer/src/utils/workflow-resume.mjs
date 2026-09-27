export function createWorkflowListLoader(fetchWorkflows, onLoaded) {
  let state = 'loading';
  let items = [];
  let pending = null;

  return {
    get state() { return state; },
    get items() { return items; },
    load() {
      if (state === 'loaded') return Promise.resolve(items);
      if (pending) return pending;
      state = 'loading';
      pending = Promise.resolve().then(fetchWorkflows).then((list) => {
        if (!Array.isArray(list)) throw new Error('工作流列表数据无效');
        items = list;
        state = 'loaded';
        onLoaded?.(list);
        return list;
      }).catch((error) => {
        state = 'error';
        throw error;
      }).finally(() => { pending = null; });
      return pending;
    }
  };
}

/** 有默认工作流时先确认列表可用，再建立 Session；执行失败只改变本次反馈。 */
export async function resumeWorkspaceWorkflow({ workspace, workflows = [], loadWorkflows, isCurrent, startSession, onStarted, runDetailed, onBeforeWorkflow, onAfterWorkflow }) {
  const resumeId = workspace.resumeWorkflowId;
  const availableWorkflows = resumeId && loadWorkflows ? await loadWorkflows() : workflows;
  const boundIds = Array.isArray(workspace.workflowIds) ? workspace.workflowIds : [];
  const workflow = resumeId ? availableWorkflows.find((item) => item.id === resumeId) : null;
  if (isCurrent && !isCurrent()) {
    return { cancelled: true, started: false, notice: '', feedback: null };
  }
  if (resumeId && (!boundIds.includes(resumeId) || !workflow)) {
    return { started: false, notice: '默认工作流已失效，请编辑工作空间重新选择。', feedback: null };
  }
  const started = await startSession(workspace.id);
  if (started?.started === false) {
    return { started: false, notice: '已有正在进行的工作，请先结束或返回那一项。', feedback: null };
  }
  if (!started?.session?.id) throw new Error('无法确认工作会话已创建');
  if (resumeId) onBeforeWorkflow?.(started.session);
  try {
    try { await onStarted?.(); } catch (_) { /* 刷新摘要失败不回滚 Session */ }
    if (!resumeId) {
      return { started: true, notice: '工作已开始，正在计时；未设置默认工作流，不会自动打开工作环境。', feedback: null };
    }
    try {
      const result = await runDetailed(resumeId);
      return { started: true, notice: '工作已开始，正在计时。', feedback: { name: workflow.name, result, error: '' } };
    } catch (error) {
      return {
        started: true,
        notice: '工作已开始，正在计时；默认工作流执行失败。',
        feedback: { name: workflow.name, result: null, error: error?.message || '执行失败' }
      };
    }
  } finally {
    if (resumeId) onAfterWorkflow?.(started.session);
  }
}
