<template>
  <div class="view review-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / REVIEW</p>
        <h1>今日复盘</h1>
        <p>{{ todayLabel }} · 记录今天做得怎么样，明天怎么调整。</p>
      </div>
    </header>

    <section class="panel review-work">
      <div class="panel-head">
        <div>
          <h2>今日工作概览</h2>
          <p>来自工作空间的真实计时记录，不需要手动填写。</p>
        </div>
        <div class="review-work-total">
          <span>今日工作总时长</span>
          <strong>{{ formatDuration(workSummary.totalSeconds) }}</strong>
        </div>
      </div>

      <div v-if="workSummary.byWorkspace.length" class="review-work-list">
        <article v-for="item in workSummary.byWorkspace" :key="item.workspaceId || 'unassigned'" class="review-work-item">
          <span class="review-work-dot" :style="{ background: item.color || 'var(--border-strong)' }"></span>
          <span class="review-work-name">{{ item.name }}</span>
          <span class="review-work-time">{{ formatDuration(item.seconds) }}</span>
        </article>
      </div>
      <div v-else class="empty-state small">
        <p>今天还没有工作记录。到「工作空间」开始一次工作，这里就会自动统计。</p>
      </div>

      <div class="review-work-foot">
        <span>今日完成 {{ workSummary.completedTodoCount }} 项任务</span>
        <span v-if="workSummary.activeSessionCount">· 有 {{ workSummary.activeSessionCount }} 次工作还在进行中</span>
        <span>· 工作时长按工作开始日期统计</span>
      </div>
    </section>

    <section class="review-metrics">
      <article class="metric-card">
        <span>待办完成度</span>
        <strong>{{ todoPercent }}%</strong>
        <small>{{ completedTodos }}/{{ totalTodos }} 项已完成</small>
      </article>
      <article class="metric-card">
        <span>阅读时长</span>
        <strong><input v-model.number="record.readingMinutes" type="number" min="0" @input="saveController.markChanged()" @change="saveMetrics" /> 分钟</strong>
      </article>
      <article class="metric-card">
        <span>专注时长</span>
        <strong><input v-model.number="record.focusMinutes" type="number" min="0" @input="saveController.markChanged()" @change="saveMetrics" /> 分钟</strong>
      </article>
    </section>

    <section class="panel review-questions">
      <div class="panel-head">
        <div>
          <h2>今天的三件事</h2>
          <p>不用写多，写真实的答案。</p>
        </div>
      </div>

      <div class="review-question">
        <h3>今天做了什么？</h3>
        <textarea v-model="record.answers.whatDid" placeholder="列出今天完成的事情…" @input="scheduleSave"></textarea>
      </div>
      <div class="review-question">
        <h3>今天学到了什么？</h3>
        <textarea v-model="record.answers.whatLearned" placeholder="一个认知、技巧或感悟…" @input="scheduleSave"></textarea>
      </div>
      <div class="review-question">
        <h3>明天要改进什么？</h3>
        <textarea v-model="record.answers.whatImprove" placeholder="下一步最小改进动作…" @input="scheduleSave"></textarea>
      </div>

      <button class="review-save-button" type="button" :disabled="saving" @click="saveToday">
        {{ saving ? '保存中…' : '保存今日复盘' }}
      </button>
      <p v-if="saveError" class="review-save-error">{{ saveError }} —— 内容仍保留在本页，可以重新点击保存。</p>
    </section>

    <section class="panel review-history">
      <div class="panel-head">
        <div>
          <h2>历史复盘</h2>
          <p>回看之前的记录，看见自己的变化。</p>
        </div>
      </div>

      <div v-if="historyRecords.length" class="review-history-list">
        <article v-for="item in historyRecords" :key="item.date" class="review-history-item">
          <div class="review-history-meta">
            <strong>{{ formatHistoryDate(item.date) }}</strong>
            <span>{{ formatHistoryTime(item.updatedAt) }}</span>
          </div>
          <p v-if="item.answers?.whatDid">做了什么：{{ item.answers.whatDid }}</p>
          <p v-if="item.answers?.whatLearned">学到了：{{ item.answers.whatLearned }}</p>
          <p v-if="item.answers?.whatImprove">要改进：{{ item.answers.whatImprove }}</p>
          <p v-if="!item.answers?.whatDid && !item.answers?.whatLearned && !item.answers?.whatImprove" class="review-history-empty">这一天没有留下文字记录。</p>
        </article>
      </div>
      <div v-else class="empty-state small"><p>还没有历史复盘记录。</p></div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { createReviewSaveController } from '../composables/review-save-controller.js';
import { formatDuration } from '../utils/duration.js';

