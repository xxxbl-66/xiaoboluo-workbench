<template>
  <div class="app-shell" :data-theme="settings.theme || 'light'">
    <Sidebar :class="{ 'sidebar-expanded': sidebarExpanded }" :active="activeView" :settings="settings" @navigate="activeView = $event" />
    <main class="main-area">
      <div class="layout-controls">
        <button class="ghost small" type="button" @click="sidebarExpanded = !sidebarExpanded">
          <LineIcon name="menu" :size="16" />
        </button>

        <!-- 异常退出后有未结束的工作一直未被处理：保留一个常驻入口，不会永久失去处理机会 -->
        <button
          v-if="hasPendingSession"
          class="pending-session-banner"
          type="button"
          @click="openRestorePrompt"
        >
          <span class="pending-session-banner__dot"></span>
          有一次未结束的工作待处理（已进行 {{ formatDuration(elapsedSeconds) }}）
        </button>

      </div>
      <component
        :is="currentView"
        :settings="settings"
        @navigate="activeView = $event"
        @settings-updated="handleSettingsUpdated"
      />
    </main>
    <ToastHost />

    <!-- 关闭窗口时对正在进行的工作做明确确认 -->
    <ShutdownConfirmModal
      v-model="showShutdown"
      :session="activeSession"
      :workspace-name="activeSessionName"
      :elapsed-seconds="elapsedSeconds"
      :busy="shutdownBusy"
      :error-message="shutdownError"
      @back="returnToWork"
      @end="endWorkAndClose"
      @keep="keepSessionAndClose"
    />

    <!-- 启动时发现上次未结束的工作 -->
    <SessionRestorePrompt
      v-model="showRestorePrompt"
      :session="activeSession"
      :workspace-name="activeSessionName"
      :elapsed-seconds="elapsedSeconds"
      :busy="restoreBusy"
      :error-message="restoreError"
      @resume="continueRestoredSession"
      @adjust="adjustRestoredSession"
      @later="dismissRestore"
    />

    <!-- "结束并校正时长"：先结束原记录，再校正有效时长 -->
    <SessionDurationAdjustModal
      v-model="showAdjustModal"
      :session="pendingAdjustTarget"
      :workspace-name="activeSessionName"
      :finish-active="Boolean(pendingAdjustTarget && !pendingAdjustTarget.endedAt)"
      :adjust="adjustDurationCall"
      @close="closeRestoredAdjustment"
      @adjusted="onRestoredSessionAdjusted"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Sidebar from './components/Sidebar.vue';
import ToastHost from './components/ToastHost.vue';
import LineIcon from './components/LineIcon.vue';
import SessionRestorePrompt from './components/SessionRestorePrompt.vue';
import ShutdownConfirmModal from './components/ShutdownConfirmModal.vue';
import SessionDurationAdjustModal from './components/SessionDurationAdjustModal.vue';
import DashboardView from './views/DashboardView.vue';
import WorkspaceView from './views/WorkspaceView.vue';
import FilesView from './views/FilesView.vue';
import TodosView from './views/TodosView.vue';
import CalendarView from './views/CalendarView.vue';
import ReviewView from './views/ReviewView.vue';
import BookmarksView from './views/BookmarksView.vue';
import BookshelfView from './views/BookshelfView.vue';
import ChatView from './views/ChatView.vue';
import SettingsView from './views/SettingsView.vue';
import { workbench } from './composables/useWorkbench.js';
import { useWorkSession } from './composables/useWorkSession.js';
import { toast } from './composables/toast.js';
import { formatDuration } from './utils/duration.js';
import { decideCloseAction, shouldExitAfterClose, toCloseResponse } from './composables/session-duration.js';

const activeView = ref('dashboard');
const sidebarExpanded = ref(false);
const {
  activeSession,
  elapsedSeconds,
  needsRestoreDecision,
  restorePromptDismissed,
  initialize: initializeSession,
  resumeSession,
  endSession,
  endAndAdjustSession,
  dismissRestorePrompt
} = useWorkSession();

const settings = ref({
  theme: 'light',
  extensions: { cloudBackup: false },
  chatProviders: {
    doubao: { enabled: true, url: 'https://www.doubao.com/chat/', label: '豆包' },
    deepseek: { enabled: true, url: 'https://chat.deepseek.com/', label: 'DeepSeek' },
    qwen: { enabled: true, url: 'https://chat.qwen.ai/', label: '千问' },
    gpt: { enabled: true, url: 'https://chatgpt.com/', label: 'GPT' }
  }
});

const workspaces = ref([]);
const showShutdown = ref(false);
const shutdownBusy = ref(false);
const shutdownError = ref('');
const showRestorePrompt = ref(false);
const showAdjustModal = ref(false);
const restoreBusy = ref(false);
const restoreError = ref('');
const pendingAdjustTarget = ref(null);
let removeCloseListener = null;
let closeRequestId = null;

const viewMap = {
  dashboard: DashboardView,
  workspace: WorkspaceView,
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

const activeSessionName = computed(() => {
  const session = activeSession.value;
  if (!session) return '';
  const found = workspaces.value.find((item) => item.id === session.workspaceId);
  return found ? found.name : '未归类的工作';
});

/** 未结束的工作仍未处理：保留常驻入口 */
const hasPendingSession = computed(() => Boolean(
  activeSession.value && needsRestoreDecision.value && restorePromptDismissed.value
));

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
}

