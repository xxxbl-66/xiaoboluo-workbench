<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>工作流</h2>
        <p>预设要打开的应用、文件和网页。运行工作流不会开始计时。</p>
      </div>
      <button class="primary" type="button" @click="openCreate">新建工作流</button>
    </div>

    <div v-if="loading" class="empty-state small" role="status">正在加载工作流…</div>
    <div v-else-if="listError" class="state-error" role="alert">{{ listError }} <button class="ghost small" type="button" @click="loadData">重试</button></div>
    <div v-else-if="workflows.length" class="workflow-list">
      <article v-for="workflow in workflows" :key="workflow.id" class="workflow-card">
        <div class="workflow-main">
          <strong>{{ workflow.name }}</strong>
          <span>{{ workflowSummary(workflow) }}</span>
        </div>
        <div class="workflow-actions">
          <button class="ghost small" type="button" :disabled="Boolean(running)" @click="runWorkflow(workflow)">{{ running === workflow.id ? '运行中…' : '运行' }}</button>
          <button class="icon-button" type="button" :aria-label="`编辑${workflow.name}`" @click="openEdit(workflow)"><LineIcon name="edit" :size="16" /></button>
          <button class="icon-button danger" type="button" :aria-label="`删除${workflow.name}`" @click="removeWorkflow(workflow)"><LineIcon name="trash" :size="16" /></button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state small">
      <p>还没有工作流。新建后，可以一键打开常用工作环境。</p>
    </div>
    <p v-if="running" role="status">工作流正在按顺序执行…</p>
    <button v-if="runFeedback && !showRunFeedback" class="ghost small" type="button" @click="showRunFeedback = true">查看上次运行结果</button>
    <WorkflowRunResult v-if="runFeedback && showRunFeedback" :result="runFeedback.result" :error="runFeedback.error" :workflow-name="runFeedback.name" @close="showRunFeedback = false" />

    <Modal v-model="showModal" :title="editingWorkflow ? '编辑工作流' : '新建工作流'" width="620px" @close="closeModal">
      <label>
        工作流名称
        <input v-model="form.name" maxlength="81" placeholder="例如：开始一天" @input="nameError = ''" />
        <small v-if="nameError" class="workflow-error">{{ nameError }}</small>
      </label>

      <div class="steps-editor">
        <div class="steps-title">执行步骤</div>
        <div v-for="(step, index) in form.steps" :key="step.id || index" class="workflow-step">
          <div class="step-row" :class="{ 'step-row--path': step.type === 'file' }">
          <span class="workflow-step__number">{{ index + 1 }}.</span>
          <select v-model="step.type" @change="delete stepErrors[index]">
            <option v-if="!['app', 'file', 'url'].includes(step.type)" :value="step.type" disabled>未知类型</option>
            <option value="app">应用</option>
            <option value="file">文件 / 文件夹</option>
            <option value="url">网页</option>
          </select>

          <select v-if="step.type === 'app'" v-model="step.appId" @change="delete stepErrors[index]">
            <option value="" disabled>选择应用</option>
            <option v-if="appsLoaded && step.appId && !apps.some((app) => app.id === step.appId)" :value="step.appId" disabled>原应用已删除，请重新选择</option>
            <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
          </select>

          <div v-else-if="step.type === 'file'" class="workflow-path">
            <input v-model="step.path" placeholder="文件或文件夹路径" @input="delete stepErrors[index]" />
            <button class="ghost small" type="button" :disabled="choosingPath" @click="choosePath(step, 'file')">选择文件</button>
            <button class="ghost small" type="button" :disabled="choosingPath" @click="choosePath(step, 'directory')">选择文件夹</button>
          </div>
          <input v-else-if="step.type === 'url'" v-model="step.url" placeholder="https://…" @input="delete stepErrors[index]" />
          <span v-else class="workflow-step__legacy">请选择支持的步骤类型</span>

          <div class="workflow-step__actions">
            <button class="icon-button" type="button" :disabled="index === 0" aria-label="上移步骤" @click="moveStep(index, -1)">↑</button>
            <button class="icon-button" type="button" :disabled="index === form.steps.length - 1" aria-label="下移步骤" @click="moveStep(index, 1)">↓</button>
            <button class="icon-button danger" type="button" aria-label="删除步骤" @click="removeStep(index)">×</button>
          </div>
          </div>
          <small v-if="stepErrors[index]" class="workflow-error">{{ stepErrors[index] }}</small>
          <small v-else-if="appsLoaded && step.type === 'app' && step.appId && !apps.some((app) => app.id === step.appId)" class="workflow-error">第 {{ index + 1 }} 步的应用已删除，运行时会失败。</small>
        </div>
        <small v-if="formError" class="workflow-error">{{ formError }}</small>
        <button class="ghost small" type="button" @click="addStep">＋ 添加步骤</button>
      </div>

      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" :disabled="saving" @click="saveWorkflow">{{ saving ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import LineIcon from './LineIcon.vue';
import WorkflowRunResult from './WorkflowRunResult.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { chooseWorkflowPath, validateWorkflowForm } from '../utils/workflow-form.mjs';

const workflows = ref([]);
const apps = ref([]);
const appsLoaded = ref(false);
const showModal = ref(false);
const editingWorkflow = ref(null);
const form = ref({ name: '', steps: [] });
const nameError = ref('');
const formError = ref('');
const stepErrors = ref({});
const saving = ref(false);
const choosingPath = ref(false);
const running = ref(null);
const runFeedback = ref(null);
const showRunFeedback = ref(false);
const loading = ref(true);
const listError = ref('');
let mounted = true;
let stepSeed = 0;

function makeStep(type = 'app') {
  return { id: `step-${Date.now()}-${++stepSeed}`, type, appId: '', path: '', url: '' };
}

