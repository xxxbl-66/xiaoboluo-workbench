<template>
  <section class="todo-module">
    <form class="todo-module__composer" @submit.prevent="openCreate">
      <input
        v-model="draft.title"
        class="todo-module__input"
        placeholder="新建待办 (按 Enter 添加)"
      />
      <button class="todo-module__add" type="submit">新建待办</button>
    </form>

    <div class="todo-module__meta">
      <div class="todo-module__stack">
        <span>CURRENT STACK</span>
        <strong>{{ pendingCount }} / {{ maxTasks }}</strong>
      </div>
      <div class="todo-module__filters">
        <button
          class="todo-module__filter"
          :class="{ active: filter === 'all' }"
          type="button"
          @click="filter = 'all'"
        >
          全部
        </button>
        <button
          class="todo-module__filter"
          :class="{ active: filter === 'pending' }"
          type="button"
          @click="filter = 'pending'"
        >
          仅看未完成
        </button>
      </div>
    </div>

    <div class="todo-module__card">
      <div v-if="filteredTodos.length" class="todo-module__list">
        <article
          v-for="todo in filteredTodos"
          :key="todo.id"
          class="todo-module__item"
          @dblclick="openEdit(todo)"
        >
          <button
            class="todo-module__check"
            :class="{ done: todo.completed }"
            type="button"
            @click="toggleTodo(todo)"
          >
            <LineIcon v-if="todo.completed" name="check" :size="14" />
          </button>

          <span class="todo-module__quadrant" :class="quadrantInfo(todo).className" :title="quadrantInfo(todo).label"></span>

          <div class="todo-module__content">
            <span class="todo-module__name" :class="{ done: todo.completed }">{{ todo.title }}</span>
            <div class="todo-module__tags">
              <span class="todo-module__tag" :class="quadrantInfo(todo).className">{{ quadrantInfo(todo).label }}</span>
              <span v-if="todo.dueDate" class="todo-module__tag">截止 {{ formatDue(todo.dueDate) }}</span>
              <span v-if="todo.reminderAt" class="todo-module__tag">提醒 {{ formatReminder(todo.reminderAt) }}</span>
            </div>
          </div>

          <button class="todo-module__delete" type="button" title="删除" @click="removeTodo(todo)">
            <LineIcon name="trash" :size="17" />
          </button>
        </article>
      </div>

      <div v-else class="todo-module__empty">暂无待办</div>

      <button class="todo-module__clear" type="button" @click="clearCompleted">清除待办</button>
    </div>

    <p class="todo-module__end">END OF TODAY'S LIST</p>

    <Modal v-model="showModal" :title="editingTodo ? '编辑待办' : '新建待办'" width="520px" @close="closeModal">
      <div class="todo-form">
        <label class="full">
          任务标题
          <input v-model="form.title" placeholder="要做什么？" />
        </label>

        <div class="quadrant-picker">
          <div class="quadrant-picker__group">
            <span>重要程度</span>
            <div class="quadrant-options">
              <button type="button" :class="{ active: form.importance === 'high' }" @click="form.importance = 'high'">重要</button>
              <button type="button" :class="{ active: form.importance === 'low' }" @click="form.importance = 'low'">不重要</button>
            </div>
          </div>
          <div class="quadrant-picker__group">
            <span>紧急程度</span>
            <div class="quadrant-options">
              <button type="button" :class="{ active: form.urgency === 'high' }" @click="form.urgency = 'high'">紧急</button>
              <button type="button" :class="{ active: form.urgency === 'low' }" @click="form.urgency = 'low'">不紧急</button>
            </div>
          </div>
        </div>

        <div class="quadrant-preview" :class="formQuadrant.className">
          <span>{{ formQuadrant.label }}</span>
        </div>

        <div class="todo-form__row">
          <label>
            截止时间
            <input v-model="form.dueDate" type="date" />
          </label>
          <label>
            提醒时间
            <input v-model="form.reminderAt" type="datetime-local" />
          </label>
        </div>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" @click="saveTodo">保存</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { sortTodosByQuadrant } from '../utils/quadrant.js';

const props = defineProps({
  /**
   * 可选：只在某个工作空间内展示该空间的待办。
   * 不传（null）时行为与原来完全一致 —— 展示全部待办。
   */
  workspaceId: { type: String, default: null }
});

const todos = ref([]);
const filter = ref('all');
const draft = ref({ title: '' });
const showModal = ref(false);
const editingTodo = ref(null);
const form = ref({ title: '', importance: 'high', urgency: 'high', dueDate: '', reminderAt: '' });
const maxTasks = 10;
let reminderTimer = null;

