<template>
  <div class="view review-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / REVIEW</p>
        <h1>今日复盘</h1>
        <p>{{ todayLabel }} · 记录今天做得怎么样，明天怎么调整。</p>
      </div>
    </header>

    <section class="review-metrics">
      <article class="metric-card">
        <span>待办完成度</span>
        <strong>{{ todoPercent }}%</strong>
        <small>{{ completedTodos }}/{{ totalTodos }} 项已完成</small>
      </article>
      <article class="metric-card">
        <span>阅读时长</span>
        <strong><input v-model.number="record.readingMinutes" type="number" min="0" @change="saveMetrics" /> 分钟</strong>
      </article>
      <article class="metric-card">
        <span>专注时长</span>
        <strong><input v-model.number="record.focusMinutes" type="number" min="0" @change="saveMetrics" /> 分钟</strong>
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

      <button class="review-save-button" type="button" @click="saveToday">保存今日复盘</button>
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

const todos = ref([]);
const history = ref([]);
const record = ref({
  date: '',
  readingMinutes: 0,
  focusMinutes: 0,
  answers: { whatDid: '', whatLearned: '', whatImprove: '' }
});
let saveTimer = null;

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

async function loadData() {
  const [todoList, review, reviewHistory] = await Promise.all([
    workbench.todos.list(),
    workbench.review.get(dateKey),
    workbench.review.list()
  ]);
  todos.value = todoList;
  ensureRecord(review);
  history.value = reviewHistory;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveReview, 500);
}

async function saveMetrics() {
  record.value.readingMinutes = Number(record.value.readingMinutes) || 0;
  record.value.focusMinutes = Number(record.value.focusMinutes) || 0;
  await saveReview();
}

async function saveReview() {
  try {
    const next = await workbench.review.update(dateKey, {
      readingMinutes: Number(record.value.readingMinutes) || 0,
      focusMinutes: Number(record.value.focusMinutes) || 0,
      answers: {
        whatDid: record.value.answers.whatDid || '',
        whatLearned: record.value.answers.whatLearned || '',
        whatImprove: record.value.answers.whatImprove || ''
      }
    });
    ensureRecord(next);
    history.value = await workbench.review.list();
    return next;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  }
}

async function saveToday() {
  await saveReview();
  toast('今日复盘已保存');
}

onMounted(loadData);

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveReview();
  }
});
</script>

<style scoped>
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
</style>