const todos = ref([]);
const history = ref([]);
const workSummary = ref({ totalSeconds: 0, completedTodoCount: 0, activeSessionCount: 0, byWorkspace: [] });
const record = ref({
  date: '',
  readingMinutes: 0,
  focusMinutes: 0,
  answers: { whatDid: '', whatLearned: '', whatImprove: '' }
});
const saving = ref(false);
const saveError = ref('');
let saveTimer = null;
const saveController = createReviewSaveController({
  getDraft: () => ({
    readingMinutes: Number(record.value.readingMinutes) || 0,
    focusMinutes: Number(record.value.focusMinutes) || 0,
    answers: {
      whatDid: record.value.answers.whatDid || '',
      whatLearned: record.value.answers.whatLearned || '',
      whatImprove: record.value.answers.whatImprove || ''
    }
  }),
  write: (payload) => workbench.review.update(dateKey, payload),
  applySaved: ensureRecord
});

const today = new Date();
const todayLabel = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const totalTodos = computed(() => todos.value.length);
const completedTodos = computed(() => todos.value.filter((item) => item.completed).length);
const todoPercent = computed(() => (totalTodos.value ? Math.round((completedTodos.value / totalTodos.value) * 100) : 0));
const historyRecords = computed(() => history.value.filter((item) => item.date !== dateKey));

function ensureRecord(next) {
  record.value = {
    readingMinutes: Number(next.readingMinutes) || 0,
    focusMinutes: Number(next.focusMinutes) || 0,
    answers: {
      whatDid: next.answers?.whatDid || '',
      whatLearned: next.answers?.whatLearned || '',
      whatImprove: next.answers?.whatImprove || ''
    },
    date: next.date || dateKey
  };
}

function formatHistoryDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatHistoryTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadWorkSummary() {
  try {
    const [summary, workspaces] = await Promise.all([
      workbench.sessions.summary({ dateKey }),
      workbench.workspaces.list({ includeArchived: true, withStats: false })
    ]);
    const nameById = new Map(workspaces.map((item) => [item.id, item]));
    workSummary.value = {
      ...summary,
      byWorkspace: (summary.byWorkspace || [])
        .map((bucket) => {
          const workspace = bucket.workspaceId ? nameById.get(bucket.workspaceId) : null;
          return {
            ...bucket,
            name: workspace ? workspace.name : '未归类的工作',
            color: workspace ? workspace.color : ''
          };
        })
        .sort((left, right) => right.seconds - left.seconds)
    };
  } catch (_) {
    workSummary.value = { totalSeconds: 0, completedTodoCount: 0, activeSessionCount: 0, byWorkspace: [] };
  }
}

async function loadData() {
  const [todoList, review, reviewHistory] = await Promise.all([
    workbench.todos.list(),
    workbench.review.get(dateKey),
    workbench.review.list()
  ]);
  todos.value = todoList;
  ensureRecord(review);
  history.value = reviewHistory;
  await loadWorkSummary();
}

function scheduleSave() {
  saveController.markChanged();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveReview, 500);
}

async function saveMetrics() {
  record.value.readingMinutes = Number(record.value.readingMinutes) || 0;
  record.value.focusMinutes = Number(record.value.focusMinutes) || 0;
  saveController.markChanged();
  const outcome = await saveReview({ silent: true });
  if (!outcome.ok) toast(outcome.error, 'error');
  else if (outcome.current) toast('阅读／专注时长已保存');
}

/**
 * 真实保存复盘。
 *
 * 返回 {ok,error} 而不是 null：上层必须据此决定是否提示成功。
 * 失败时【不修改 record】，用户已输入的内容留在页面上可以重试。
 */
async function saveReview() {
  const saving = await saveController.save();
  if (!saving.ok) {
    saveError.value = saving.error;
    return saving;
  }
  saveError.value = '';
  try {
    history.value = await workbench.review.list();
  } catch (_) {
    // 保存已经成功，历史列表刷新失败不影响保存结论
  }
  return saving;
}

async function saveToday() {
  if (saving.value) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saving.value = true;
  try {
    const outcome = await saveReview();
    if (!outcome.ok) toast(outcome.error, 'error');
    else if (outcome.current) toast('今日复盘已保存');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadData();
  window.addEventListener('workbench:session-duration-adjusted', loadWorkSummary);
});

onBeforeUnmount(() => {
  window.removeEventListener('workbench:session-duration-adjusted', loadWorkSummary);
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    // 离开页面时的兜底保存：失败也只能静默记录，用户已不在页面上
    saveReview();
  }
});
</script>

<style scoped>
.review-work {
  margin-bottom: 18px;
}

.review-work-total {
  text-align: right;
  flex: 0 0 auto;
}

.review-work-total span {
  display: block;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 4px;
}

.review-work-total strong {
  font-size: 22px;
  color: var(--text);
}

.review-work-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-work-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-muted);
}

.review-work-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.review-work-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-work-time {
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.review-work-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.review-save-button {
  width: 100%;
  margin-top: 6px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 700;
  font-size: 14px;
}

.review-history {
  margin-top: 18px;
}

.review-history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-history-item {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
}

.review-history-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.review-history-meta strong {
  font-size: 15px;
}

.review-history-meta span {
  color: var(--text-faint);
  font-size: 12px;
}

.review-history-item p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.review-history-empty {
  color: var(--text-faint);
}

.review-save-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.6;
}
</style>
