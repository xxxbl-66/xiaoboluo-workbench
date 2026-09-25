<template>
  <div class="view calendar-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / CALENDAR</p>
        <h1>日历</h1>
        <p>聚合日程、待办截止日和休息日，像日历一样一眼看清今天。</p>
      </div>
      <button class="primary" type="button" @click="openCreateForSelected">添加日程</button>
    </header>

    <section class="panel calendar-panel">
      <div class="calendar-toolbar">
        <button class="icon-button" type="button" @click="changeMonth(-1)">‹</button>
        <h2>{{ currentMonthLabel }}</h2>
        <button class="icon-button" type="button" @click="changeMonth(1)">›</button>
        <button class="ghost small" type="button" @click="goToday">今天</button>
      </div>

      <div class="calendar-weekdays">
        <span v-for="day in weekLabels" :key="day">{{ day }}</span>
      </div>

      <div class="calendar-grid">
        <button
          v-for="cell in cells"
          :key="cell.key"
          class="calendar-cell"
          :class="{
            muted: !cell.inMonth,
            today: cell.isToday,
            selected: cell.key === selectedKey,
            weekend: cell.isWeekend,
            holiday: cell.holiday
          }"
          type="button"
          @click="selectDate(cell.date)"
        >
          <div class="calendar-cell-main">
            <span class="calendar-day">{{ cell.day }}</span>
            <span class="calendar-cell-sub" :class="{ festival: cell.isFestival }">{{ cell.subLabel }}</span>
          </div>
          <div class="calendar-events">
            <span v-for="event in eventsByDate(cell.key)" :key="event.id" class="calendar-event event">{{ event.title }}</span>
            <span v-for="todo in todosByDate(cell.key)" :key="todo.id" class="calendar-event todo" :class="{ done: todo.completed }">{{ todo.title }}</span>
          </div>
        </button>
      </div>
    </section>

    <section class="panel selected-day-panel">
      <div class="selected-day-title">
        <div class="selected-day-date">{{ selectedLabel }}</div>
        <div class="selected-day-lunar">{{ selectedLunarLabel }}</div>
        <div class="selected-day-summary">{{ selectedCount ? `${selectedEvents.length} 条日程 · ${selectedTodos.length} 项待办` : '这一天还没有安排' }}</div>
      </div>

      <div v-if="selectedCount" class="day-entries">
        <div class="day-entry-group">
          <h3>当日安排</h3>
          <article
            v-for="item in dayEntries"
            :key="item.id"
            class="event-item"
            :class="{ 'todo-row': item.type === 'todo' }"
          >
            <input v-if="item.type === 'todo'" type="checkbox" :checked="item.todo.completed" @change="toggleTodo(item.todo)" />
            <div v-else class="event-dot"></div>

            <div class="event-info">
              <div class="event-title-row">
                <span class="entry-type" :class="item.type">{{ item.type === 'event' ? '日程' : '待办' }}</span>
                <strong :class="{ done: item.type === 'todo' && item.todo.completed }">{{ item.title }}</strong>
              </div>
              <p v-if="item.type === 'event' && item.event.note">{{ item.event.note }}</p>
              <p v-else-if="item.type === 'todo'">{{ quadrantInfo(item.todo).label }}<template v-if="item.todo.dueDate"> · 截止 {{ shortDate(item.todo.dueDate) }}</template></p>
            </div>

            <div v-if="item.type === 'event'" class="event-actions">
              <button class="icon-button" type="button" @click="openEdit(item.event)">✎</button>
              <button class="icon-button danger" type="button" @click="removeEvent(item.event)">×</button>
            </div>
          </article>
        </div>
      </div>
      <div v-else class="empty-state small"><p>点击日期后，可以添加日程。</p></div>
    </section>

    <Modal v-model="showModal" :title="editingEvent ? '编辑日程' : '添加日程'" width="460px" @close="closeModal">
      <div class="form-grid">
        <label class="full">
          日期
          <input v-model="form.date" type="date" />
        </label>
        <label class="full">
          标题
          <input v-model="form.title" placeholder="例如：项目周会" />
        </label>
        <label class="full">
          备注
          <textarea v-model="form.note" rows="3" placeholder="可选"></textarea>
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" @click="saveEvent">保存</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from '../components/Modal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { getDayLabel, getLunarInfo } from '../utils/lunar.js';
import { getQuadrant, sortTodosByQuadrant } from '../utils/quadrant.js';