function openCreate() {
  editingWorkflow.value = null;
  form.value = { name: '', steps: [makeStep('app')] };
  resetErrors();
  showModal.value = true;
}

function openEdit(workflow) {
  editingWorkflow.value = workflow;
  form.value = {
    name: workflow.name,
    steps: (workflow.steps || []).map((item) => ({ ...item }))
  };
  resetErrors();
  showModal.value = true;
}

function closeModal() {
  if (saving.value) return;
  showModal.value = false;
  editingWorkflow.value = null;
}

function resetErrors() {
  nameError.value = '';
  formError.value = '';
  stepErrors.value = {};
}

function moveStep(index, offset) {
  const other = index + offset;
  [form.value.steps[index], form.value.steps[other]] = [form.value.steps[other], form.value.steps[index]];
  stepErrors.value = {};
}

function removeStep(index) {
  form.value.steps.splice(index, 1);
  stepErrors.value = {};
}

async function choosePath(step, kind) {
  if (choosingPath.value) return;
  choosingPath.value = true;
  try {
    const picker = kind === 'file' ? workbench.system.selectFile : workbench.system.selectDirectory;
    const changed = await chooseWorkflowPath(step, picker, () => mounted && showModal.value && form.value.steps.includes(step));
    if (changed) stepErrors.value = {};
  } catch (error) {
    if (mounted) toast(error.message || '选择路径失败', 'error');
  } finally {
    choosingPath.value = false;
  }
}

function addStep() {
  form.value.steps.push(makeStep('app'));
}

function normalizeWorkflow(item) {
  return { ...item, steps: Array.isArray(item.steps) ? item.steps : [] };
}

function workflowSummary(workflow) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (!steps.length) return '尚无步骤';
  const label = (step) => {
    if (!step || typeof step !== 'object') return '无效步骤';
    if (step.type === 'app') return apps.value.find((item) => item.id === step.appId)?.name || '应用';
    if (step.type === 'file') return String(step.path || '').split(/[\\/]/).filter(Boolean).pop() || '文件';
    if (step.type === 'url') {
      try { return new URL(step.url).hostname; } catch (_) { return '网页'; }
    }
    return '未知步骤';
  };
  const preview = steps.slice(0, 3).map(label).join(' → ');
  return `${steps.length} 步 · ${preview}${steps.length > 3 ? ' …' : ''}`;
}

async function loadData() {
  loading.value = true;
  listError.value = '';
  try {
    const list = await workbench.workflows.list();
    if (mounted) workflows.value = list.map(normalizeWorkflow);
  } catch (error) {
    if (mounted) listError.value = `工作流加载失败：${error.message || '未知错误'}`;
  }
  try {
    const list = await workbench.apps.list();
    if (mounted) {
      apps.value = list;
      appsLoaded.value = true;
    }
  } catch (error) {
    if (mounted) {
      appsLoaded.value = false;
      toast(error.message, 'error');
    }
  }
  if (mounted) loading.value = false;
}

async function saveWorkflow() {
  if (saving.value) return;
  const checked = validateWorkflowForm(form.value);
  nameError.value = checked.nameError;
  formError.value = checked.formError;
  stepErrors.value = checked.stepErrors;
  if (!checked.valid) return;
  saving.value = true;
  try {
    if (editingWorkflow.value) {
      await workbench.workflows.update(editingWorkflow.value.id, checked.payload);
    } else {
      await workbench.workflows.create(checked.payload);
    }
    if (!mounted) return;
    await loadData();
    if (!mounted) return;
    showModal.value = false;
    editingWorkflow.value = null;
    toast('工作流已保存');
  } catch (error) {
    if (mounted) toast(error.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function runWorkflow(workflow) {
  if (running.value) return;
  running.value = workflow.id;
  runFeedback.value = null;
  showRunFeedback.value = false;
  try {
    const result = await workbench.workflows.runDetailed(workflow.id);
    if (mounted) {
      runFeedback.value = { name: workflow.name, result, error: '' };
      showRunFeedback.value = true;
    }
  } catch (error) {
    if (mounted) {
      runFeedback.value = { name: workflow.name, result: null, error: error.message || '执行失败' };
      showRunFeedback.value = true;
    }
  } finally {
    running.value = null;
  }
}

async function removeWorkflow(workflow) {
  if (!window.confirm(`确定删除工作流“${workflow.name}”吗？`)) return;
  workflows.value = await workbench.workflows.remove(workflow.id);
}

onMounted(loadData);
onBeforeUnmount(() => { mounted = false; });
</script>

<style scoped>
.workflow-error { display: block; margin-top: 4px; color: var(--warning); font-size: 12px; }
.workflow-step { display: flex; flex-direction: column; gap: 3px; }
.workflow-step .step-row { grid-template-columns: 20px 150px minmax(0, 1fr) 108px; }
.workflow-step__number { color: var(--text-muted); font-size: 12px; }
.workflow-step__actions, .workflow-path { display: flex; align-items: center; gap: 4px; }
.workflow-path { flex-wrap: wrap; min-width: 0; }
.workflow-path input { min-width: 0; flex: 1 1 280px; }
.step-row--path .workflow-path { grid-column: 2 / 5; grid-row: 2; }
.step-row--path .workflow-step__actions { grid-column: 4; grid-row: 1; }
.workflow-path button { white-space: nowrap; }
.workflow-step__legacy { color: var(--warning); font-size: 12px; }
@media (max-width: 680px) { .workflow-step .step-row { grid-template-columns: 20px 1fr 108px; } .workflow-step .step-row > :nth-child(3) { grid-column: 2 / 4; grid-row: 2; } .workflow-path { flex-wrap: wrap; } }
</style>
