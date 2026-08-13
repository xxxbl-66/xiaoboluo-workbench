<template>
  <section class="welcome-banner">
    <div>
      <p class="welcome-eyebrow">{{ dateLabel }}</p>
      <h1>你好，{{ user.name }}</h1>
      <p class="welcome-sub">今天也按自己的节奏推进吧。</p>
    </div>
    <div class="welcome-stats">
      <div class="welcome-stat">
        <strong>{{ pendingTodos }}</strong>
        <span>待办未完成</span>
      </div>
      <div class="welcome-stat">
        <strong>{{ checkin.streak }}</strong>
        <span>连续打卡</span>
      </div>
      <div class="welcome-stat">
        <strong>{{ books }}</strong>
        <span>书架藏书</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';

const user = ref({ name: '小菠萝' });
const checkin = ref({ streak: 0 });
const pendingTodos = ref(0);
const books = ref(0);

const dateLabel = computed(() => {
  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 周${week}`;
});

onMounted(async () => {
  try {
    const [settings, checkinData, todos, bookList] = await Promise.all([
      workbench.settings.get(),
      workbench.checkins.get(),
      workbench.todos.list(),
      workbench.books.list()
    ]);
    user.value = { name: settings.user?.name || '小菠萝' };
    checkin.value = checkinData;
    pendingTodos.value = todos.filter((item) => !item.completed).length;
    books.value = bookList.length;
  } catch (_) {}
});
</script>
