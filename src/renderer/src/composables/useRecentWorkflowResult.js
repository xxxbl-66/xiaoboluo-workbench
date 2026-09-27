import { ref, shallowRef } from 'vue';

// App 的页面切换会卸载 WorkspaceView；结果属于当前 Workspace 的内存上下文。
const workspaceId = ref(null);
const recentResult = shallowRef(null);
const visible = ref(false);
let generation = 0;
let workspaceGeneration = 0;

function invalidateResult() {
  generation++;
  recentResult.value = null;
  visible.value = false;
}

function enterWorkspace(id) {
  if (!id || workspaceId.value === id) return;
  workspaceId.value = id;
  workspaceGeneration++;
  invalidateResult();
}

function captureWorkspace(id) {
  // 恢复流程会先读取列表、建立 Session；期间切 B 再回 A 也属于新的上下文。
  return workspaceId.value === id ? { workspaceId: id, workspaceGeneration } : null;
}

function beginRun(id, context = captureWorkspace(id)) {
  if (!context || workspaceId.value !== id || context.workspaceId !== id
    || context.workspaceGeneration !== workspaceGeneration) return null;
  invalidateResult();
  return { workspaceId: id, generation };
}

function setResult(attempt, feedback) {
  if (!attempt || attempt.workspaceId !== workspaceId.value || attempt.generation !== generation) return false;
  recentResult.value = feedback;
  visible.value = true;
  return true;
}

function showResult() {
  if (recentResult.value) visible.value = true;
}

function hideResult() {
  visible.value = false;
}

export function useRecentWorkflowResult() {
  return { workspaceId, recentResult, visible, enterWorkspace, captureWorkspace, beginRun, setResult, showResult, hideResult };
}