const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];
const currentMonth = ref(new Date());
const events = ref([]);
const todos = ref([]);
const selectedDate = ref(new Date());
const showModal = ref(false);
const editingEvent = ref(null);
const form = ref({ date: '', title: '', note: '' });

const holidayMap = {
  '2026-01-01': '元旦',
  // 2026 年春节：正月初一为 2026-02-17（除夕 02-16）。
  // 原表误用了 2025 年的日期（01-28 ~ 02-04），已按农历修正。
  '2026-02-16': '除夕',
  '2026-02-17': '春节',
  '2026-02-18': '春节',
  '2026-02-19': '春节',
  '2026-02-20': '春节',
  '2026-02-21': '春节',
  '2026-02-22': '春节',
  '2026-04-04': '清明节',
  '2026-04-05': '清明节',
  '2026-04-06': '清明节',
  '2026-05-01': '劳动节',
  '2026-05-02': '劳动节',
  '2026-05-03': '劳动节',
  '2026-05-04': '劳动节',
  '2026-05-05': '劳动节',
  '2026-06-19': '端午节',
  '2026-06-20': '端午节',
  '2026-06-21': '端午节',
  '2026-09-25': '中秋节',
  '2026-09-26': '中秋节',
  '2026-09-27': '中秋节',
  '2026-10-01': '国庆节',
  '2026-10-02': '国庆节',
  '2026-10-03': '国庆节',
  '2026-10-04': '国庆节',
  '2026-10-05': '国庆节',
  '2026-10-06': '国庆节',
  '2026-10-07': '国庆节'
};

const selectedKey = computed(() => dateKey(selectedDate.value));
const selectedLabel = computed(() => `${selectedDate.value.getFullYear()}年${selectedDate.value.getMonth() + 1}月${selectedDate.value.getDate()}日`);
const selectedLunarLabel = computed(() => getDayLabel(selectedDate.value));
const currentMonthLabel = computed(() => {
  const date = currentMonth.value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
});

const selectedTodos = computed(() => (
  sortTodosByQuadrant(todos.value.filter((todo) => todo.dueDate === selectedKey.value))
));

const selectedEvents = computed(() => {
  const generatedTodoKeys = new Set(
    selectedTodos.value
      .filter((todo) => todo.generated && todo.sourceGoalId)
      .map((todo) => `${todo.sourceGoalId}:${todo.sourceDate}`)
  );
  return events.value.filter((event) => (
    event.date === selectedKey.value
    && !(event.generated && event.sourceGoalId && generatedTodoKeys.has(`${event.sourceGoalId}:${event.sourceDate}`))
  ));
});

const dayEntries = computed(() => [
  ...selectedEvents.value.map((event) => ({ id: `event-${event.id}`, type: 'event', event, title: event.title })),
  ...selectedTodos.value.map((todo) => ({ id: `todo-${todo.id}`, type: 'todo', todo, title: todo.title }))
]);

const selectedCount = computed(() => dayEntries.value.length);

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const cells = computed(() => {
  const year = currentMonth.value.getFullYear();
  const month = currentMonth.value.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const list = [];
  const today = new Date();
  const todayKey = dateKey(today);

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dateKey(date);
    const dayOfWeek = date.getDay();
    const lunarInfo = getLunarInfo(date);
    const festival = holidayMap[key] || lunarInfo.festival;
    list.push({
      key,
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      holiday: Boolean(festival),
      isFestival: Boolean(festival),
      subLabel: festival || lunarInfo.lunarText
    });
  }
  return list;
});

