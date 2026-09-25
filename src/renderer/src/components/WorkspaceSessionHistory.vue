<template>
  <section class="session-history panel">
    <div class="session-history__head">
      <div>
        <h2>工作历史</h2>
        <p>
          这个工作空间的历史工作记录。
          工作时长按工作开始日期统计，跨午夜的那次工作会记在开始那天。
        </p>
      </div>
      <div class="session-history__actions">
        <span v-if="sessions.length" class="session-history__count">已显示 {{ sessions.length }} 条</span>
        <button class="ghost small" type="button" :disabled="loading" @click="load(limit)">
          {{ loading ? '正在加载…' : '刷新' }}
        </button>
      </div>
    </div>

    <p v-if="errorMessage" class="session-history__error">{{ errorMessage }}</p>

    <div v-if="!loading && !sessions.length" class="empty-state small">
      <p>这个工作空间还没有已完成的工作记录。开始并结束一次工作后，这里会出现记录。</p>
    </div>

    <ul v-else class="session-history__list">
      <li v-for="item in sessions" :key="item.id" class="session-history__item">
        <div class="session-history__row">
          <div class="session-history__when">
            <strong>{{ formatDateTime(item.startedAt) }}</strong>
            <span>
              {{ formatDateTime(item.endedAt) || '未结束' }}
              · {{ formatDuration(item.durationSeconds) }}
            </span>
          </div>
          <div class="session-history__badges">
            <span class="session-history__badge">完成 {{ item.completedCount || 0 }} 项</span>
            <span v-if="item.durationAdjusted" class="session-history__badge adjusted">已校正时长</span>
            <button
              class="ghost small"
              type="button"
              :disabled="adjustingId === item.id"
              @click="openAdjust(item)"
            >
              {{ adjustingId === item.id ? '处理中…' : '校正时长' }}
            </button>
          </div>
        </div>

        <p v-if="item.note" class="session-history__line">备注：{{ item.note }}</p>
        <p v-if="item.nextStep" class="session-history__line">下一步：{{ item.nextStep }}</p>
        <p v-if="item.completedTodos && item.completedTodos.length" class="session-history__line">
          完成事项：{{ item.completedTodos.map((todo) => todo.title).join('、') }}
        </p>
        <p v-if="item.originalDurationSeconds !== undefined && item.durationAdjustmentCount" class="session-history__line session-history__line--faint">
          校正记录：原记录时长 {{ formatDuration(item.originalDurationSeconds) }}
          <template v-if="item.durationAdjustedAt">，校正于 {{ formatDateTime(item.durationAdjustedAt) }}</template>
          <template v-if="item.durationAdjustmentReason">，说明：{{ item.durationAdjustmentReason }}</template>
        </p>
      </li>
    </ul>

    <div v-if="hasMore" class="session-history__more">
      <button class="ghost small" type="button" :disabled="loading" @click="loadMore">
        {{ loading ? '正在加载…' : '查看更多' }}
      </button>
    </div>

    <SessionDurationAdjustModal
      v-model="showAdjust"
      :session="adjustTarget"
      :workspace-name="workspaceName"
      :adjust="adjustCall"
      @close="showAdjust = false"
      @adjusted="onAdjusted"
    />
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SessionDurationAdjustModal from './SessionDurationAdjustModal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { formatDuration, formatDateTime } from '../utils/duration.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  workspaceName: { type: String, default: '' },
  /** 首屏条数：历史多时只加载最近若干条 */
  pageSize: { type: Number, default: 5 }
});

const sessions = ref([]);
const limit = ref(props.pageSize);
const hasMore = ref(false);
const loading = ref(false);
const errorMessage = ref('');
const showAdjust = ref(false);
const adjustTarget = ref(null);
const adjustingId = ref(null);
let loadGeneration = 0;
let loadingWorkspaceId = null;
let mounted = true;

/**
 * 多取一条用来判断"是否还有更多"，但只展示 pageSize 条，
 * 避免一次把全部历史推给界面。
 */
async function load(nextLimit, force = false) {
  const workspaceId = props.workspaceId;
  if (!force && loading.value && loadingWorkspaceId === workspaceId) return;
  const generation = ++loadGeneration;
  loading.value = true;
  loadingWorkspaceId = workspaceId;
  errorMessage.value = '';
  const asked = Math.max(1, Number(nextLimit) || props.pageSize);
  try {
    const rows = await workbench.sessions.history({ workspaceId, limit: asked + 1 });
    if (!mounted || generation !== loadGeneration || workspaceId !== props.workspaceId) return;
    const list = Array.isArray(rows) ? rows : [];
    hasMore.value = list.length > asked;
    sessions.value = list.slice(0, asked);
    limit.value = asked;
  } catch (error) {
    if (!mounted || generation !== loadGeneration || workspaceId !== props.workspaceId) return;
    errorMessage.value = `工作历史加载失败：${error.message || '未知错误'}`;
    hasMore.value = false;
  } finally {
    if (mounted && generation === loadGeneration) {
      loading.value = false;
      loadingWorkspaceId = null;
    }
  }
}

function loadMore() {
  return load(limit.value + props.pageSize);
}

function openAdjust(session) {
  adjustTarget.value = session;
  showAdjust.value = true;
}

function adjustCall(sessionId, seconds, options) {
  adjustingId.value = adjustTarget.value ? adjustTarget.value.id : null;
  return workbench.sessions.adjustDuration(sessionId, seconds, options).finally(() => {
    adjustingId.value = null;
  });
}

async function onAdjusted() {
  toast('工作时长已按你的确认校正');
  window.dispatchEvent(new Event('workbench:session-duration-adjusted'));
  await load(limit.value, true);
}

defineExpose({ reload: () => load(limit.value, true) });

watch(() => props.workspaceId, () => {
  sessions.value = [];
  limit.value = props.pageSize;
  hasMore.value = false;
  errorMessage.value = '';
  void load(props.pageSize);
});

onMounted(() => load(props.pageSize));
onBeforeUnmount(() => {
  mounted = false;
  loadGeneration += 1;
});
</script>

<style scoped>
.session-history {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-history__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.session-history__head h2 {
  margin: 0 0 4px;
  font-size: 17px;
  color: var(--text);
}

.session-history__head p {
  margin: 0;
  max-width: 620px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.session-history__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-history__count {
  font-size: 12px;
  color: var(--text-faint);
}

.session-history__error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.session-history__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.session-history__item {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-muted);
}

.session-history__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.session-history__when strong {
  display: block;
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.session-history__when span {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.session-history__badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.session-history__badge {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
}

.session-history__badge.adjusted {
  background: var(--primary-soft);
  color: var(--primary-strong);
}

.session-history__line {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  word-break: break-word;
}

.session-history__line--faint {
  color: var(--text-faint);
}

.session-history__more {
  display: flex;
  justify-content: center;
}
</style>
