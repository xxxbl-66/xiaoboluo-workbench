<template>
  <section class="welcome-banner">
    <div class="welcome-greeting">
      <span class="welcome-product">四一四工作台</span>
      <span class="welcome-date">{{ dateLabel }}</span>
      <strong class="welcome-greeting-name">你好，{{ user.name }}</strong>
      <p class="welcome-sub">今天也按自己的节奏推进吧。</p>
    </div>
    <div class="welcome-stats">
      <div class="welcome-stat todo-stat">
        <div class="todo-ring" :class="{ all: allDone }" :title="`完成进度 ${completionPercent}%`">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle class="todo-ring__track" cx="32" cy="32" r="26" />
            <circle
              class="todo-ring__fill"
              cx="32"
              cy="32"
              r="26"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="progressOffset"
            />
          </svg>
          <span>{{ completionPercent }}%</span>
        </div>
        <div class="todo-stat__copy" :class="{ all: allDone }">
          <strong>{{ completedCount }}/{{ totalCount }}</strong>
          <span>{{ allDone ? '已全部完成' : '待办完成进度' }}</span>
        </div>
      </div>
      <div class="welcome-stat">
        <strong>{{ checkin.streak }}</strong>
        <span>连续打卡</span>
      </div>
      <div class="welcome-stat">
        <strong>{{ books }}</strong>
        <span>书架藏书</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { useTodosStore } from '../composables/useTodosStore.js';

const user = ref({ name: '用户' });
const checkin = ref({ streak: 0 });
const books = ref(0);
const { todos, loadTodos } = useTodosStore();

const radius = 26;
const circumference = 2 * Math.PI * radius;

const totalCount = computed(() => todos.value.length);
const completedCount = computed(() => todos.value.filter((item) => item.completed).length);
const allDone = computed(() => totalCount.value > 0 && completedCount.value === totalCount.value);
const completionPercent = computed(() => (
  totalCount.value ? Math.round((completedCount.value / totalCount.value) * 100) : 0
));
const progressOffset = computed(() => circumference * (1 - completionPercent.value / 100));

const dateLabel = computed(() => {
  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 周${week}`;
});

onMounted(async () => {
  try {
    const [settings, checkinData, bookList] = await Promise.all([
      workbench.settings.get(),
      workbench.checkins.get(),
      workbench.books.list()
    ]);
    user.value = { name: settings.user?.name || '用户' };
    checkin.value = checkinData;
    books.value = bookList.length;
  } catch (_) {}
  await loadTodos();
});
</script>

<style scoped>
.welcome-greeting {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.welcome-product {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.welcome-date {
  color: var(--text-faint);
  font-size: 12px;
}

.welcome-greeting-name {
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.02em;
  color: var(--text);
}

.todo-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.todo-ring {
  position: relative;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  display: grid;
  place-items: center;
}

.todo-ring svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.todo-ring__track,
.todo-ring__fill {
  fill: none;
  stroke-width: 6;
}

.todo-ring__track {
  stroke: var(--border);
}

.todo-ring__fill {
  stroke: var(--primary);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s ease, stroke 0.25s ease;
}

.todo-ring.all .todo-ring__fill {
  stroke: #22c55e;
}

.todo-ring span {
  position: relative;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
}

.todo-ring.all span,
.todo-stat__copy.all {
  color: #16a34a;
}
.todo-stat__copy.all strong {
  color: #16a34a;
}
.todo-stat__copy.all span {
  color: #16a34a;
}

.todo-stat__copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.todo-stat__copy strong {
  display: block;
  font-size: 20px;
  font-weight: 750;
  line-height: 1;
  color: var(--text);
}

.todo-stat__copy span {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}
</style>