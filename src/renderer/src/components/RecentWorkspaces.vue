<template>
  <article class="widget-card recent-workspaces">
    <header class="widget-card-head">
      <span>最近工作空间</span>
      <button class="ghost small" type="button" @click="$emit('go-workspace')">全部</button>
    </header>

    <div class="widget-card-body">
      <div v-if="loading" class="empty-state small"><p>正在加载…</p></div>

      <div v-else-if="!items.length" class="empty-state small">
        <p>还没有工作空间。到「工作空间」创建一个，就能在这里一键继续。</p>
      </div>

      <ul v-else class="recent-workspaces__list">
        <li v-for="item in items" :key="item.id">
          <span class="recent-workspaces__dot" :style="{ background: item.color || 'var(--border-strong)' }"></span>
          <div class="recent-workspaces__info">
            <strong>{{ item.name }}</strong>
            <span>
              未完成 {{ item.pendingTodoCount || 0 }}
              <template v-if="item.lastWorkedAt"> · 最近工作 {{ formatRelative(item.lastWorkedAt) }}</template>
              <template v-else> · 还没有工作记录</template>
            </span>
          </div>
          <button class="ghost small" type="button" @click="$emit('open', item)">继续</button>
        </li>
      </ul>
    </div>
  </article>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { formatRelative } from '../utils/duration.js';

defineEmits(['open', 'go-workspace']);

const loading = ref(true);
const items = ref([]);

onMounted(async () => {
  try {
    items.value = await workbench.workspaces.recent(3);
  } catch (_) {
    items.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.recent-workspaces__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-workspaces__list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius-xs);
  transition: 0.16s ease;
}

.recent-workspaces__list li:hover {
  background: var(--surface-muted);
}

.recent-workspaces__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.recent-workspaces__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-workspaces__info strong {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-workspaces__info span {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-workspaces__list button {
  flex: 0 0 auto;
}
</style>
