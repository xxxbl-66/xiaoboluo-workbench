<template>
  <div class="view workspace-view">
    <!-- ================= 列表态 ================= -->
    <template v-if="!current">
      <header class="view-header">
        <p class="view-kicker">WORKSPACE / SPACES</p>
        <h1>工作空间</h1>
        <p>把任务、文件、便签、应用和工作流集中在一个项目里，随时接着上次继续。</p>
      </header>

      <div class="ws-toolbar">
        <button class="primary" type="button" @click="openCreate">＋ 创建工作空间</button>
        <label class="ws-toolbar__toggle">
          <input v-model="showArchived" type="checkbox" />
          <span>查看已归档</span>
        </label>
      </div>

      <div v-if="loading" class="empty-state">正在加载工作空间…</div>

      <div v-else-if="!workspaces.length" class="panel ws-empty">
        <div class="empty-state">
          <div class="empty-icon"><LineIcon name="workspace" :size="34" /></div>
          <h2>还没有工作空间</h2>
          <p>
            工作空间可以把任务、文件、便签、应用和工作流集中在一个项目中。<br />
            开始工作后会自动记录时长，下次打开就能接着上次继续。
          </p>
          <button class="primary" type="button" @click="openCreate">创建工作空间</button>
        </div>
      </div>

      <div v-else class="ws-grid">
        <WorkspaceCard
          v-for="item in workspaces"
          :key="item.id"
          :workspace="item"
          @open="openWorkspace"
          @edit="openEdit"
          @archive="archiveWorkspace"
          @restore="restoreWorkspace"
        />
      </div>
    </template>

    <!-- ================= 详情态 ================= -->
    <template v-else>
      <header class="view-header ws-detail-head">
        <div>
          <button class="ghost small" type="button" @click="backToList">← 全部工作空间</button>
          <p class="view-kicker">WORKSPACE / {{ current.name }}</p>
          <h1>{{ current.name }}</h1>
          <p>{{ current.description || '还没有填写描述' }}</p>
        </div>
        <div class="panel-actions">
          <button class="ghost small" type="button" @click="openEdit(current)">编辑</button>
          <button
            v-if="current.archived !== true"
            class="ghost small"
            type="button"
            @click="archiveWorkspace(current)"
          >
            归档
          </button>
          <button v-else class="ghost small" type="button" @click="restoreWorkspace(current)">恢复</button>
        </div>
      </header>

      <section class="ws-overview panel">
        <div class="ws-overview__stats">
          <div>
            <span>未完成任务</span>
            <strong>{{ current.pendingTodoCount || 0 }}</strong>
          </div>
          <div>
            <span>累计工作时长</span>
            <strong>{{ formatDuration(current.totalSeconds || 0) }}</strong>
            <small class="ws-overview__hint">按工作开始日期统计</small>
          </div>
          <div>
            <span>最近一次工作</span>
            <strong>{{ current.lastWorkedAt ? formatRelative(current.lastWorkedAt) : '还没有记录' }}</strong>
          </div>
        </div>
      </section>

      <WorkSessionPanel v-if="current.archived !== true || (activeSession && activeSession.workspaceId === current.id)"
        :workspace-id="current.id"
        :workspace-name="current.name"
        :active-workspace-name="activeWorkspaceName"
        :busy="starting || resuming"
        @start="startWork"
        @end="openEndModal"
        @go-active="goActiveWorkspace"
      />

      <ResumeWorkCard
        :session="lastSession"
        :busy="resuming || starting"
        :archived="current.archived === true"
        @resume="resumeLastWork"
      />
      <div v-if="resumeWorkspaceId === current.id" class="ws-resume-feedback">
        <p v-if="resumeNotice" role="status">{{ resumeNotice }}</p>
        <WorkflowRunResult v-if="resumeFeedback" :result="resumeFeedback.result" :error="resumeFeedback.error" :workflow-name="resumeFeedback.name" @close="resumeFeedback = null" />
      </div>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>工作历史</h2>
          <p>这个工作空间的历史工作记录、备注与下一步；时长可以人工校正。</p>
        </div>
        <WorkspaceSessionHistory
          :key="current.id"
          ref="sessionHistoryRef"
          :workspace-id="current.id"
          :workspace-name="current.name"
          @adjusted="loadWorkspaces"
        />
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>当前任务</h2>
          <p>这个工作空间内的待办；其他页面的待办不受影响。</p>
        </div>
        <TodoPanel v-if="current.archived !== true" :key="current.id" ref="todoPanelRef" :workspace-id="current.id" @changed="refreshWorkspaceData" />
        <p v-else>已归档；可在相关资源中查看任务。</p>
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>长期目标</h2>
          <p>属于这个工作空间的长期目标，自动生成的待办会继承同样的归属。</p>
        </div>
        <GoalPanel v-if="current.archived !== true" :key="current.id" ref="goalPanelRef" :workspace-id="current.id" @changed="refreshWorkspaceData" />
        <p v-else>已归档；可在相关资源中查看目标。</p>
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>相关资源</h2>
          <p>文件、便签、收藏与快捷应用。关联只改变归属，不会复制内容。</p>
        </div>
        <WorkspaceResources
          :key="current.id"
          ref="resourcesRef"
          :workspace-id="current.id"
          :workspaces="workspaces"
          :archived="current.archived === true"
          @changed="refreshLinkedResources"
        />
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>工作流</h2>
          <p>绑定这个工作空间会用到的工作流；「继续上次工作」最多自动运行一个。</p>
        </div>
        <WorkspaceWorkflows :key="current.id" :workspace="current" :workflows="workflows" :busy="resuming" :archived="current.archived === true" />
      </section>
    </template>

    <WorkspaceFormModal
      v-model="showForm"
      :workspace="editing"
      :workflows="workflows"
      @close="closeForm"
      @saved="saveWorkspace"
    />

    <EndSessionModal
      v-model="showEndModal"
      :session="activeSession"
      :todos="sessionTodos"
      :workspace-name="sessionWorkspaceName"
      :saving="ending"
      @close="showEndModal = false"
      @submit="finishWork"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import LineIcon from '../components/LineIcon.vue';
