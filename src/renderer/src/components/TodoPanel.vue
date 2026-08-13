<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>待办任务</h2>
        <p>{{ completedCount }}/{{ todos.length }} 已完成 · 支持拖拽排序</p>
      </div>
      <button class="primary" type="button" @click="openCreate">新建待办</button>
    </div>

    <form class="todo-add-bar" @submit.prevent="createTodo">
      <input v-model="draft.title" placeholder="添加一个每日任务…" />
      <select v-model="draft.priority">
        <option value="high">高优先级</option>
        <option value="medium">中优先级</option>
        <option value="low">低优先级</option>
      </select>
      <input v-model="draft.dueDate" type="date" />
      <button class="primary" type="submit">添加</button>
    </form>

    <div class="filter-row">
      <div class="filter-tabs">
        <button :class="{ active: filter === 'all' }" type="button" @click="filter = 'all'">全部</button>
        <button :class="{ active: filter === 'pending' }" type="button" @click="filter = 'pending'">未完成</button>
        <button :class="{ active: filter === 'completed' }" type="button" @click="filter = 'completed'">已完成</button>
      </div>
      <span class="filter-count">{{ filteredTodos.length }} 项</span>
    </div>

    <div v-if="filteredTodos.length" class="todo-list">
      <article
        v-for="todo in filteredTodos"
        :key="todo.id"
        class="todo-item"
        draggable="true"
        @dragstart="dragId = todo.id"
        @dragover.prevent
        @drop="handleDrop(todo.id)"
      >
        <input type="checkbox" :checked="todo.completed" @change="toggleTodo(todo)" />
        <div class="todo-main" @dblclick="openEdit(todo)">
          <strong :class="{ done: todo.completed }">{{ todo.title }}</strong>
          <span v-if="todo.dueDate" class="todo-due">{{ formatDate(todo.dueDate) }}</span>
        </div>
        <span class="todo-priority" :class="todo.priority">{{ priorityLabel(todo.priority) }}</span>
        <div class="todo-actions">
          <button class="icon-button" type="button" @click="openEdit(todo)">✎</button>
          <button class="icon-button danger" type="button" @click="removeTodo(todo)">×</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state small"><p>没有符合条件的任务。</p></div>

    <Modal v-model="showModal" :title="editingTodo ? '编辑待办' : '新建待办'" width="460px" @close="closeModal">
      <div class="form-grid">
        <label class="full">
          任务标题
          <input v-model="form.title" placeholder="要做什么？" />
        </label>
        <label>
          优先级
          <select v-model="form.priority">
            <option value="high">高优先级</option>
            <option value="medium">中优先级</option>
            <option value="low">低优先级</option>
          </select>
        </label>
        <label>
          截止时间
          <input v-model="form.dueDate" type="date" />
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" @click="saveTodo">保存</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const todos = ref([]);
const filter = ref('all');
const draft = ref({ title: '', priority: 'medium', dueDate: '' });
const showModal = ref(false);
const editingTodo = ref(null);
const form = ref({ title: '', priority: 'medium', dueDate: '' });
const dragId = ref(null);

const completedCount = computed(() => todos.value.filter((item) => item.completed).length);
const filteredTodos = computed(() => {
  const sorted = [...todos.value].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (filter.value === 'pending') return sorted.filter((item) => !item.completed);
  if (filter.value === 'completed') return sorted.filter((item) => item.completed);
  return sorted;
});

function priorityLabel(value) {
  return { high: '高', medium: '中', low: '低' }[value] || '中';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadTodos() {
  todos.value = await workbench.todos.list();
}

async function createTodo() {
  if (!draft.value.title.trim()) return;
  await workbench.todos.create({
    title: draft.value.title,
    priority: draft.value.priority,
    dueDate: draft.value.dueDate || null
  });
  draft.value = { title: '', priority: 'medium', dueDate: '' };
  await loadTodos();
}

function openCreate() {
  editingTodo.value = null;
  form.value = { title: '', priority: 'medium', dueDate: '' };
  showModal.value = true;
}

function openEdit(todo) {
  editingTodo.value = todo;
  form.value = {
    title: todo.title,
    priority: todo.priority,
    dueDate: todo.dueDate ? todo.dueDate.slice(0, 10) : ''
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingTodo.value = null;
}

async function saveTodo() {
  try {
    if (!form.value.title.trim()) throw new Error('请输入任务标题');
    if (editingTodo.value) {
      await workbench.todos.update(editingTodo.value.id, {
        title: form.value.title,
        priority: form.value.priority,
        dueDate: form.value.dueDate || null
      });
    } else {
      await workbench.todos.create({
        title: form.value.title,
        priority: form.value.priority,
        dueDate: form.value.dueDate || null
      });
    }
    await loadTodos();
    closeModal();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleTodo(todo) {
  await workbench.todos.update(todo.id, { completed: !todo.completed });
  await loadTodos();
}

async function removeTodo(todo) {
  todos.value = await workbench.todos.remove(todo.id);
}

async function handleDrop(targetId) {
  if (!dragId.value || dragId.value === targetId) return;
  const ordered = filteredTodos.value.map((item) => item.id);
  const from = ordered.indexOf(dragId.value);
  const to = ordered.indexOf(targetId);
  if (from === -1 || to === -1) return;
  ordered.splice(from, 1);
  ordered.splice(to, 0, dragId.value);
  dragId.value = null;
  const reordered = await workbench.todos.reorder(ordered);
  todos.value = reordered;
}

onMounted(loadTodos);
</script>