function sameWorkspace(todo) {
  const value = todo.workspaceId === undefined || todo.workspaceId === null ? null : String(todo.workspaceId);
  return value === props.workspaceId;
}

/** 作用域内的待办：详情模式只看本空间，普通模式看全部（含未归类） */
const scopedTodos = computed(() => {
  if (!props.workspaceId) return todos.value;
  return todos.value.filter(sameWorkspace);
});

const quadrants = {
  importantUrgent: { label: '重要且紧急', className: 'q-red', rank: 0 },
  importantNotUrgent: { label: '重要不紧急', className: 'q-blue', rank: 2 },
  notImportantUrgent: { label: '紧急不重要', className: 'q-yellow', rank: 1 },
  notImportantNotUrgent: { label: '不重要不紧急', className: 'q-green', rank: 3 }
};

const pendingCount = computed(() => scopedTodos.value.filter((item) => !item.completed).length);

const filteredTodos = computed(() => {
  const sorted = sortTodosByQuadrant(scopedTodos.value);
  if (filter.value === 'pending') return sorted.filter((item) => !item.completed);
  return sorted;
});

const formQuadrant = computed(() => {
  if (form.value.importance === 'high' && form.value.urgency === 'high') return quadrants.importantUrgent;
  if (form.value.importance === 'high' && form.value.urgency === 'low') return quadrants.importantNotUrgent;
  if (form.value.importance === 'low' && form.value.urgency === 'high') return quadrants.notImportantUrgent;
  return quadrants.notImportantNotUrgent;
});

function quadrantInfo(todo) {
  const importance = todo.importance || (todo.priority === 'low' ? 'low' : 'high');
  const urgency = todo.urgency || (todo.priority === 'high' ? 'high' : 'low');
  if (importance === 'high' && urgency === 'high') return quadrants.importantUrgent;
  if (importance === 'high' && urgency === 'low') return quadrants.importantNotUrgent;
  if (importance === 'low' && urgency === 'high') return quadrants.notImportantUrgent;
  return quadrants.notImportantNotUrgent;
}