import TodoPanel from '../components/TodoPanel.vue';
import GoalPanel from '../components/GoalPanel.vue';
import WorkspaceCard from '../components/WorkspaceCard.vue';
import WorkspaceFormModal from '../components/WorkspaceFormModal.vue';
import WorkspaceResources from '../components/WorkspaceResources.vue';
import WorkSessionPanel from '../components/WorkSessionPanel.vue';
import ResumeWorkCard from '../components/ResumeWorkCard.vue';
import WorkspaceWorkflows from '../components/WorkspaceWorkflows.vue';
import WorkflowRunResult from '../components/WorkflowRunResult.vue';
import WorkspaceSessionHistory from '../components/WorkspaceSessionHistory.vue';
import EndSessionModal from '../components/EndSessionModal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { useWorkspace } from '../composables/useWorkspace.js';
import { useWorkSession } from '../composables/useWorkSession.js';
import { toast } from '../composables/toast.js';
import { formatDuration, formatRelative } from '../utils/duration.js';
import { createWorkflowListLoader, resumeWorkspaceWorkflow } from '../utils/workflow-resume.mjs';

defineProps({
  settings: { type: Object, default: () => ({}) }
});

const { activeWorkspaceId, workspaceList, selectWorkspace, clearWorkspace, setWorkspaceList, ensureSelectionValid } = useWorkspace();
const { activeSession, startSession, endSession } = useWorkSession();

const loading = ref(true);
const showArchived = ref(false);
const showForm = ref(false);
const editing = ref(null);
const workflows = ref([]);
const starting = ref(false);
const resuming = ref(false);
const resumeFeedback = ref(null);
const resumeNotice = ref('');
const resumeWorkspaceId = ref(null);
let mounted = true;
let resumeGeneration = 0;
let activeResumeAttempt = null;
function isCurrentResumeAttempt(attempt) {
  return mounted && activeResumeAttempt === attempt && resumeGeneration === attempt.generation
    && activeWorkspaceId.value === attempt.workspaceId;
}
function invalidateResumeAttempt() {
  resumeGeneration++;
  activeResumeAttempt = null;
  resuming.value = false;
}
const workflowLoader = createWorkflowListLoader(
  () => workbench.workflows.list(),
  (list) => { if (mounted) workflows.value = list; }
);
const ending = ref(false);
const showEndModal = ref(false);
const sessionTodos = ref([]);
const lastSession = ref(null);
const sessionHistoryRef = ref(null);
const resourcesRef = ref(null);
const todoPanelRef = ref(null);
const goalPanelRef = ref(null);
let workspaceListGeneration = 0;
let lastSessionGeneration = 0;

async function refreshWorkspaceData() {
  await loadWorkspaces();
  if (resourcesRef.value && typeof resourcesRef.value.refresh === 'function') await resourcesRef.value.refresh();
  await reloadSessionHistory();
}

