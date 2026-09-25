/** Session 一经建立便独立存在；工作流执行失败只改变本次反馈。 */
export async function resumeWorkspaceWorkflow({ workspace, workflows, startSession, onStarted, runDetailed }) {
  const started = await startSession(workspace.id);
  if (started?.started === false) {
    return { started: false, notice: '已有正在进行的工作，请先结束或返回那一项。', feedback: null };
  }
  if (!started?.session?.id) throw new Error('无法确认工作会话已创建');
  try { await onStarted?.(); } catch (_) { /* 刷新摘要失败不回滚 Session */ }

  const resumeId = workspace.resumeWorkflowId;
  if (!resumeId) {
    return { started: true, notice: '工作已开始，正在计时；未设置默认工作流，不会自动打开工作环境。', feedback: null };
  }
  const boundIds = Array.isArray(workspace.workflowIds) ? workspace.workflowIds : [];
  const workflow = workflows.find((item) => item.id === resumeId);
  if (!boundIds.includes(resumeId) || !workflow) {
    return { started: true, notice: '工作已开始，正在计时；默认工作流已失效，请编辑工作空间重新选择。', feedback: null };
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
}
