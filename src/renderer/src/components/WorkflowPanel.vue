<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>工作流</h2>
        <p>把常用动作串成一条快捷流程。</p>
      </div>
      <button class="primary" type="button" @click="openCreate">新建工作流</button>
    </div>

    <div v-if="workflows.length" class="workflow-list">
      <article v-for="workflow in workflows" :key="workflow.id" class="workflow-card">
        <div class="workflow-main">
          <strong>{{ workflow.name }}</strong>
          <span>{{ (workflow.steps || []).length }} 个步骤</span>
        </div>
        <div class="workflow-actions">
          <button class="ghost small" type="button" :disabled="Boolean(running)" @click="runWorkflow(workflow)">{{ running === workflow.id ? '运行中…' : '运行' }}</button>
          <button class="icon-button" type="button" @click="openEdit(workflow)">✎</button>
          <button class="icon-button danger" type="button" @click="removeWorkflow(workflow)">🗑</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state small">
      <p>还没有工作流，创建一个试试。</p>
    </div>
    <p v-if="running" role="status">工作流正在按顺序执行…</p>
    <WorkflowRunResult v-if="runFeedback" :result="runFeedback.result" :error="runFeedback.error" :workflow-name="runFeedback.name" @close="runFeedback = null" />

    <Modal v-model="showModal" :title="editingWorkflow ? '编辑工作流' : '新建工作流'" width="620px" @close="closeModal">
      <label>
        工作流名称
        <input v-model="form.name" maxlength="81" placeholder="例如：开始一天" @input="nameError = ''" />
        <small v-if="nameError" class="workflow-error">{{ nameError }}</small>
      </label>

      <div class="steps-editor">
        <div class="steps-title">执行步骤</div>
        <div v-for="(step, index) in form.steps" :key="step.id || index" class="workflow-step">
          <div class="step-row">
          <span class="workflow-step__number">{{ index + 1 }}.</span>
          <select v-model="step.type" @change="delete stepErrors[index]">
            <option v-if="!['app', 'file', 'url'].includes(step.type)" :value="step.type" disabled>未知类型</option>
            <option value="app">启动应用</option>
            <option value="file">打开文件或文件夹</option>
            <option value="url">打开网页</option>
          </select>

          <select v-if="step.type === 'app'" v-model="step.appId" @change="delete stepErrors[index]">
            <option value="" disabled>选择应用</option>
            <option v-if="appsLoaded && step.appId && !apps.some((app) => app.id === step.appId)" :value="step.appId" disabled>原应用已删除，请重新选择</option>
            <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
          </select>

          <div v-else-if="step.type === 'file'" class="workflow-path">
            <input v-model="step.path" placeholder="文件或文件夹路径" @input="delete stepErrors[index]" />
            <button class="ghost small" type="button" @click="choosePath(step, 'file')">选择文件</button>
            <button class="ghost small" type="button" @click="choosePath(step, 'directory')">选择文件夹</button>
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
const running = ref(null);
const runFeedback = ref(null);
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
  try {
    const picker = kind === 'file' ? workbench.system.selectFile : workbench.system.selectDirectory;
    const changed = await chooseWorkflowPath(step, picker, () => showModal.value && form.value.steps.includes(step));
    if (changed) stepErrors.value = {};
  } catch (error) {
    toast(error.message || '选择路径失败', 'error');
  }
}

function addStep() {
  form.value.steps.push(makeStep('app'));
}

function normalizeWorkflow(item) {
  return { ...item, steps: Array.isArray(item.steps) ? item.steps : [] };
}

async function loadData() {
  try {
    workflows.value = (await workbench.workflows.list()).map(normalizeWorkflow);
  } catch (error) {
    toast(error.message, 'error');
  }
  try {
    apps.value = await workbench.apps.list();
    appsLoaded.value = true;
  } catch (error) {
    appsLoaded.value = false;
    toast(error.message, 'error');
  }
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
    await loadData();
    showModal.value = false;
    editingWorkflow.value = null;
    toast('工作流已保存');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function runWorkflow(workflow) {
  if (running.value) return;
  running.value = workflow.id;
  runFeedback.value = null;
  try {
    const result = await workbench.workflows.runDetailed(workflow.id);
    if (mounted) runFeedback.value = { name: workflow.name, result, error: '' };
  } catch (error) {
    if (mounted) runFeedback.value = { name: workflow.name, result: null, error: error.message || '执行失败' };
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
.workflow-path input { min-width: 0; flex: 1; }
.workflow-path button { white-space: nowrap; }
.workflow-step__legacy { color: var(--warning); font-size: 12px; }
@media (max-width: 680px) { .workflow-step .step-row { grid-template-columns: 20px 1fr 108px; } .workflow-step .step-row > :nth-child(3) { grid-column: 2 / 4; grid-row: 2; } .workflow-path { flex-wrap: wrap; } }
</style>
