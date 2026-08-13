<template>
  <div class="view todos-view">
    <header class="view-header">
      <div>
        <h1>待办与目标</h1>
        <p>管理每日任务和长期目标进度。</p>
      </div>
    </header>

    <div class="segmented-tabs">
      <button :class="{ active: activeTab === 'todos' }" type="button" @click="activeTab = 'todos'">每日待办</button>
      <button :class="{ active: activeTab === 'goals' }" type="button" @click="activeTab = 'goals'">长期目标</button>
    </div>

    <TodoPanel v-if="activeTab === 'todos'" />
    <GoalPanel v-else />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import TodoPanel from '../components/TodoPanel.vue';
import GoalPanel from '../components/GoalPanel.vue';

const activeTab = ref('todos');
</script>
