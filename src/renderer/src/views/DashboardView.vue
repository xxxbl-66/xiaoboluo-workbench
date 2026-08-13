<template>
  <div class="view dashboard-view">
    <DashboardWelcome class="dashboard-welcome" />
    <AppLauncher class="dashboard-apps" />
    <div class="dashboard-side">
      <TodayTodos @go-todos="$emit('navigate', 'todos')" />
      <SuggestionPanel @go-todos="$emit('navigate', 'todos')" />
    </div>
    <WorkflowPanel class="dashboard-workflows" />
  </div>
</template>

<script setup>
import DashboardWelcome from '../components/DashboardWelcome.vue';
import AppLauncher from '../components/AppLauncher.vue';
import TodayTodos from '../components/TodayTodos.vue';
import SuggestionPanel from '../components/SuggestionPanel.vue';
import WorkflowPanel from '../components/WorkflowPanel.vue';

defineEmits(['navigate']);
</script>