async function refreshLinkedResources() {
  await loadWorkspaces();
  await Promise.all([
    todoPanelRef.value && todoPanelRef.value.reload ? todoPanelRef.value.reload() : null,
    goalPanelRef.value && goalPanelRef.value.reload ? goalPanelRef.value.reload() : null
  ]);
}

async function reloadSessionHistory() {
  const target = sessionHistoryRef.value;
  if (target && typeof target.reload === 'function') {
    try {
      await target.reload();
    } catch (_) {
      // 历史刷新失败不影响主流程
    }
  }
}

const workspaces = computed(() => workspaceList.value);
const current = computed(() => (
  workspaceList.value.find((item) => item.id === activeWorkspaceId.value) || null
));

const activeWorkspaceName = computed(() => {
  if (!activeSession.value) return '';
  const found = workspaceList.value.find((item) => item.id === activeSession.value.workspaceId);
  return found ? found.name : '另一个工作空间';
});

/** 正在进行的 Session 所属工作空间的名字（结束弹窗里明确告诉用户在结束谁） */
const sessionWorkspaceName = computed(() => {
  if (!activeSession.value) return '';
  const found = workspaceList.value.find((item) => item.id === activeSession.value.workspaceId);
  return found ? found.name : '未归类的工作';
});

async function loadWorkspaces() {
  const generation = ++workspaceListGeneration;
  const includeArchived = showArchived.value;
  try {
    const list = await workbench.workspaces.list({ includeArchived });
    if (!mounted || generation !== workspaceListGeneration || includeArchived !== showArchived.value) return;
    setWorkspaceList(list);
    ensureSelectionValid();
  } catch (error) {
    if (mounted && generation === workspaceListGeneration) { toast(error.message, 'error'); setWorkspaceList([]); }
  } finally {
    if (mounted && generation === workspaceListGeneration) loading.value = false;
  }
  if (mounted && generation === workspaceListGeneration) await loadLastSession();
}

function loadWorkflows() {
  return workflowLoader.load();
}

function openCreate() {
  editing.value = null;
  showForm.value = true;
}

function openEdit(workspace) {
  editing.value = workspace;
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editing.value = null;
}

