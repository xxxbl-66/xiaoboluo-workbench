<template>
  <div class="view workflow-view">
    <header class="view-header">
      <p class="view-kicker">TOOLS / WORKFLOW</p>
      <h1>工作环境</h1>
      <p>工作流按顺序打开应用、文件和网页；工作时间由工作空间中的 Session 单独记录。</p>
    </header>
    <WorkflowPanel />
    <AppLauncher />
  </div>
</template>

<script setup>
import WorkflowPanel from '../components/WorkflowPanel.vue';
import AppLauncher from '../components/AppLauncher.vue';
</script>

<style scoped>
.workflow-view { display: flex; flex-direction: column; gap: 16px; }
.workflow-view .view-header { margin-bottom: 0; }
</style>
