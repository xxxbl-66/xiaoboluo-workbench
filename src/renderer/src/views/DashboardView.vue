<template>
  <div class="view dashboard-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / DASHBOARD</p>
        <h1>驾驶舱</h1>
        <p>集中查看今日待办、快捷应用与常用小组件。</p>
      </div>
    </header>

    <DashboardWelcome class="dashboard-welcome" />

    <AppLauncher class="dashboard-apps" />

    <div class="dashboard-grid">
      <TodayTodos class="dashboard-todos" @go-todos="$emit('navigate', 'todos')" />

      <aside class="dashboard-tools">
        <RecentWorkspaces @open="openWorkspace" @go-workspace="$emit('navigate', 'workspace')" />

        <div v-if="enabledWidgets.length" class="widget-stack">
          <article v-for="w in enabledWidgets" :key="w.id" class="widget-card">
            <header class="widget-card-head">
              <span>{{ w.label }}</span>
              <button class="icon-button" type="button" title="移除组件" @click="removeWidget(w.id)">×</button>
            </header>
            <div class="widget-card-body">
              <QuickNoteWidget v-if="w.id === 'quickNote'" />
              <TimerWidget v-else-if="w.id === 'timer'" />
            </div>
          </article>
        </div>

        <div v-if="addableWidgets.length" class="widget-add">
          <span>添加小组件</span>
          <div class="widget-add-buttons">
            <button v-for="w in addableWidgets" :key="w.id" class="ghost small" type="button" @click="addWidget(w.id)">
              ＋ {{ w.label }}
            </button>
          </div>
        </div>


      </aside>
    </div>

    <WorkflowPanel class="dashboard-workflows" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import DashboardWelcome from '../components/DashboardWelcome.vue';
import AppLauncher from '../components/AppLauncher.vue';
import TodayTodos from '../components/TodayTodos.vue';

import WorkflowPanel from '../components/WorkflowPanel.vue';
import QuickNoteWidget from '../components/QuickNoteWidget.vue';
import TimerWidget from '../components/TimerWidget.vue';
import RecentWorkspaces from '../components/RecentWorkspaces.vue';
import { workbench } from '../composables/useWorkbench.js';
import { useWorkspace } from '../composables/useWorkspace.js';

const emit = defineEmits(['navigate']);

const { selectWorkspace } = useWorkspace();

/** 从驾驶舱直接进入某个工作空间（不引入 router，沿用 activeView 切换） */
async function openWorkspace(workspace) {
  selectWorkspace(workspace.id);
  emit('navigate', 'workspace');
}

const widgetDefs = [
  { id: 'quickNote', label: '快速便签' },
  { id: 'timer', label: '计时器' }
];
const enabledWidgetIds = ref([]);

const enabledWidgets = computed(() => widgetDefs.filter((w) => enabledWidgetIds.value.includes(w.id)));
const addableWidgets = computed(() => widgetDefs.filter((w) => !enabledWidgetIds.value.includes(w.id)));

async function loadWidgets() {
  try {
    const settings = await workbench.settings.get();
    const list = settings.dashboardWidgets;
    enabledWidgetIds.value = Array.isArray(list) ? list : ['quickNote', 'timer'];
  } catch (_) {
    enabledWidgetIds.value = ['quickNote', 'timer'];
  }
}

async function persistWidgets() {
  try {
    await workbench.settings.update({ dashboardWidgets: enabledWidgetIds.value });
  } catch (_) {}
}

async function addWidget(id) {
  if (enabledWidgetIds.value.includes(id)) return;
  enabledWidgetIds.value = [...enabledWidgetIds.value, id];
  await persistWidgets();
}

async function removeWidget(id) {
  enabledWidgetIds.value = enabledWidgetIds.value.filter((x) => x !== id);
  await persistWidgets();
}

onMounted(loadWidgets);
</script>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dashboard-apps {
  width: 100%;
  margin-bottom: 0;
}

.dashboard-grid {
  width: 100%;
}

.dashboard-workflows {
  width: 100%;
}

.dashboard-apps {
  margin-bottom: 18px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 18px;
  align-items: start;
}

.dashboard-tools {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.widget-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.widget-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
  padding: 14px;
}

.widget-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
}

.widget-card-body {
  min-width: 0;
}

.widget-add {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  font-size: 12px;
}

.widget-add-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 1180px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-tools {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    align-items: start;
  }
}
</style>