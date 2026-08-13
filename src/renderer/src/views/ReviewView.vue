<template>
  <div class="view review-view">
    <header class="view-header">
      <div>
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
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const todos = ref([]);
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

async function loadData() {
  const [todoList, review] = await Promise.all([
    workbench.todos.list(),
    workbench.review.get(dateKey)
  ]);
  todos.value = todoList;
  ensureRecord(review);
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
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(loadData);

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveReview();
  }
});
</script>
