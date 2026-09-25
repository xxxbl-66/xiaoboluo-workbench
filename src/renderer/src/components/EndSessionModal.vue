<template>
  <Modal :model-value="modelValue" title="结束工作" width="560px" @close="$emit('close')">
    <div class="end-session">
      <p v-if="workspaceName" class="end-session__target">
        正在结束：<strong>{{ workspaceName }}</strong>
      </p>

      <div class="end-session__summary">
        <div>
          <span>本次工作时间</span>
          <strong>{{ formatDuration(durationSeconds) }}</strong>
        </div>
        <div>
          <span>当前剩余任务</span>
          <strong>{{ remainingCount }}</strong>
        </div>
      </div>

      <div class="end-session__block">
        <div class="end-session__block-head">
          <span>本次完成</span>
          <small>已自动勾选本次工作期间完成的任务，可以自行调整</small>
        </div>

        <div v-if="!todos.length" class="empty-state small"><p>这个工作空间还没有待办</p></div>

        <ul v-else class="end-session__list">
          <li v-for="todo in todos" :key="todo.id">
            <label class="end-session__check">
              <input
                type="checkbox"
                :checked="selected.includes(todo.id)"
                @change="toggle(todo.id)"
              />
              <span :class="{ done: todo.completed }">{{ todo.title }}</span>
            </label>
            <span v-if="todo.completed" class="end-session__tag">已完成</span>
          </li>
        </ul>
      </div>

      <label class="full">
        本次备注
        <textarea v-model="note" rows="2" placeholder="例如：登录接口基本完成"></textarea>
      </label>

      <label class="full">
        下一步计划
        <input v-model="nextStep" placeholder="例如：完成 Token 刷新与权限测试" />
      </label>
    </div>

    <template #footer>
      <button class="ghost" type="button" @click="$emit('close')">取消</button>
      <button class="primary" type="button" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : '保存并结束' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { formatDuration } from '../utils/duration.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 本次会话（用于计算时长与自动勾选建议） */
  session: { type: Object, default: null },
  /** 当前工作空间内的待办 */
  todos: { type: Array, default: () => [] },
  /** 正在结束的那个工作空间的名字（用户可能停留在别的 Workspace 上） */
  workspaceName: { type: String, default: '' },
  saving: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'submit']);

const note = ref('');
const nextStep = ref('');
const selected = ref([]);

const remainingCount = computed(() => props.todos.filter((item) => item.completed !== true).length);

const durationSeconds = computed(() => {
  if (!props.session) return 0;
  const startedAt = new Date(props.session.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
});

/** 建议勾选：已完成，且在本会话开始之后被更新过 */
function suggest(currentSession, todos) {
  if (!currentSession) return [];
  const startedAt = new Date(currentSession.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return [];
  return todos
    .filter((todo) => {
      if (todo.completed !== true) return false;
      const updatedAt = new Date(todo.updatedAt || 0).getTime();
      return Number.isFinite(updatedAt) && updatedAt >= startedAt;
    })
    .map((todo) => todo.id);
}

watch(
  () => props.modelValue,
  (value) => {
    if (!value) return;
    note.value = '';
    nextStep.value = '';
    selected.value = suggest(props.session, props.todos);
  },
  { immediate: true }
);

// 待办列表异步到达时，如果没有手动改过选择就重新给出建议
watch(
  () => props.todos,
  (list) => {
    if (!props.modelValue) return;
    if (selected.value.length) return;
    selected.value = suggest(props.session, list);
  }
);

function toggle(id) {
  const index = selected.value.indexOf(id);
  if (index === -1) selected.value.push(id);
  else selected.value.splice(index, 1);
}

function submit() {
  emit('submit', {
    note: note.value,
    nextStep: nextStep.value,
    completedTodoIds: [...selected.value]
  });
}
</script>

<style scoped>
.end-session {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.end-session__target {
  margin: 0;
  padding: 9px 12px;
  border-radius: var(--radius-xs);
  background: var(--primary-soft);
  color: var(--text-muted);
  font-size: 13px;
}

.end-session__target strong {
  color: var(--text);
}

.end-session__summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}

.end-session__summary span {
  display: block;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 4px;
}

.end-session__summary strong {
  font-size: 19px;
  color: var(--text);
}

.end-session__block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.end-session__block-head small {
  font-size: 11px;
  color: var(--text-faint);
}

.end-session__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.end-session__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
}

.end-session__check {
  flex-direction: row;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  min-width: 0;
}

.end-session__check input {
  width: auto;
}

.end-session__check .done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.end-session__tag {
  font-size: 11px;
  color: var(--success);
  background: var(--success-soft);
  padding: 2px 8px;
  border-radius: 999px;
  flex: 0 0 auto;
}

.full {
  width: 100%;
}
</style>
