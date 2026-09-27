<template>
  <div class="view dashboard-view">
    <header class="view-header">
      <p class="view-kicker">DASHBOARD</p>
      <h1>今天的工作</h1>
      <p>先看当前进度，再决定下一步。</p>
    </header>
    <DashboardWorkFocus @open="openWorkspace" @continue="continueWorkspace" @end="endWorkspace" @go-workspace="$emit('navigate', 'workspace')" />
    <div class="dashboard-grid">
      <TodayTodos @go-todos="$emit('navigate', 'todos')" />
      <section class="panel dashboard-today">
        <div class="panel-head"><div><h2>今日概览</h2><p>任务之外的进展</p></div></div>
        <div v-if="statusLoading" class="empty-state small" role="status">正在加载今日概览…</div>
        <div v-else-if="statusError" class="state-error" role="alert">{{ statusError }} <button class="ghost small" type="button" @click="loadStatus">重试</button></div>
        <template v-else>
          <div class="dashboard-today__row"><span>长期目标</span><strong>{{ activeGoals }} 项</strong></div>
          <div class="dashboard-today__row"><span>今日复盘</span><strong>{{ reviewed ? '已记录' : '尚未记录' }}</strong></div>
        </template>
        <div class="dashboard-today__links">
          <button class="ghost small" type="button" @click="$emit('navigate', 'todos')">查看待办</button>
          <button class="ghost small" type="button" @click="$emit('navigate', 'review')">查看复盘</button>
        </div>
      </section>
    </div>
    <section class="dashboard-shortcuts" aria-label="快速入口">
      <span>快速进入</span>
      <button type="button" @click="$emit('navigate', 'workspace')">工作空间</button>
      <button type="button" @click="$emit('navigate', 'files')">文件与便签</button>
      <button type="button" @click="$emit('navigate', 'bookmarks')">收藏</button>
      <button type="button" @click="$emit('navigate', 'workflow')">工作流</button>
    </section>
    <details class="dashboard-widgets">
      <summary>个人小组件</summary>
      <div v-if="enabledWidgets.length" class="dashboard-widgets__grid">
        <article v-for="w in enabledWidgets" :key="w.id" class="widget-card">
          <header class="widget-card-head"><span>{{ w.label }}</span><button class="icon-button" type="button" :aria-label="`移除${w.label}`" @click="removeWidget(w.id)">×</button></header>
          <QuickNoteWidget v-if="w.id === 'quickNote'" />
          <TimerWidget v-else-if="w.id === 'timer'" />
        </article>
      </div>
      <div v-if="addableWidgets.length" class="dashboard-widgets__add">
        <button v-for="w in addableWidgets" :key="w.id" class="ghost small" type="button" @click="addWidget(w.id)">＋ {{ w.label }}</button>
      </div>
    </details>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import DashboardWorkFocus from '../components/DashboardWorkFocus.vue';
import TodayTodos from '../components/TodayTodos.vue';
import QuickNoteWidget from '../components/QuickNoteWidget.vue';
import TimerWidget from '../components/TimerWidget.vue';
import { workbench } from '../composables/useWorkbench.js';
import { useWorkspace } from '../composables/useWorkspace.js';

const emit = defineEmits(['navigate']);
const { selectWorkspace, requestWorkspaceAction } = useWorkspace();
function openWorkspace(id) {
  if (!id) return;
  selectWorkspace(id);
  emit('navigate', 'workspace');
}
function continueWorkspace(id) {
  requestWorkspaceAction(id, 'resume');
  emit('navigate', 'workspace');
}
function endWorkspace(id) {
  requestWorkspaceAction(id, 'end');
  emit('navigate', 'workspace');
}

const activeGoals = ref(0);
const reviewed = ref(false);
const statusLoading = ref(true);
const statusError = ref('');
async function loadStatus() {
  statusLoading.value = true;
  statusError.value = '';
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  try {
    const [goals, review] = await Promise.all([workbench.goals.list(), workbench.review.get(date)]);
    activeGoals.value = goals.length;
    reviewed.value = Boolean(review?.updatedAt);
  } catch (error) {
    statusError.value = `今日概览加载失败：${error.message || '未知错误'}`;
  } finally { statusLoading.value = false; }
}

const widgetDefs = [{ id: 'quickNote', label: '快速便签' }, { id: 'timer', label: '计时器' }];
const enabledWidgetIds = ref([]);
const enabledWidgets = computed(() => widgetDefs.filter((item) => enabledWidgetIds.value.includes(item.id)));
const addableWidgets = computed(() => widgetDefs.filter((item) => !enabledWidgetIds.value.includes(item.id)));
async function loadWidgets() {
  try {
    const settings = await workbench.settings.get();
    enabledWidgetIds.value = Array.isArray(settings.dashboardWidgets) ? settings.dashboardWidgets : ['quickNote', 'timer'];
  } catch (_) { enabledWidgetIds.value = ['quickNote', 'timer']; }
}
async function setWidgets(next) {
  const previous = enabledWidgetIds.value;
  enabledWidgetIds.value = next;
  try { await workbench.settings.update({ dashboardWidgets: next }); }
  catch (_) { enabledWidgetIds.value = previous; }
}
function addWidget(id) { return setWidgets([...enabledWidgetIds.value, id]); }
function removeWidget(id) { return setWidgets(enabledWidgetIds.value.filter((item) => item !== id)); }
onMounted(() => { loadStatus(); loadWidgets(); });
</script>

<style scoped>
.dashboard-view { display: flex; flex-direction: column; gap: 16px; }
.dashboard-view .view-header { margin-bottom: 0; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, .65fr); gap: 16px; align-items: start; }
.dashboard-today__row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.dashboard-today__row span { color: var(--text-muted); }
.dashboard-today__row strong { font-size: 13px; }
.dashboard-today__links { display: flex; gap: 8px; margin-top: 14px; }
.dashboard-shortcuts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--border); }
.dashboard-shortcuts span { margin-right: 8px; color: var(--text-muted); font-size: 12px; }
.dashboard-shortcuts button { padding: 6px 9px; color: var(--primary); border-radius: var(--radius-xs); }
.dashboard-shortcuts button:hover { background: var(--primary-soft); }
.dashboard-widgets { border-top: 1px solid var(--border); padding-top: 12px; }
.dashboard-widgets summary { cursor: pointer; color: var(--text-muted); font-size: 12px; }
.dashboard-widgets__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 12px; }
.dashboard-widgets__add { display: flex; gap: 8px; padding: 12px 0; }
@media (max-width: 980px) { .dashboard-grid { grid-template-columns: 1fr; } }
</style>
