<template>
  <Modal :model-value="modelValue" :title="editing ? '编辑工作空间' : '创建工作空间'" width="560px" @close="$emit('close')">
    <div class="ws-form">
      <label class="full">
        名称
        <input v-model="form.name" placeholder="例如：程序设计大赛" @keyup.enter="submit" />
      </label>

      <label class="full">
        描述
        <textarea v-model="form.description" rows="2" placeholder="这个工作空间在做什么？"></textarea>
      </label>

      <div class="ws-form__colors">
        <span>标识颜色</span>
        <div class="ws-form__swatches">
          <button
            v-for="color in palette"
            :key="color"
            class="ws-form__swatch"
            :class="{ active: form.color === color }"
            :style="{ background: color }"
            type="button"
            :title="color"
            @click="form.color = color"
          ></button>
        </div>
      </div>

      <div class="ws-form__workflows">
        <div class="ws-form__section-head">
          <span>绑定工作流</span>
          <small>继续工作时可以一键恢复工作环境</small>
        </div>

        <p v-if="!workflows.length" class="ws-form__hint">
          还没有工作流。可以先到「驾驶舱 → 工作流」创建，再回来绑定。
        </p>

        <ul v-else class="ws-form__list">
          <li v-for="workflow in workflows" :key="workflow.id">
            <label class="ws-form__check">
              <input
                type="checkbox"
                :checked="form.workflowIds.includes(workflow.id)"
                @change="toggleWorkflow(workflow.id)"
              />
              <span>{{ workflow.name }}</span>
            </label>
            <button
              v-if="form.workflowIds.includes(workflow.id)"
              class="ws-form__default"
              :class="{ active: form.resumeWorkflowId === workflow.id }"
              type="button"
              @click="form.resumeWorkflowId = form.resumeWorkflowId === workflow.id ? '' : workflow.id"
            >
              {{ form.resumeWorkflowId === workflow.id ? '继续工作时运行' : '设为默认' }}
            </button>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <button class="ghost" type="button" @click="$emit('close')">取消</button>
      <button class="primary" type="button" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, watch } from 'vue';
import Modal from './Modal.vue';
import { toast } from '../composables/toast.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  workspace: { type: Object, default: null },
  workflows: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'saved']);

const palette = ['#3b82f6', '#16a07c', '#e89b28', '#e5534b', '#8b5cf6', '#0ea5e9', '#111827', '#db2777'];

const editing = ref(false);
const saving = ref(false);
const form = ref({ name: '', description: '', color: palette[0], workflowIds: [], resumeWorkflowId: '' });

watch(
  () => [props.modelValue, props.workspace],
  () => {
    if (!props.modelValue) return;
    const target = props.workspace;
    editing.value = Boolean(target);
    form.value = {
      name: target ? target.name : '',
      description: target ? target.description || '' : '',
      color: (target && target.color) || palette[0],
      workflowIds: Array.isArray(target?.workflowIds) ? [...target.workflowIds] : [],
      resumeWorkflowId: (target && target.resumeWorkflowId) || ''
    };
    saving.value = false;
  },
  { immediate: true }
);

function toggleWorkflow(id) {
  const list = form.value.workflowIds;
  const index = list.indexOf(id);
  if (index === -1) list.push(id);
  else list.splice(index, 1);
  // 解绑默认工作流时同步清空，避免出现"默认工作流不在绑定列表里"的非法状态
  if (!list.includes(form.value.resumeWorkflowId)) form.value.resumeWorkflowId = '';
}

async function submit() {
  const name = form.value.name.trim();
  if (!name) {
    toast('请填写工作空间名称', 'error');
    return;
  }
  saving.value = true;
  try {
    emit('saved', {
      id: props.workspace ? props.workspace.id : null,
      payload: {
        name,
        description: form.value.description,
        color: form.value.color,
        workflowIds: [...form.value.workflowIds],
        resumeWorkflowId: form.value.resumeWorkflowId || null
      }
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.ws-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ws-form .full {
  width: 100%;
}

.ws-form__colors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.ws-form__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ws-form__swatch {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: 0 0 0 1px var(--border);
  transition: 0.16s ease;
}

.ws-form__swatch.active {
  border-color: var(--surface);
  box-shadow: 0 0 0 2px var(--text);
}

.ws-form__workflows {
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.ws-form__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--text-muted);
}

.ws-form__section-head small {
  color: var(--text-faint);
  font-size: 11px;
}

.ws-form__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
}

.ws-form__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.ws-form__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-muted);
}

.ws-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}

.ws-form__check input {
  width: auto;
}

.ws-form__default {
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  background: var(--surface);
  transition: 0.16s ease;
  white-space: nowrap;
}

.ws-form__default.active {
  background: var(--text);
  color: var(--surface);
  border-color: var(--text);
}
</style>
