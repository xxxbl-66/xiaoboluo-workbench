/**
 * 长期目标面板的纯逻辑（渲染层与测试共用的单一事实来源）。
 *
 * 背景（审查报告 P1-04）：
 * GoalPanel 的 `goals` 是只读 computed（= allGoals 的过滤结果），
 * 删除成功后却对它执行 `goals.value = await workbench.goals.remove(id)`。
 * 结果：
 * 1. 数据层已经删除，界面仍然显示旧目标；
 * 2. 向只读 computed 赋值会触发 Vue 警告，赋值本身也不会生效。
 *
 * 正确做法是刷新真正的状态源（allGoals），并且只在主进程确认删除后才更新界面。
 * 这里把"调用删除 → 重新拉取列表"的顺序固定下来，组件不得绕过。
 */

/**
 * 删除一个长期目标并刷新列表。
 *
 * @param {string} goalId
 * @param {{
 *   remove: (goalId:string) => Promise<any>,
 *   list: () => Promise<Array<object>>
 * }} api
 * @returns {Promise<{ok:boolean, error:string, goals:Array<object>|null}>}
 *   ok=false 时 goals 为 null，调用方必须保持界面原样并提示失败。
 */
export async function removeGoalAndReload(goalId, api) {
  try {
    await api.remove(goalId);
  } catch (error) {
    return {
      ok: false,
      error: (error && error.message) || '目标删除失败',
      goals: null
    };
  }
  try {
    const goals = await api.list();
    return { ok: true, error: '', goals: Array.isArray(goals) ? goals : [] };
  } catch (error) {
    // 数据已经删除成功，只是列表没能刷新：返回 ok=true，但要告诉调用方需要重载
    return {
      ok: true,
      error: '',
      goals: null,
      reloadFailed: (error && error.message) || '列表刷新失败'
    };
  }
}
