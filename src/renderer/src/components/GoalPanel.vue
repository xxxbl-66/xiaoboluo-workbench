<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>长期目标</h2>
        <p>月目标 / 年目标，用进度条持续追踪。</p>
      </div>
      <button class="primary" type="button" @click="openCreate">新建目标</button>
    </div>

    <div v-if="goals.length" class="goal-grid">
      <article v-for="goal in goals" :key="goal.id" class="goal-card">
        <header>
          <strong>{{ goal.title }}</strong>
          <span class="goal-period">{{ periodLabel(goal.period) }}</span>
        </header>
        <p v-if="goal.description">{{ goal.description }}</p>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${goal.progress}%` }"></div>
        </div>
        <div class="goal-meta">
          <span>{{ goal.progress }}%</span>
          <span>{{ goal.note ? '有备注' : '' }}</span>
        </div>
        <footer>
          <input
            type="range"
            min="0"
            max="100"
            :value="goal.progress"
            @change="updateProgress(goal, Number($event.target.value))"
          />
          <div>
            <button class="icon-button" type="button" @click="openEdit(goal)">✎</button>
            <button class="icon-button danger" type="button" @click="removeGoal(goal)">🗑</button>
          </div>
        </footer>
      </article>
    </div>
    <div v-else class="empty-state small"><p>还没有长期目标。</p></div>

    <Modal v-model="showModal" :title="editingGoal ? '编辑目标' : '新建目标'" @close="closeModal">
      <div class="form-grid">
        <label>
          目标标题
          <input v-model="form.title" placeholder="例如：完成年度读书计划" />
        </label>
        <label>
          周期
          <select v-model="form.period">
            <option value="month">月目标</option>
            <option value="year">年目标</option>
          </select>
        </label>
        <label class="full">
          描述
          <textarea v-model="form.description" rows="3" placeholder="简单描述目标"></textarea>
        </label>
        <label>
          进度：{{ form.progress }}%
          <input v-model.number="form.progress" type="range" min="0" max="100" />
        </label>
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
import { onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const goals = ref([]);
const showModal = ref(false);
const editingGoal = ref(null);
const form = ref({ title: '', description: '', period: 'month', progress: 0, note: '' });

function periodLabel(value) {
  return value === 'year' ? '年目标' : '月目标';
}

async function loadGoals() {
  goals.value = await workbench.goals.list();
}

function openCreate() {
  editingGoal.value = null;
  form.value = { title: '', description: '', period: 'month', progress: 0, note: '' };
  showModal.value = true;
}

function openEdit(goal) {
  editingGoal.value = goal;
  form.value = {
    title: goal.title,
    description: goal.description,
    period: goal.period,
    progress: goal.progress,
    note: goal.note
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingGoal.value = null;
}

async function saveGoal() {
  try {
    if (!form.value.title.trim()) throw new Error('请输入目标标题');
    if (editingGoal.value) {
      await workbench.goals.update(editingGoal.value.id, form.value);
    } else {
      await workbench.goals.create(form.value);
    }
    await loadGoals();
    closeModal();
    toast('目标已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function updateProgress(goal, progress) {
  await workbench.goals.update(goal.id, { progress });
  await loadGoals();
}

async function removeGoal(goal) {
  if (!window.confirm(`确定删除目标“${goal.title}”吗？`)) return;
  goals.value = await workbench.goals.remove(goal.id);
}

onMounted(loadGoals);
</script>
