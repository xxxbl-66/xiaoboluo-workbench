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

      <WorkSessionPanel
        :workspace-id="current.id"
        :workspace-name="current.name"
        :active-workspace-name="activeWorkspaceName"
        :busy="starting"
        @start="startWork"
        @end="openEndModal"
        @go-active="goActiveWorkspace"
      />

      <ResumeWorkCard
        :session="lastSession"
        :busy="resuming"
        @resume="resumeLastWork"
      />

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
        />
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>当前任务</h2>
          <p>这个工作空间内的待办；其他页面的待办不受影响。</p>
        </div>
        <TodoPanel :workspace-id="current.id" />
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>长期目标</h2>
          <p>属于这个工作空间的长期目标，自动生成的待办会继承同样的归属。</p>
        </div>
        <GoalPanel :workspace-id="current.id" />
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>相关资源</h2>
          <p>文件、便签、收藏与快捷应用。关联只改变归属，不会复制内容。</p>
        </div>
        <WorkspaceResources
          :workspace-id="current.id"
          :workspaces="workspaces"
          @changed="loadWorkspaces"
        />
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>工作流</h2>
          <p>绑定这个工作空间会用到的工作流；「继续上次工作」最多自动运行一个。</p>
        </div>
        <WorkspaceWorkflows :workspace="current" :workflows="workflows" />
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
import WorkspaceSessionHistory from '../components/WorkspaceSessionHistory.vue';
import EndSessionModal from '../components/EndSessionModal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { useWorkspace } from '../composables/useWorkspace.js';
import { useWorkSession } from '../composables/useWorkSession.js';
import { toast } from '../composables/toast.js';
import { formatDuration, formatRelative } from '../utils/duration.js';

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
const ending = ref(false);
const showEndModal = ref(false);
const sessionTodos = ref([]);
const lastSession = ref(null);
const sessionHistoryRef = ref(null);

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
  try {
    const list = await workbench.workspaces.list({ includeArchived: showArchived.value });
    setWorkspaceList(list);
    ensureSelectionValid();
  } catch (error) {
    toast(error.message, 'error');
    setWorkspaceList([]);
  } finally {
    loading.value = false;
  }
  await loadLastSession();
}

async function loadWorkflows() {
  try {
    workflows.value = await workbench.workflows.list();
  } catch (_) {
    workflows.value = [];
  }
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
  if (!current.value) return;
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
  if (!current.value) {
    lastSession.value = null;
    return;
  }
  try {
    lastSession.value = await workbench.sessions.last(current.value.id);
  } catch (_) {
    lastSession.value = null;
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
  if (!current.value) return;
  resuming.value = true;
  try {
    const result = await startSession(current.value.id);
    if (result && result.started === false) {
      toast('已有正在进行的工作，请先结束或返回那一项', 'error');
      return;
    }

    toast('已开始工作，计时中');

    const resumeId = current.value.resumeWorkflowId;
    const validIds = Array.isArray(current.value.workflowIds) ? current.value.workflowIds : [];
    const valid = resumeId && validIds.includes(resumeId) && workflows.value.some((item) => item.id === resumeId);

    if (valid) {
      try {
        await workbench.workflows.run(resumeId);
        toast('工作环境已恢复');
        await loadWorkspaces();
      } catch (error) {
        // 会话保持工作状态，用户可以继续手动工作
        toast(`工作已开始，但部分工作环境未能打开：${error.message || '执行失败'}`, 'error');
      }
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    resuming.value = false;
  }
}

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
  loadWorkflows();
  window.addEventListener('workbench:session-duration-adjusted', loadWorkspaces);
});

onBeforeUnmount(() => {
  window.removeEventListener('workbench:session-duration-adjusted', loadWorkspaces);
});</script>

<style scoped>
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
