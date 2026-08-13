<template>
  <div class="view calendar-view">
    <header class="view-header">
      <div>
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
          <div class="calendar-cell-top">
            <span class="calendar-day">{{ cell.day }}</span>
            <span v-if="cell.holidayLabel" class="calendar-holiday-label">{{ cell.holidayLabel }}</span>
            <span v-else-if="cell.isWeekend" class="calendar-rest-label">休</span>
          </div>
          <div class="calendar-events">
            <span v-for="event in eventsByDate(cell.key)" :key="event.id" class="calendar-event event">{{ event.title }}</span>
            <span v-for="todo in todosByDate(cell.key)" :key="todo.id" class="calendar-event todo">{{ todo.title }}</span>
          </div>
        </button>
      </div>
    </section>

    <section class="panel selected-day-panel">
      <div class="panel-head">
        <div>
          <h2>{{ selectedLabel }}</h2>
          <p>{{ selectedCount ? `${selectedEvents.length} 条日程 · ${selectedTodos.length} 项待办` : '这一天还没有安排' }}</p>
        </div>
      </div>

      <div v-if="selectedCount" class="day-entries">
        <div v-if="selectedEvents.length" class="day-entry-group">
          <h3>日程</h3>
          <article v-for="event in selectedEvents" :key="event.id" class="event-item">
            <div class="event-dot"></div>
            <div class="event-info">
              <strong>{{ event.title }}</strong>
              <p v-if="event.note">{{ event.note }}</p>
            </div>
            <div class="event-actions">
              <button class="icon-button" type="button" @click="openEdit(event)">✎</button>
              <button class="icon-button danger" type="button" @click="removeEvent(event)">×</button>
            </div>
          </article>
        </div>

        <div v-if="selectedTodos.length" class="day-entry-group">
          <h3>待办</h3>
          <article v-for="todo in selectedTodos" :key="todo.id" class="event-item todo-row">
            <input type="checkbox" :checked="todo.completed" @change="toggleTodo(todo)" />
            <div class="event-info">
              <strong :class="{ done: todo.completed }">{{ todo.title }}</strong>
              <p>{{ priorityLabel(todo.priority) }}优先级</p>
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
  '2026-02-16': '除夕',
  '2026-02-17': '春节',
  '2026-02-18': '春节',
  '2026-02-19': '春节',
  '2026-04-04': '清明',
  '2026-04-05': '清明',
  '2026-04-06': '清明',
  '2026-05-01': '劳动节',
  '2026-05-02': '劳动节',
  '2026-05-03': '劳动节',
  '2026-06-19': '端午',
  '2026-06-20': '端午',
  '2026-09-25': '中秋',
  '2026-09-26': '中秋',
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
const currentMonthLabel = computed(() => {
  const date = currentMonth.value;
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
});

const selectedEvents = computed(() => events.value.filter((event) => event.date === selectedKey.value));
const selectedTodos = computed(() => todos.value.filter((todo) => todo.dueDate === selectedKey.value));
const selectedCount = computed(() => selectedEvents.value.length + selectedTodos.value.length);

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
    list.push({
      key,
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      holiday: Boolean(holidayMap[key]),
      holidayLabel: holidayMap[key] || ''
    });
  }
  return list;
});

function eventsByDate(key) {
  return events.value.filter((event) => event.date === key).slice(0, 3);
}

function todosByDate(key) {
  return todos.value.filter((todo) => todo.dueDate === key).slice(0, 3);
}

function priorityLabel(value) {
  return { high: '高', medium: '中', low: '低' }[value] || '中';
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
