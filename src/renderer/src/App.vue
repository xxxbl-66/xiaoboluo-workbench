<template>
  <div class="app-shell" :data-theme="settings.theme || 'light'">
    <Sidebar :class="{ 'sidebar-expanded': sidebarExpanded }" :active="activeView" @navigate="activeView = $event" />
    <main class="main-area">
      <div class="layout-controls">
        <button class="ghost small" type="button" @click="sidebarExpanded = !sidebarExpanded">
          <LineIcon name="menu" :size="16" />
        </button>
        <button class="ghost small" type="button" @click="dockExpanded = !dockExpanded">
          <LineIcon name="panel" :size="16" />
        </button>
      </div>
      <component
        :is="currentView"
        :settings="settings"
        @navigate="activeView = $event"
        @settings-updated="handleSettingsUpdated"
      />
    </main>
    <RightDock :class="{ 'dock-expanded': dockExpanded }" />
    <ToastHost />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Sidebar from './components/Sidebar.vue';
import RightDock from './components/RightDock.vue';
import ToastHost from './components/ToastHost.vue';
import LineIcon from './components/LineIcon.vue';
import DashboardView from './views/DashboardView.vue';
import FilesView from './views/FilesView.vue';
import TodosView from './views/TodosView.vue';
import CalendarView from './views/CalendarView.vue';
import ReviewView from './views/ReviewView.vue';
import BookmarksView from './views/BookmarksView.vue';
import BookshelfView from './views/BookshelfView.vue';
import ChatView from './views/ChatView.vue';
import SettingsView from './views/SettingsView.vue';
import { workbench } from './composables/useWorkbench.js';

const activeView = ref('dashboard');
const sidebarExpanded = ref(false);
const dockExpanded = ref(false);
const settings = ref({
  theme: 'light',
  extensions: { weather: false, cloudBackup: false },
  chatProviders: {
    doubao: { enabled: true, url: 'https://www.doubao.com/chat/', label: '豆包' },
    deepseek: { enabled: true, url: 'https://chat.deepseek.com/', label: 'DeepSeek' },
    gpt: { enabled: false, url: 'https://chatgpt.com/', label: 'GPT' }
  }
});

const viewMap = {
  dashboard: DashboardView,
  files: FilesView,
  todos: TodosView,
  calendar: CalendarView,
  review: ReviewView,
  bookmarks: BookmarksView,
  bookshelf: BookshelfView,
  chat: ChatView,
  settings: SettingsView
};

const currentView = computed(() => viewMap[activeView.value] || DashboardView);

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
}

function handleSettingsUpdated(next) {
  settings.value = next;
  applyTheme(next.theme);
}

onMounted(async () => {
  try {
    settings.value = await workbench.settings.get();
  } catch (_) {
    settings.value = { theme: 'light' };
  }
  applyTheme(settings.value.theme);
});
</script>