function eventsByDate(key) {
  const todosForDay = sortTodosByQuadrant(todos.value.filter((todo) => todo.dueDate === key));
  const generatedTodoKeys = new Set(
    todosForDay
      .filter((todo) => todo.generated && todo.sourceGoalId)
      .map((todo) => `${todo.sourceGoalId}:${todo.sourceDate}`)
  );
  return events.value
    .filter((event) => (
      event.date === key
      && !(event.generated && event.sourceGoalId && generatedTodoKeys.has(`${event.sourceGoalId}:${event.sourceDate}`))
    ))
    .slice(0, 3);
}

function todosByDate(key) {
  return sortTodosByQuadrant(todos.value.filter((todo) => todo.dueDate === key)).slice(0, 3);
}

function quadrantInfo(todo) {
  return getQuadrant(todo);
}

function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

async function loadData() {
  const [eventList, todoList] = await Promise.all([
    workbench.calendar.list(),
    workbench.todos.list()
  ]);
  events.value = eventList;
  todos.value = todoList;
}

function changeMonth(delta) {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + delta, 1);
}

function goToday() {
  currentMonth.value = new Date();
  selectedDate.value = new Date();
}

function selectDate(date) {
  selectedDate.value = new Date(date);
}

function openCreateForSelected() {
  editingEvent.value = null;
  form.value = { date: selectedKey.value, title: '', note: '' };
  showModal.value = true;
}

function openEdit(event) {
  editingEvent.value = event;
  form.value = { date: event.date, title: event.title, note: event.note || '' };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingEvent.value = null;
}

async function saveEvent() {
  try {
    if (!form.value.date) throw new Error('请选择日期');
    if (!form.value.title.trim()) throw new Error('请填写日程标题');
    if (editingEvent.value) {
      await workbench.calendar.update(editingEvent.value.id, form.value);
    } else {
      await workbench.calendar.create(form.value);
    }
    await loadData();
    closeModal();
    toast('日程已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeEvent(event) {
  events.value = await workbench.calendar.remove(event.id);
}

async function toggleTodo(todo) {
  await workbench.todos.update(todo.id, { completed: !todo.completed });
  await loadData();
}

onMounted(async () => {
  selectedDate.value = new Date();
  await loadData();
});
</script>

<style scoped>
.calendar-toolbar {
  justify-content: space-between;
}

.calendar-toolbar h2 {
  margin: 0;
  font-weight: 700;
}

.calendar-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.calendar-cell {
  align-items: center;
  text-align: center;
  min-height: 88px;
}

.calendar-cell-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.calendar-day {
  font-size: 16px;
  font-weight: 650;
  line-height: 1;
}

.calendar-cell-sub {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-faint);
}

.calendar-cell-sub.festival {
  color: var(--danger);
  font-weight: 700;
}

.calendar-events {
  width: 100%;
  align-items: stretch;
}

.calendar-cell.weekend .calendar-day {
  color: var(--warning);
}

.calendar-cell.holiday .calendar-day {
  color: var(--danger);
  font-weight: 750;
}

.calendar-event.todo {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

.calendar-event.todo.done {
  background: rgba(34, 197, 94, 0.14);
  color: #16a34a;
  text-decoration: line-through;
}

.day-entry-group h3 {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 13px;
}

.event-item {
  position: relative;
}

.entry-type {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.entry-type.todo {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}

.event-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.event-title-row strong {
  overflow-wrap: anywhere;
}

.event-title-row strong.done {
  color: var(--text-faint);
  text-decoration: line-through;
}

.event-info p {
  margin: 4px 0 0;
  color: var(--text-faint);
  font-size: 12px;
}

.todo-row input[type='checkbox'] {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  accent-color: #16a34a;
}
</style>