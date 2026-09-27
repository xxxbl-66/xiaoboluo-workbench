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
        <button v-if="!archived" class="ghost small" type="button" :disabled="Boolean(running) || busy" @click="run(workflow)">
          <LineIcon name="play" :size="13" />
          {{ running === workflow.id ? '运行中…' : '运行' }}
        </button>
      </li>
    </ul>

    <p v-if="missingIds.length" class="ws-workflows__warn">
      有 {{ missingIds.length }} 个已绑定的工作流已被删除。{{ missingIds.includes(workspace.resumeWorkflowId) ? '默认工作流已失效，请编辑工作空间重新选择。' : '请编辑工作空间移除失效绑定。' }}
    </p>
    <p v-if="running" role="status">工作流正在按顺序执行…</p>
    <button v-if="feedback && !showFeedback" class="ghost small" type="button" @click="showFeedback = true">查看上次运行结果</button>
    <WorkflowRunResult v-if="feedback && showFeedback" :result="feedback.result" :error="feedback.error" :workflow-name="feedback.name" @close="showFeedback = false" />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import LineIcon from './LineIcon.vue';
import WorkflowRunResult from './WorkflowRunResult.vue';
import { workbench } from '../composables/useWorkbench.js';
import { workflowStepSummary } from './workspace-workflow-summary.js';

const props = defineProps({
  workspace: { type: Object, required: true },
  workflows: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  archived: { type: Boolean, default: false }
});

defineEmits(['changed']);

const running = ref(null);
const feedback = ref(null);
const showFeedback = ref(false);
let mounted = true;
watch(() => props.workspace.id, () => { feedback.value = null; showFeedback.value = false; });
onBeforeUnmount(() => { mounted = false; });

const ids = computed(() => (Array.isArray(props.workspace.workflowIds) ? props.workspace.workflowIds : []));
/** 容错：忽略已经被删除的工作流 id */
const bound = computed(() => ids.value
  .map((id) => props.workflows.find((item) => item.id === id))
  .filter(Boolean));
const missingIds = computed(() => ids.value.filter((id) => !props.workflows.some((item) => item.id === id)));

function stepSummary(workflow) {
  return workflowStepSummary(workflow);
}

async function run(workflow) {
  if (running.value || props.busy) return;
  const workspaceId = props.workspace.id;
  running.value = workflow.id;
  feedback.value = null;
  showFeedback.value = false;
  try {
    const result = await workbench.workflows.runDetailed(workflow.id);
    if (mounted && props.workspace.id === workspaceId) {
      feedback.value = { name: workflow.name, result, error: '' };
      showFeedback.value = true;
    }
  } catch (error) {
    if (mounted && props.workspace.id === workspaceId) {
      feedback.value = { name: workflow.name, result: null, error: error.message || '工作流执行失败' };
      showFeedback.value = true;
    }
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
