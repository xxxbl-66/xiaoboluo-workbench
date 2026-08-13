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
          <span>{{ workflow.steps.length }} 个步骤</span>
        </div>
        <div class="workflow-actions">
          <button class="ghost small" type="button" @click="runWorkflow(workflow)">运行</button>
          <button class="icon-button" type="button" @click="openEdit(workflow)">✎</button>
          <button class="icon-button danger" type="button" @click="removeWorkflow(workflow)">🗑</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state small">
      <p>还没有工作流，创建一个试试。</p>
    </div>

    <Modal v-model="showModal" :title="editingWorkflow ? '编辑工作流' : '新建工作流'" width="620px" @close="closeModal">
      <label>
        工作流名称
        <input v-model="form.name" placeholder="例如：开始一天" />
      </label>

      <div class="steps-editor">
        <div class="steps-title">执行步骤</div>
        <div v-for="(step, index) in form.steps" :key="step.id" class="step-row">
          <select v-model="step.type">
            <option value="app">启动应用</option>
            <option value="file">打开文件</option>
            <option value="url">打开网页</option>
          </select>

          <select v-if="step.type === 'app'" v-model="step.appId">
            <option value="" disabled>选择应用</option>
            <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
          </select>

          <input v-else-if="step.type === 'file'" v-model="step.path" placeholder="文件路径" />
          <input v-else v-model="step.url" placeholder="https://…" />

          <button class="icon-button danger" type="button" @click="form.steps.splice(index, 1)">×</button>
        </div>
        <button class="ghost small" type="button" @click="addStep">＋ 添加步骤</button>
      </div>

      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" @click="saveWorkflow">保存</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const workflows = ref([]);
const apps = ref([]);
const showModal = ref(false);
const editingWorkflow = ref(null);
const form = ref({ name: '', steps: [] });
let stepSeed = 0;

function makeStep(type = 'app') {
  return { id: `step-${Date.now()}-${++stepSeed}`, type, appId: '', path: '', url: '' };
}

function openCreate() {
  editingWorkflow.value = null;
  form.value = { name: '', steps: [makeStep('app')] };
  showModal.value = true;
}

function openEdit(workflow) {
  editingWorkflow.value = workflow;
  form.value = {
    name: workflow.name,
    steps: (workflow.steps || []).map((item) => ({ ...item }))
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingWorkflow.value = null;
}

function addStep() {
  form.value.steps.push(makeStep('app'));
}

async function loadData() {
  workflows.value = await workbench.workflows.list();
  apps.value = await workbench.apps.list();
}

async function saveWorkflow() {
  try {
    const payload = {
      name: form.value.name,
      steps: form.value.steps.filter((step) => {
        if (step.type === 'app') return step.appId;
        if (step.type === 'file') return step.path;
        return step.url;
      })
    };
    if (!payload.name.trim()) throw new Error('请输入工作流名称');
    if (!payload.steps.length) throw new Error('至少添加一个步骤');
    if (editingWorkflow.value) {
      await workbench.workflows.update(editingWorkflow.value.id, payload);
    } else {
      await workbench.workflows.create(payload);
    }
    await loadData();
    closeModal();
    toast('工作流已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function runWorkflow(workflow) {
  try {
    await workbench.workflows.run(workflow.id);
    toast(`已运行「${workflow.name}」`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeWorkflow(workflow) {
  if (!window.confirm(`确定删除工作流“${workflow.name}”吗？`)) return;
  workflows.value = await workbench.workflows.remove(workflow.id);
}

onMounted(loadData);
</script>
