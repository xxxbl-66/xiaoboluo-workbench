import { computed, ref } from 'vue';
import { useRecentWorkflowResult } from './useRecentWorkflowResult.js';

/**
 * Workspace 的模块级轻量状态。
 *
 * App.vue 用 <component :is> 切换页面，切换时会真正卸载旧组件，
 * 所以"当前选中的工作空间"必须放在模块级 ref 里，不能放在组件内部。
 * 这里不引入 Pinia，保持与项目既有风格一致。
 */

const activeWorkspaceId = ref(null);
const pendingAction = ref(null);
/** 最近一次 workspaces:list 的结果，供驾驶舱等页面共享，避免重复 IPC */
const workspaceList = ref([]);
const { enterWorkspace } = useRecentWorkflowResult();

const activeWorkspace = computed(() => (
  workspaceList.value.find((item) => item.id === activeWorkspaceId.value) || null
));

function selectWorkspace(id) {
  activeWorkspaceId.value = id ? String(id) : null;
  enterWorkspace(activeWorkspaceId.value);
  if (pendingAction.value?.workspaceId !== activeWorkspaceId.value) pendingAction.value = null;
}

function clearWorkspace() {
  activeWorkspaceId.value = null;
  pendingAction.value = null;
}

function requestWorkspaceAction(workspaceId, action) {
  const id = workspaceId ? String(workspaceId) : null;
  if (!id || !['resume', 'end'].includes(action)) return;
  selectWorkspace(id);
  pendingAction.value = { workspaceId: id, action };
}

function takeWorkspaceAction(workspaceId) {
  if (pendingAction.value?.workspaceId !== workspaceId) return null;
  const action = pendingAction.value.action;
  pendingAction.value = null;
  return action;
}

function setWorkspaceList(list) {
  workspaceList.value = Array.isArray(list) ? list : [];
}

/** 选中的工作空间被归档或删除后，自动清空选择 */
function ensureSelectionValid() {
  if (!activeWorkspaceId.value) return;
  if (workspaceList.value.some((item) => item.id === activeWorkspaceId.value)) return;
  clearWorkspace();
}

export function useWorkspace() {
  return {
    activeWorkspaceId,
    activeWorkspace,
    workspaceList,
    selectWorkspace,
    clearWorkspace,
    requestWorkspaceAction,
    takeWorkspaceAction,
    setWorkspaceList,
    ensureSelectionValid
  };
}