function handleSettingsUpdated(next) {
  settings.value = next;
  applyTheme(next.theme);
}

async function loadWorkspaceNames() {
  try {
    workspaces.value = await workbench.workspaces.list({ includeArchived: true, withStats: false });
  } catch (_) {
    workspaces.value = [];
  }
}

/* ------------------------- 关闭确认 ------------------------- */

function openRestorePrompt() {
  restoreError.value = '';
  showRestorePrompt.value = true;
}

function dismissRestore() {
  dismissRestorePrompt();
  showRestorePrompt.value = false;
}

/** 返回工作：取消关闭，窗口保持可用，计时继续 */
function returnToWork() {
  if (shutdownBusy.value) return;
  showShutdown.value = false;
  shutdownError.value = '';
  workbench.sessions.respondClose(toCloseResponse('back'), closeRequestId);
  closeRequestId = null;
}

/** 保留会话并退出：允许关闭，会话保持未结束，下次启动会提示处理 */
function keepSessionAndClose() {
  workbench.sessions.respondClose(toCloseResponse('keep'), closeRequestId);
  closeRequestId = null;
}

/** 结束工作：先进入现有结束 Session 流程，保存成功后才允许关闭 */
async function endWorkAndClose() {
  if (shutdownBusy.value) return;
  shutdownBusy.value = true;
  shutdownError.value = '';
  try {
    // 关闭场景没有待办勾选界面：沿用现有 end 流程，只提交空备注
    await endSession({ note: '', nextStep: '', completedTodoIds: [] });
    if (!shouldExitAfterClose('end', true)) return;
    workbench.sessions.respondClose(toCloseResponse('end'), closeRequestId);
    closeRequestId = null;
    toast('本次工作已保存，正在关闭工作台');
  } catch (error) {
    // 保存失败绝不假装结束：保持窗口打开、保留会话，让用户重试
    shutdownError.value = `结束工作失败：${error.message || '未知错误'}。工作仍然是进行中，你可以重试或选择“保留会话并退出”。`;
  } finally {
    shutdownBusy.value = false;
  }
}

/* ------------------------- 异常重启后的处理 ------------------------- */

async function continueRestoredSession() {
  if (restoreBusy.value) return;
  restoreBusy.value = true;
  restoreError.value = '';
  try {
    await resumeSession();
    showRestorePrompt.value = false;
    // 明确告知：离线期间无法判断是否真的在工作
    toast('已继续这段工作。关闭期间的经过时间无法自动判断，显示的时长可能包含离线时段；需要时可以结束并校正时长', 'error');
  } catch (error) {
    restoreError.value = error.message || '继续工作失败';
  } finally {
    restoreBusy.value = false;
  }
}

/** 先收集有效时长；确认保存时才一次写盘结束并校正原会话。 */
function adjustRestoredSession() {
  if (restoreBusy.value || !activeSession.value) return;
  restoreError.value = '';
  pendingAdjustTarget.value = activeSession.value;
  showRestorePrompt.value = false;
  showAdjustModal.value = true;
}

function adjustDurationCall(sessionId, seconds, options) {
  if (pendingAdjustTarget.value && !pendingAdjustTarget.value.endedAt) {
    return endAndAdjustSession(seconds, options);
  }
  return workbench.sessions.adjustDuration(sessionId, seconds, options);
}

function onRestoredSessionAdjusted() {
  toast('工作时长已按你的确认校正');
  window.dispatchEvent(new Event('workbench:session-duration-adjusted'));
}

function closeRestoredAdjustment() {
  const wasActive = pendingAdjustTarget.value && !pendingAdjustTarget.value.endedAt;
  showAdjustModal.value = false;
  pendingAdjustTarget.value = null;
  if (wasActive && activeSession.value) showRestorePrompt.value = true;
}

onMounted(async () => {
  try {
    settings.value = await workbench.settings.get();
  } catch (_) {
    settings.value = { theme: 'light' };
  }
  applyTheme(settings.value.theme);
  await loadWorkspaceNames();
  // 重新打开应用时，如果上次没有结束工作，这里会把计时恢复出来
  await initializeSession();
  // 发现跨次启动未结束的工作：必须让用户明确决定怎么处理，不静默计入离线时间
  if (needsRestoreDecision.value) showRestorePrompt.value = true;

  removeCloseListener = workbench.sessions.onCloseRequest(async (request) => {
    closeRequestId = request && request.requestId;
    if (decideCloseAction(activeSession.value) === 'confirm') {
      // 保留会话并退出时会直接放行，不需要用户再点一次
      shutdownError.value = '';
      showShutdown.value = true;
      await nextTick();
      workbench.sessions.respondClose('shown', closeRequestId);
      return;
    }
    // 没有正在进行的会话：正常关闭
    workbench.sessions.respondClose('exit', closeRequestId);
  });
});

onBeforeUnmount(() => {
  if (typeof removeCloseListener === 'function') removeCloseListener();
});
</script>

<style scoped>
.pending-session-banner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 10px;
  padding: 6px 12px;
  border: 1px solid var(--warning);
  border-radius: 999px;
  background: var(--warning-soft);
  color: var(--text);
  font-size: 12px;
}

.pending-session-banner__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning);
  flex: 0 0 auto;
}
</style>
