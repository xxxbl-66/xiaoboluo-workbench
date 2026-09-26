export function workflowStepSummary(workflow) {
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  if (!steps.length) return '没有步骤';
  const labels = { app: '应用', file: '文件', url: '网页' };
  const counts = {};
  for (const step of steps) {
    const type = step && typeof step === 'object' && !Array.isArray(step) ? step.type : null;
    const key = labels[type] || (typeof type === 'string' && type ? type : '无效步骤');
    counts[key] = (counts[key] || 0) + 1;
  }
  return `${steps.length} 个步骤 · ${Object.entries(counts).map(([key, value]) => `${key}×${value}`).join('、')}`;
}
