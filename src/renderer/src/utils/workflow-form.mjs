export function validateWorkflowForm(form) {
  const name = typeof form?.name === 'string' ? form.name.trim() : '';
  const steps = Array.isArray(form?.steps) ? form.steps : [];
  const nameError = !name ? '请输入工作流名称' : name.length > 80 ? '工作流名称不能超过 80 个字' : '';
  const stepErrors = {};
  const payloadSteps = steps.map((step, index) => {
    const type = step?.type;
    const number = index + 1;
    const value = {
      id: step?.id || '',
      type,
      appId: typeof step?.appId === 'string' ? step.appId.trim() : '',
      path: typeof step?.path === 'string' ? step.path.trim() : '',
      url: typeof step?.url === 'string' ? step.url.trim() : ''
    };
    if (type === 'app' && !value.appId) stepErrors[index] = `第 ${number} 步尚未选择应用。`;
    else if (type === 'file' && !value.path) stepErrors[index] = `第 ${number} 步尚未选择文件或文件夹。`;
    else if (type === 'url') {
      if (!value.url) stepErrors[index] = `第 ${number} 步的网址不能为空。`;
      else {
        try {
          const parsed = new URL(value.url);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
        } catch (_) {
          stepErrors[index] = `第 ${number} 步只支持有效的 http:// 或 https:// 网址。`;
        }
      }
    } else if (!['app', 'file'].includes(type)) {
      stepErrors[index] = `第 ${number} 步的类型不受支持，请选择应用、文件或网页。`;
    }
    return value;
  });
  const formError = steps.length ? '' : '至少添加一个步骤';
  return {
    valid: !nameError && !formError && !Object.keys(stepErrors).length,
    nameError,
    formError,
    stepErrors,
    payload: { name, steps: payloadSteps }
  };
}

export async function chooseWorkflowPath(step, picker, isCurrent) {
  const selected = await picker();
  if (!selected || !isCurrent()) return false;
  step.path = selected;
  return true;
}
