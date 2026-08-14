<template>
  <div class="view todos-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / TASKS</p>
        <h1>{{ activeTab === 'todos' ? '今日待办' : '长期目标' }}</h1>
        <p>{{ activeTab === 'todos' ? '整理今天要做的事，保持清晰、专注。' : '制定长期目标，设置期限并持续追踪进度。' }}</p>
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
