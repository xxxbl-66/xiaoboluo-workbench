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
          </div>
          <div>
            <span>最近一次工作</span>
            <strong>{{ current.lastWorkedAt ? formatRelative(current.lastWorkedAt) : '还没有记录' }}</strong>
          </div>
        </div>
      </section>

      <section class="ws-section">
        <div class="ws-section__head">
          <h2>当前任务</h2>
          <p>这个工作空间内的待办；其他页面的待办不受影响。</p>
        </div>
        <TodoPanel :workspace-id="current.id" />
      </section>
    </template>

    <WorkspaceFormModal
      v-model="showForm"
      :workspace="editing"
      :workflows="workflows"
      @close="closeForm"
      @saved="saveWorkspace"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import LineIcon from '../components/LineIcon.vue';
import TodoPanel from '../components/TodoPanel.vue';
import WorkspaceCard from '../components/WorkspaceCard.vue';
import WorkspaceFormModal from '../components/WorkspaceFormModal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { useWorkspace } from '../composables/useWorkspace.js';
import { toast } from '../composables/toast.js';
import { formatDuration, formatRelative } from '../utils/duration.js';

defineProps({
  settings: { type: Object, default: () => ({}) }
});

const { activeWorkspaceId, workspaceList, selectWorkspace, clearWorkspace, setWorkspaceList } = useWorkspace();

const loading = ref(true);
const showArchived = ref(false);
const showForm = ref(false);
const editing = ref(null);
const workflows = ref([]);

const workspaces = computed(() => workspaceList.value);
const current = computed(() => (
  workspaceList.value.find((item) => item.id === activeWorkspaceId.value) || null
));

async function loadWorkspaces() {
  try {
    const list = await workbench.workspaces.list({ includeArchived: showArchived.value });
    setWorkspaceList(list);
  } catch (error) {
    toast(error.message, 'error');
    setWorkspaceList([]);
  } finally {
    loading.value = false;
  }
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
});
</script>

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
