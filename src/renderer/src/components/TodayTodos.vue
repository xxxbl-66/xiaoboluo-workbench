<template>
  <section class="panel compact-panel today-todos">
    <div class="panel-head">
      <div>
        <h2>今日待办</h2>
        <p>{{ completedCount }}/{{ totalCount }} 已完成<span v-if="allDone" class="all-done-label"> · 已全部完成</span></p>
      </div>
      <div class="today-progress" :title="`完成进度 ${completionPercent}%`">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle class="progress-track" cx="32" cy="32" r="26" />
          <circle
            class="progress-fill"
            :class="{ all: allDone }"
            cx="32"
            cy="32"
            r="26"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="progressOffset"
          />
        </svg>
        <span :class="{ all: allDone }">{{ completionPercent }}%</span>
      </div>
    </div>

    <div v-if="visibleTodos.length" class="mini-todo-list">
      <div v-for="todo in visibleTodos" :key="todo.id" class="mini-todo">
        <button
          class="mini-todo__check"
          :class="{ done: todo.completed }"
          type="button"
          title="标记完成"
          @click="toggleTodo(todo)"
        >
          <LineIcon v-if="todo.completed" name="check" :size="13" />
        </button>
        <span class="mini-todo__quadrant" :class="quadrantClass(todo)"></span>
        <span class="mini-todo__title" :class="{ done: todo.completed }">{{ todo.title }}</span>
        <span v-if="todo.dueDate" class="mini-todo__date">{{ formatDate(todo.dueDate) }}</span>
      </div>
    </div>
    <div v-else class="empty-state small">
      <p>今天没有待办，休息一下</p>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import LineIcon from './LineIcon.vue';
import { useTodosStore } from '../composables/useTodosStore.js';
import { workbench } from '../composables/useWorkbench.js';
import { getQuadrant, sortTodosByQuadrant } from '../utils/quadrant.js';

defineEmits(['go-todos']);

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

const visibleTodos = computed(() => (
  sortTodosByQuadrant(todos.value)
    .filter((item) => !item.completed)
    .slice(0, 5)
));

function quadrantClass(todo) {
  return getQuadrant(todo).className;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

async function toggleTodo(todo) {
  try {
    await workbench.todos.update(todo.id, { completed: !todo.completed });
    await loadTodos();
  } catch (_) {}
}

onMounted(loadTodos);
</script>

<style scoped>
.today-progress {
  position: relative;
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  display: grid;
  place-items: center;
}

.today-progress svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.progress-track,
.progress-fill {
  fill: none;
  stroke-width: 6;
}

.progress-track {
  stroke: var(--surface-2);
}

.progress-fill {
  stroke: var(--primary);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s ease, stroke 0.25s ease;
}

.progress-fill.all {
  stroke: #22c55e;
}

.today-progress span {
  position: relative;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.today-progress span.all,
.all-done-label {
  color: #16a34a;
}

.mini-todo {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.mini-todo:last-child {
  border-bottom: 0;
}

.mini-todo__check {
  width: 21px;
  height: 21px;
  flex: 0 0 21px;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--surface);
  color: var(--on-primary);
}

.mini-todo__check.done {
  background: var(--primary);
  border-color: var(--primary);
}

.mini-todo__quadrant {
  width: 5px;
  height: 24px;
  flex: 0 0 5px;
  border-radius: 999px;
  background: var(--surface-muted);
}

.mini-todo__quadrant.q-red { background: #ef4444; }
.mini-todo__quadrant.q-blue { background: #3b82f6; }
.mini-todo__quadrant.q-yellow { background: #f59e0b; }
.mini-todo__quadrant.q-green { background: #22c55e; }

.mini-todo__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 14px;
}

.mini-todo__title.done {
  color: var(--text-faint);
  text-decoration: line-through;
}

.mini-todo__date {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 11px;
}
</style>