async function saveWorkspace({ id, payload }) {
  try {
    if (id) {
      await workbench.workspaces.update(id, payload);
      toast('工作空间已更新');
    } else {
      const created = await workbench.workspaces.create(payload);
      toast('工作空间已创建');
      selectWorkspace(created.id);
    }
    closeForm();
    await loadWorkspaces();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openWorkspace(workspace) {
  selectWorkspace(workspace.id);
  try {
    await workbench.workspaces.touch(workspace.id);
  } catch (_) {
    // 更新最近打开时间失败不影响进入
  }
  await loadWorkspaces();
}

function backToList() {
  clearWorkspace();
  loadWorkspaces();
}

async function archiveWorkspace(workspace) {
  try {
    await workbench.workspaces.archive(workspace.id, true);
    toast('已归档，关联数据都还在');
    if (activeWorkspaceId.value === workspace.id) clearWorkspace();
    await loadWorkspaces();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function restoreWorkspace(workspace) {
  try {
    await workbench.workspaces.archive(workspace.id, false);
    toast('已恢复');
    await loadWorkspaces();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------- 工作会话 ------------------------- */

/**
 * 结束弹窗里的待办必须按【正在进行的那个 Session 的 workspaceId】加载，
 * 而不是当前正在浏览的 Workspace —— 否则会出现"在 B 里结束 A 的工作，
 * 却把 B 的待办写进 A 的快照"。
 */
async function loadSessionTodos() {
  try {
    const scope = activeSession.value ? activeSession.value.workspaceId : null;
    const normalizedScope = scope === undefined || scope === null || scope === '' ? null : String(scope);
    const todos = await workbench.todos.list();
    sessionTodos.value = todos.filter((todo) => {
      const value = todo.workspaceId === undefined || todo.workspaceId === null ? null : String(todo.workspaceId);
      return value === normalizedScope;
    });
  } catch (_) {
    sessionTodos.value = [];
  }
}

async function startWork() {
  if (!current.value || current.value.archived === true || starting.value || resuming.value) return;
  starting.value = true;
  try {
    const result = await startSession(current.value.id);
    if (result && result.started === false) {
      toast('已有正在进行的工作，请先结束或返回那一项', 'error');
      return;
    }
    toast('开始工作，计时已启动');
    await loadWorkspaces();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    starting.value = false;
  }
}

async function openEndModal() {
  await loadSessionTodos();
  showEndModal.value = true;
}

async function finishWork(payload) {
  ending.value = true;
  try {
    await endSession(payload);
    showEndModal.value = false;
    toast('本次工作已保存');
    await loadWorkspaces();
    await reloadSessionHistory();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    ending.value = false;
  }
}

/** 已有进行中的会话属于别的工作空间时，直接切过去 */
async function goActiveWorkspace() {
  const targetId = activeSession.value ? activeSession.value.workspaceId : null;
  if (!targetId) {
    toast('那次工作没有关联工作空间，可以直接结束它');
    return;
  }
  selectWorkspace(targetId);
  await loadWorkspaces();
}

/* ------------------------- 上次工作快照 ------------------------- */

async function loadLastSession() {
  const generation = ++lastSessionGeneration;
  const workspaceId = current.value && current.value.id;
  if (!current.value) {
    lastSession.value = null;
    return;
  }
  try {
    const session = await workbench.sessions.last(workspaceId);
    if (mounted && generation === lastSessionGeneration && current.value && current.value.id === workspaceId) lastSession.value = session;
  } catch (_) {
    if (mounted && generation === lastSessionGeneration && current.value && current.value.id === workspaceId) lastSession.value = null;
  }
}

/**
 * 继续上次工作：
 * 1) 检查是否已有进行中的会话，有就提示，不偷偷新建第二条
 * 2) 新建本次会话并开始计时
 * 3) 如果配置了 resumeWorkflowId（且仍然有效），自动运行这一个工作流
 * 4) 工作流失败不回滚会话，只提示"部分工作环境未能打开"
 */
async function resumeLastWork() {
  if (!current.value || current.value.archived === true || resuming.value || starting.value) return;
  const workspace = current.value;
  const workspaceId = workspace.id;
  const attempt = { generation: ++resumeGeneration, workspaceId };
  activeResumeAttempt = attempt;
  resuming.value = true;
  resumeWorkspaceId.value = workspaceId;
  resumeFeedback.value = null;
  resumeNotice.value = '';
  try {
    const result = await resumeWorkspaceWorkflow({
      workspace,
      loadWorkflows,
      isCurrent: () => isCurrentResumeAttempt(attempt),
      startSession,
      runDetailed: workbench.workflows.runDetailed,
      onStarted: async () => {
        if (isCurrentResumeAttempt(attempt)) resumeNotice.value = '工作已开始，正在计时；正在打开工作环境…';
        if (mounted) await loadWorkspaces();
      }
    });
    if (isCurrentResumeAttempt(attempt)) {
      resumeNotice.value = result.notice;
      resumeFeedback.value = result.feedback;
    }
  } catch (error) {
    if (isCurrentResumeAttempt(attempt)) resumeNotice.value = `开始工作失败：${error.message || '未知错误'}`;
  } finally {
    if (activeResumeAttempt === attempt) {
      activeResumeAttempt = null;
      resuming.value = false;
    }
  }
}

watch(activeWorkspaceId, () => {
  lastSessionGeneration++;
  lastSession.value = null;
  invalidateResumeAttempt();
  resumeFeedback.value = null;
  resumeNotice.value = '';
  resumeWorkspaceId.value = null;
}, { flush: 'sync' });

// 进入详情时刷新一次，保证计数与最近工作信息是最新的
watch(activeWorkspaceId, (value) => {
  if (value) loadWorkspaces();
});

// 切换"查看已归档"需要重新拉取列表
watch(showArchived, () => {
  loadWorkspaces();
});

onMounted(() => {
  loadWorkspaces();
  loadWorkflows().catch(() => { /* 恢复操作会单独报告读取失败 */ });
});
onBeforeUnmount(() => {
  mounted = false;
  workspaceListGeneration++;
  lastSessionGeneration++;
  invalidateResumeAttempt();
});
</script>

<style scoped>
.ws-resume-feedback > p { margin: 0; padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-muted); font-size: 12px; }
.workspace-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ws-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ws-toolbar__toggle {
  flex-direction: row;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
}

.ws-toolbar__toggle input {
  width: auto;
}

.ws-empty h2 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--text);
}

.ws-empty p {
  margin: 0 0 16px;
  line-height: 1.7;
  font-size: 13px;
}

.ws-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.ws-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.ws-detail-head .view-kicker {
  margin-top: 12px;
}

.ws-overview__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.ws-overview__stats span {
  display: block;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 6px;
}

.ws-overview__stats strong {
  font-size: 20px;
  color: var(--text);
}

.ws-overview__hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-faint);
}

.ws-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ws-section__head h2 {
  margin: 0 0 4px;
  font-size: 17px;
  color: var(--text);
}

.ws-section__head p {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
