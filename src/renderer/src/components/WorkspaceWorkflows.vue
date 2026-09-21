<template>
  <section class="ws-workflows">
    <div v-if="!bound.length" class="empty-state small">
      <p>
        这个工作空间还没有绑定工作流。
        点击「编辑」可以从现有工作流里选择，并指定「继续工作时运行」的那一个。
      </p>
    </div>

    <ul v-else class="ws-workflows__list">
      <li v-for="workflow in bound" :key="workflow.id">
        <div class="ws-workflows__info">
          <strong>{{ workflow.name }}</strong>
          <span>{{ stepSummary(workflow) }}</span>
        </div>
        <span v-if="workflow.id === workspace.resumeWorkflowId" class="ws-workflows__badge">
          继续工作时运行
        </span>
        <button class="ghost small" type="button" :disabled="running === workflow.id" @click="run(workflow)">
          <LineIcon name="play" :size="13" />
          {{ running === workflow.id ? '运行中…' : '运行' }}
        </button>
      </li>
    </ul>

    <p v-if="missingIds.length" class="ws-workflows__warn">
      有 {{ missingIds.length }} 个已绑定的工作流已被删除，已自动忽略。
    </p>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const props = defineProps({
  workspace: { type: Object, required: true },
  workflows: { type: Array, default: () => [] }
});

defineEmits(['changed']);

const running = ref(null);

const ids = computed(() => (Array.isArray(props.workspace.workflowIds) ? props.workspace.workflowIds : []));
/** 容错：忽略已经被删除的工作流 id */
const bound = computed(() => ids.value
  .map((id) => props.workflows.find((item) => item.id === id))
  .filter(Boolean));
const missingIds = computed(() => ids.value.filter((id) => !props.workflows.some((item) => item.id === id)));

function stepSummary(workflow) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (!steps.length) return '没有步骤';
  const labels = { app: '应用', file: '文件', url: '网页' };
  const counts = {};
  for (const step of steps) {
    const key = labels[step.type] || step.type || '未知';
    counts[key] = (counts[key] || 0) + 1;
  }
  return `${steps.length} 个步骤 · ${Object.entries(counts).map(([key, value]) => `${key}×${value}`).join('、')}`;
}

async function run(workflow) {
  running.value = workflow.id;
  try {
    await workbench.workflows.run(workflow.id);
    toast(`已运行「${workflow.name}」`);
  } catch (error) {
    toast(error.message || '工作流执行失败', 'error');
  } finally {
    running.value = null;
  }
}
</script>

<style scoped>
.ws-workflows__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ws-workflows__list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.ws-workflows__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ws-workflows__info strong {
  font-size: 13px;
  color: var(--text);
}

.ws-workflows__info span {
  font-size: 11px;
  color: var(--text-faint);
}

.ws-workflows__badge {
  font-size: 11px;
  color: var(--primary-strong);
  background: var(--primary-soft);
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}

.ws-workflows__list button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
}

.ws-workflows__warn {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--warning);
}
</style>
