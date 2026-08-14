<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>本地建议</h2>
        <p>基于你的待办和使用习惯生成，不会上传数据。</p>
      </div>
    </div>

    <div v-if="suggestions.length" class="suggestion-list">
      <button
        v-for="item in suggestions"
        :key="item.id"
        class="suggestion-card"
        type="button"
        @click="$emit('go-todos')"
      >
        <span class="suggestion-icon"><LineIcon :name="item.icon" :size="18" /></span>
        <span>{{ item.text }}</span>
      </button>
    </div>
    <div v-else class="empty-state small">
      <p>暂时没有建议。</p>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';

defineEmits(['go-todos']);

const apps = ref([]);
const todos = ref([]);
const goals = ref([]);

const suggestions = computed(() => {
  const items = [];
  const pending = todos.value.filter((item) => !item.completed).length;
  if (pending) items.push({ id: 'todo', icon: 'todos', text: `今天还有 ${pending} 项待办未完成` });

  const ongoing = goals.value.filter((item) => item.progress < 100).length;
  if (ongoing) items.push({ id: 'goal', icon: 'review', text: `还有 ${ongoing} 个长期目标正在推进` });

  const launched = apps.value
    .filter((item) => item.launchCount > 0)
    .sort((a, b) => b.launchCount - a.launchCount)
    .slice(0, 3);
  for (const app of launched) {
    items.push({ id: `app-${app.id}`, icon: 'app', text: `你最近常打开「${app.name}」` });
  }

  if (!items.length) {
    items.push({ id: 'welcome', icon: 'dashboard', text: '添加应用或创建待办后，这里会出现建议。' });
  }
  return items.slice(0, 5);
});

onMounted(async () => {
  try {
    const [appList, todoList, goalList] = await Promise.all([
      workbench.apps.list(),
      workbench.todos.list(),
      workbench.goals.list()
    ]);
    apps.value = appList;
    todos.value = todoList;
    goals.value = goalList;
  } catch (_) {}
});
</script>
