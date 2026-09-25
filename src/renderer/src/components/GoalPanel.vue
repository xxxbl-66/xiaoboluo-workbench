<template>
  <section class="goal-panel">
    <div class="panel-head">
      <div>
        <h2>长期目标</h2>
        <p>共 {{ goals.length }} 个目标 · 用期限与进度持续追踪。</p>
      </div>
      <button class="primary" type="button" @click="openCreate">新建目标</button>
    </div>

    <div v-if="goals.length" class="goal-grid">
      <article v-for="goal in goals" :key="goal.id" class="goal-card">
        <header>
          <strong>{{ goal.title }}</strong>
        </header>
        <p v-if="goal.description">{{ goal.description }}</p>
        <div v-if="goal.targetDate" class="goal-target">目标期限：{{ formatDate(goal.targetDate) }}</div>
        <div v-if="goal.recurrence && goal.recurrence.type !== 'none'" class="goal-recurrence-badge">{{ recurrenceLabel(goal) }}</div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${goal.progress}%` }"></div>
        </div>
        <div class="goal-meta">
          <span>打卡进度 {{ goal.progress }}%</span>
          <span>{{ goal.checkinCount || 0 }}/{{ goal.scheduledCount || 0 }} 次</span>
        </div>
        <footer>
          <button
            v-if="goal.recurrence && goal.recurrence.type !== 'none'"
            class="goal-checkin"
            :class="{ done: isTodayChecked(goal) }"
            type="button"
            @click="checkinGoal(goal)"
          >
            {{ isTodayChecked(goal) ? '今日已打卡' : '今日打卡' }}
          </button>
          <div class="goal-actions">
            <button class="icon-button" type="button" title="编辑" :disabled="removingId === goal.id" @click="openEdit(goal)">✎</button>
            <button
              class="icon-button danger"
              type="button"
              :title="removingId === goal.id ? '正在删除…' : '删除'"
              :disabled="removingId === goal.id"
              @click="removeGoal(goal)"
            >{{ removingId === goal.id ? '…' : '🗑' }}</button>
          </div>
        </footer>
      </article>
    </div>
    <div v-else class="empty-state small"><p>还没有长期目标，点击“新建目标”开始规划。</p></div>

    <Modal v-model="showModal" :title="editingGoal ? '编辑目标' : '新建目标'" width="540px" @close="closeModal">
      <div class="goal-form">
        <label class="full">
          目标标题
          <input v-model="form.title" placeholder="例如：完成年度读书计划" />
        </label>
        <label>
          目标期限
          <input v-model="form.targetDate" type="date" />
        </label>
        <div class="goal-recurrence">
          <label>
            重复任务
            <select v-model="form.recurrenceType">
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select>
          </label>
          <div v-if="form.recurrenceType === 'weekly'" class="weekday-picker">
            <span>每周哪几天</span>
            <div class="weekday-options">
              <button
                v-for="(day, index) in weekDays"
                :key="index"
                type="button"
                :class="{ active: form.recurrenceDays.includes(index) }"
                @click="toggleWeekday(index)"
              >
                {{ day }}
              </button>
            </div>
          </div>
          <label v-if="form.recurrenceType !== 'none'">
            任务内容
            <input v-model="form.recurrenceTask" placeholder="例如：去健身房锻炼" />
          </label>
        </div>
        <label class="full">
          描述
          <textarea v-model="form.description" rows="3" placeholder="简单描述目标"></textarea>
        </label>
        <div class="goal-progress-hint">进度会根据每日打卡情况自动计算，无需手动调整。</div>
        <label class="full">
          备注
          <input v-model="form.note" placeholder="可选" />
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" @click="saveGoal">保存</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { removeGoalAndReload } from './goal-actions.js';

const props = defineProps({
  /**
   * 可选：只在某个工作空间内展示该空间的长期目标。
   * 不传（null）时行为与原来完全一致 —— 展示全部目标。
   */
  workspaceId: { type: String, default: null }
});

const allGoals = ref([]);
const showModal = ref(false);
const editingGoal = ref(null);
const removingId = ref(null);
const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
const form = ref({
  title: '',
  description: '',
  targetDate: '',
  note: '',
  recurrenceType: 'none',
  recurrenceDays: [],
  recurrenceTask: ''
});

const goals = computed(() => {
  if (!props.workspaceId) return allGoals.value;
  return allGoals.value.filter((goal) => {
    const value = goal.workspaceId === undefined || goal.workspaceId === null ? null : String(goal.workspaceId);
    return value === props.workspaceId;
  });
});

function recurrenceLabel(goal) {
  const recurrence = goal.recurrence || {};
  if (recurrence.type === 'daily') return '每天重复';
  if (recurrence.type === 'weekly') {
    const days = (recurrence.days || []).map((day) => weekDays[day]).join('、');
    return `每周${days || '未设置'}`;
  }
  return '';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadGoals() {
  allGoals.value = await workbench.goals.list();
}

function openCreate() {
  editingGoal.value = null;
  form.value = {
    title: '',
    description: '',
    targetDate: '',
    note: '',
    recurrenceType: 'none',
    recurrenceDays: [],
    recurrenceTask: ''
  };
  showModal.value = true;
}

function openEdit(goal) {
  editingGoal.value = goal;
  const recurrence = goal.recurrence || { type: 'none', days: [] };
  form.value = {
    title: goal.title,
    description: goal.description,
    targetDate: goal.targetDate ? goal.targetDate.slice(0, 10) : '',
    note: goal.note || '',
    recurrenceType: recurrence.type || 'none',
    recurrenceDays: Array.isArray(recurrence.days) ? recurrence.days : [],
    recurrenceTask: goal.recurrenceTask || ''
  };
  showModal.value = true;
}

function toggleWeekday(day) {
  if (form.value.recurrenceDays.includes(day)) {
    form.value.recurrenceDays = form.value.recurrenceDays.filter((item) => item !== day);
  } else {
    form.value.recurrenceDays = [...form.value.recurrenceDays, day].sort((a, b) => a - b);
  }
}

function closeModal() {
  showModal.value = false;
  editingGoal.value = null;
}

async function saveGoal() {
  try {
    const title = form.value.title.trim();
    if (!title) throw new Error('请输入目标标题');
    const recurrenceType = form.value.recurrenceType === 'daily' || form.value.recurrenceType === 'weekly'
      ? form.value.recurrenceType
      : 'none';
    const payload = {
      title,
      description: form.value.description,
      targetDate: form.value.targetDate || null,
      note: form.value.note,
      recurrence: {
        type: recurrenceType,
        days: recurrenceType === 'weekly' ? form.value.recurrenceDays : []
      },
      recurrenceTask: recurrenceType === 'none' ? '' : (form.value.recurrenceTask || title)
    };
    if (editingGoal.value) {
      // 编辑时不动 workspaceId
      await workbench.goals.update(editingGoal.value.id, payload);
    } else {
      await workbench.goals.create({ ...payload, workspaceId: props.workspaceId || null });
    }
    await loadGoals();
    closeModal();
    toast('目标已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function localTodayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isTodayChecked(goal) {
  return (Array.isArray(goal.completedDates) ? goal.completedDates : []).includes(localTodayKey());
}

async function checkinGoal(goal) {
  try {
    await workbench.goals.checkin(goal.id);
    await loadGoals();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/**
 * 删除目标。
 *
 * 注意 goals 是只读 computed：删除成功后必须刷新真正的状态源 allGoals，
 * 失败时不能提前把目标从界面上拿掉（P1-04）。
 */
async function removeGoal(goal) {
  if (!window.confirm(`确定删除目标“${goal.title}”吗？`)) return;
  if (removingId.value) return;
  removingId.value = goal.id;
  try {
    const result = await removeGoalAndReload(goal.id, {
      remove: (goalId) => workbench.goals.remove(goalId),
      list: () => workbench.goals.list()
    });
    if (!result.ok) {
      toast(`目标删除失败：${result.error}`, 'error');
      return;
    }
    if (result.reloadFailed) {
      // 数据已删除，但列表刷新失败：以服务端列表为准，再尝试一次
      await loadGoals();
      toast('目标已删除，但列表刷新出现异常，请重新进入页面确认', 'error');
      return;
    }
    allGoals.value = result.goals;
    toast('目标已删除');
  } finally {
    removingId.value = null;
  }
}

onMounted(loadGoals);
</script>

<style scoped>
.goal-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.goal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.goal-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
  padding: 16px;
}

.goal-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.goal-card header strong {
  font-size: 15px;
  line-height: 1.4;
}


.goal-card p {
  margin: 0 0 12px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.goal-target {
  margin: -4px 0 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.goal-recurrence-badge {
  display: inline-flex;
  align-self: flex-start;
  margin: 0 0 12px;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
}

.goal-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.goal-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.goal-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.goal-checkin {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
}

.goal-checkin.done {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary-strong);
}

.goal-progress-hint {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 12px;
}

.goal-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.goal-form .full,
.goal-form__row label,
.goal-form > label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.goal-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.goal-recurrence {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.goal-recurrence label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.weekday-picker {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.weekday-picker > span {
  color: var(--text-muted);
  font-size: 12px;
}

.weekday-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.weekday-options button {
  min-width: 38px;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.weekday-options button.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary-strong);
  font-weight: 600;
}

.goal-form input,
.goal-form select,
.goal-form textarea {
  width: 100%;
}

@media (max-width: 600px) {
  .goal-form__row {
    grid-template-columns: 1fr;
  }
}
</style>