function formatDue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatReminder(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function toLocalInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

async function loadTodos() {
  todos.value = await workbench.todos.list();
}

function openCreate() {
  editingTodo.value = null;
  form.value = {
    title: draft.value.title,
    importance: 'high',
    urgency: 'high',
    dueDate: '',
    reminderAt: ''
  };
  showModal.value = true;
}

function openEdit(todo) {
  editingTodo.value = todo;
  form.value = {
    title: todo.title,
    importance: todo.importance || (todo.priority === 'low' ? 'low' : 'high'),
    urgency: todo.urgency || (todo.priority === 'high' ? 'high' : 'low'),
    dueDate: todo.dueDate ? todo.dueDate.slice(0, 10) : '',
    reminderAt: todo.reminderAt ? toLocalInput(todo.reminderAt) : ''
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingTodo.value = null;
}

async function saveTodo() {
  try {
    const title = form.value.title.trim();
    if (!title) throw new Error('请输入任务标题');
    const payload = {
      title,
      importance: form.value.importance,
      urgency: form.value.urgency,
      dueDate: form.value.dueDate || null,
      reminderAt: form.value.reminderAt || null,
      reminderFired: false
    };
    if (editingTodo.value) {
      // 编辑时不动 workspaceId，避免把已有归属改掉
      await workbench.todos.update(editingTodo.value.id, payload);
    } else {
      await workbench.todos.create({ ...payload, workspaceId: props.workspaceId || null });
    }
    draft.value = { title: '' };
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

async function clearCompleted() {
  // 只清理当前作用域（工作空间详情内不会误删其他空间的待办）
  const completed = scopedTodos.value.filter((item) => item.completed);
  if (!completed.length) {
    toast(props.workspaceId ? '本工作空间没有已完成的待办' : '没有已完成的待办');
    return;
  }
  await Promise.all(completed.map((item) => workbench.todos.remove(item.id)));
  await loadTodos();
}

/**
 * 待办提醒。
 *
 * 修复 P1-1：渲染进程的 new Notification() 在 Windows 上不会真正显示，
 * 而且构造函数不抛错，导致原来的 catch 兜底永远不执行、reminderFired 却被置为 true，
 * 提醒变成"静默且不可恢复"的失效。
 * 现在改为：主进程系统通知 + 可见 toast 兜底，只有确实提示过才写入 reminderFired。
 */
async function notifyTodo(todo) {
  let shown = false;
  try {
    const result = await workbench.system.notify({ title: '待办提醒', body: todo.title });
    shown = Boolean(result && result.shown);
  } catch (_) {
    shown = false;
  }
  // toast 由应用自己渲染，一定可见，作为兜底同时提供
  toast(`待办提醒：${todo.title}`, shown ? 'info' : 'error');
  return shown;
}

async function checkReminders() {
  try {
    const now = Date.now();
    for (const todo of todos.value) {
      if (todo.completed || !todo.reminderAt || todo.reminderFired) continue;
      const at = new Date(todo.reminderAt).getTime();
      if (Number.isNaN(at) || at > now) continue;
      try {
        await notifyTodo(todo);
        // 提示已经发出后才标记，避免失败后永久不再提醒
        await workbench.todos.update(todo.id, { reminderFired: true });
      } catch (error) {
        console.error('[reminder] 提醒处理失败', error);
      }
    }
    await loadTodos();
  } catch (error) {
    // 定时器回调里的异常不能变成 unhandled rejection
    console.error('[reminder] 检查提醒失败', error);
  }
}

onMounted(() => {
  loadTodos();
  checkReminders();
  reminderTimer = setInterval(checkReminders, 20000);
});

onBeforeUnmount(() => {
  if (reminderTimer) clearInterval(reminderTimer);
});</script>

<style scoped>
.todo-module {
  max-width: 820px;
  margin: 0 auto;
  color: var(--text);
}

.todo-module__composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 10px;
  margin-bottom: 24px;
}

.todo-module__input {
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 0 12px;
  font-size: 14px;
  color: var(--text);
  outline: none;
}

.todo-module__input:focus {
  border-color: var(--primary);
}

.todo-module__add {
  height: 42px;
  border-radius: 10px;
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
  font-size: 14px;
}

.todo-module__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.todo-module__stack {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.todo-module__stack span {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}

.todo-module__stack strong {
  font-size: 15px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.todo-module__filters {
  display: flex;
  gap: 6px;
}

.todo-module__filter {
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.todo-module__filter.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.todo-module__card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
  padding: 16px;
}

.todo-module__list {
  display: flex;
  flex-direction: column;
}

.todo-module__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}

.todo-module__item:last-child {
  border-bottom: 0;
}

.todo-module__check {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--on-primary);
  background: var(--surface);
}

.todo-module__check.done {
  background: var(--primary);
  border-color: var(--primary);
}

.todo-module__quadrant {
  width: 6px;
  height: 30px;
  flex: 0 0 6px;
  border-radius: 999px;
  background: var(--surface-muted);
}

.todo-module__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.todo-module__name {
  color: var(--text);
  font-size: 15px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.todo-module__name.done {
  color: var(--text-faint);
  text-decoration: line-through;
}

.todo-module__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.todo-module__tag {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.03em;
}

.todo-module__delete {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--text-faint);
}

.todo-module__delete:hover {
  background: var(--surface-2);
  color: var(--text);
}

.todo-module__empty {
  padding: 30px 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 14px;
}

.todo-module__clear {
  margin-top: 12px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.todo-module__end {
  margin: 26px 0 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 11px;
  letter-spacing: 0.18em;
}

.todo-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.todo-form .full {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.todo-form input {
  width: 100%;
}

.quadrant-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.quadrant-picker__group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.quadrant-picker__group > span {
  color: var(--text-muted);
  font-size: 12px;
}

.quadrant-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.quadrant-options button {
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.quadrant-options button.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary-strong);
  font-weight: 600;
}

.quadrant-preview {
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 650;
}

.todo-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.todo-form__row label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.q-red,
.todo-module__tag.q-red {
  background: #fdecec;
  color: #b4232f;
}

.todo-module__quadrant.q-red {
  background: #ef4444;
}

.q-blue,
.todo-module__tag.q-blue {
  background: #e9f2ff;
  color: #2563eb;
}

.todo-module__quadrant.q-blue {
  background: #3b82f6;
}

.q-yellow,
.todo-module__tag.q-yellow {
  background: #fff6df;
  color: #b7791f;
}

.todo-module__quadrant.q-yellow {
  background: #f59e0b;
}

.q-green,
.todo-module__tag.q-green {
  background: #eafaf0;
  color: #16a34a;
}

.todo-module__quadrant.q-green {
  background: #22c55e;
}

@media (max-width: 600px) {
  .todo-module__composer {
    grid-template-columns: 1fr;
  }

  .todo-module__meta {
    flex-direction: column;
    align-items: flex-start;
  }

  .quadrant-picker,
  .todo-form__row {
    grid-template-columns: 1fr;
  }
}
</style>