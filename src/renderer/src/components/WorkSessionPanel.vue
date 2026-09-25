<template>
  <section class="session-panel panel" :class="{ working: workingHere, elsewhere: workingElsewhere }">
    <!-- 本工作空间正在工作 -->
    <template v-if="workingHere">
      <div class="session-panel__main">
        <span class="session-panel__dot"></span>
        <div>
          <p class="session-panel__label">正在工作</p>
          <strong class="session-panel__clock">{{ clock }}</strong>
          <p class="session-panel__sub">开始于 {{ formatRelative(activeSession.startedAt) }}</p>
        </div>
      </div>
      <button class="primary" type="button" @click="$emit('end')">结束工作</button>
    </template>

    <!-- 别的 WorkSpace 正在工作 -->
    <template v-else-if="workingElsewhere">
      <div class="session-panel__main">
        <div>
          <p class="session-panel__label">已有正在进行的工作</p>
          <strong class="session-panel__other">{{ otherWorkspaceName }}</strong>
          <p class="session-panel__sub">
            已进行 {{ formatClock(elapsedSeconds) }}，开始于 {{ formatRelative(activeSession.startedAt) }}
          </p>
          <p class="session-panel__sub">同一时间只能有一个工作会话，请先结束或返回那一项。</p>
        </div>
      </div>
      <div class="panel-actions">
        <button class="ghost" type="button" @click="$emit('go-active')">返回该工作</button>
        <button class="primary" type="button" @click="$emit('end')">结束该工作</button>
      </div>
    </template>

    <!-- 空闲 -->
    <template v-else>
      <div class="session-panel__main">
        <div>
          <p class="session-panel__label">还没有开始工作</p>
          <strong class="session-panel__idle">开始后会记录本次时长、完成事项和下一步</strong>
        </div>
      </div>
      <button class="primary" type="button" :disabled="busy" @click="$emit('start')">
        {{ busy ? '正在开始…' : '开始工作' }}
      </button>
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { useWorkSession } from '../composables/useWorkSession.js';
import { formatClock, formatRelative } from '../utils/duration.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  workspaceName: { type: String, default: '' },
  /** 当前进行中的会话属于哪个工作空间的名字（用于提示） */
  activeWorkspaceName: { type: String, default: '' },
  busy: { type: Boolean, default: false }
});

defineEmits(['start', 'end', 'go-active']);

const { activeSession, elapsedSeconds, isWorking } = useWorkSession();

const currentWorkspaceId = computed(() => {
  const value = activeSession.value ? activeSession.value.workspaceId : null;
  return value === undefined || value === null || value === '' ? null : String(value);
});

const workingHere = computed(() => isWorking.value && currentWorkspaceId.value === props.workspaceId);
const workingElsewhere = computed(() => isWorking.value && currentWorkspaceId.value !== props.workspaceId);
const clock = computed(() => formatClock(elapsedSeconds.value));
const otherWorkspaceName = computed(() => props.activeWorkspaceName || '另一个工作空间');
</script>

<style scoped>
.session-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.session-panel.working {
  border-color: var(--success);
  box-shadow: 0 0 0 1px var(--success-soft), var(--shadow-soft);
}

.session-panel.elsewhere {
  border-color: var(--warning);
}

.session-panel__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.session-panel__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success);
  flex: 0 0 auto;
  animation: session-pulse 1.6s ease-in-out infinite;
}

@keyframes session-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.session-panel__label {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-faint);
}

.session-panel__clock {
  display: block;
  font-size: 30px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--text);
  line-height: 1.1;
}

.session-panel__other {
  display: block;
  font-size: 17px;
  color: var(--text);
}

.session-panel__idle {
  display: block;
  font-size: 14px;
  color: var(--text-muted);
  font-weight: 500;
}

.session-panel__sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
