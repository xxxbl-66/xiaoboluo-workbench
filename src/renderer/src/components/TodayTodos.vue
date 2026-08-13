<template>
  <section class="panel compact-panel">
    <div class="panel-head">
      <div>
        <h2>今日待办</h2>
        <p>{{ completedCount }}/{{ totalCount }} 已完成</p>
      </div>
      <button class="ghost" type="button" @click="$emit('go-todos')">查看全部</button>
    </div>

    <div v-if="visibleTodos.length" class="mini-todo-list">
      <div v-for="todo in visibleTodos" :key="todo.id" class="mini-todo">
        <span class="todo-priority" :class="todo.priority">{{ priorityLabel(todo.priority) }}</span>
        <span class="todo-title" :class="{ done: todo.completed }">{{ todo.title }}</span>
        <span v-if="todo.dueDate" class="todo-date">{{ formatDate(todo.dueDate) }}</span>
      </div>
    </div>
    <div v-else class="empty-state small">
      <p>今天没有待办，休息一下</p>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';

defineEmits(['go-todos']);

const todos = ref([]);

const totalCount = computed(() => todos.value.length);
const completedCount = computed(() => todos.value.filter((item) => item.completed).length);
const visibleTodos = computed(() => todos.value.filter((item) => !item.completed).slice(0, 5));

function priorityLabel(value) {
  return { high: '高', medium: '中', low: '低' }[value] || '中';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

onMounted(async () => {
  try {
    todos.value = await workbench.todos.list();
  } catch (_) {}
});
</script>
