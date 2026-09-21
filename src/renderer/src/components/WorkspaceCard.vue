<template>
  <article class="workspace-card" :class="{ archived }" :style="{ '--ws-color': workspace.color || '#3b82f6' }">
    <header class="workspace-card__head">
      <span class="workspace-card__badge">{{ initial }}</span>
      <div class="workspace-card__title">
        <strong>{{ workspace.name }}</strong>
        <p v-if="workspace.description">{{ workspace.description }}</p>
        <p v-else class="workspace-card__muted">还没有填写描述</p>
      </div>
      <span v-if="workspace.isWorking" class="workspace-card__live">正在工作</span>
      <span v-else-if="archived" class="workspace-card__archived">已归档</span>
    </header>

    <dl class="workspace-card__stats">
      <div>
        <dt>未完成</dt>
        <dd>{{ workspace.pendingTodoCount || 0 }}</dd>
      </div>
      <div>
        <dt>累计工作</dt>
        <dd>{{ formatDuration(workspace.totalSeconds || 0) }}</dd>
      </div>
      <div>
        <dt>最近打开</dt>
        <dd>{{ workspace.lastOpenedAt ? formatRelative(workspace.lastOpenedAt) : '从未打开' }}</dd>
      </div>
    </dl>

    <div class="workspace-card__actions">
      <button class="primary small" type="button" @click="$emit('open', workspace)">
        {{ archived ? '查看' : '进入' }}
      </button>
      <button class="ghost small" type="button" @click="$emit('edit', workspace)">编辑</button>
      <button
        v-if="!archived"
        class="ghost small"
        type="button"
        @click="$emit('archive', workspace)"
      >
        归档
      </button>
      <button v-else class="ghost small" type="button" @click="$emit('restore', workspace)">恢复</button>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { formatDuration, formatRelative } from '../utils/duration.js';

const props = defineProps({
  workspace: { type: Object, required: true }
});

defineEmits(['open', 'edit', 'archive', 'restore']);

const archived = computed(() => props.workspace.archived === true);
const initial = computed(() => {
  const name = String(props.workspace.name || '').trim();
  return name ? name.slice(0, 1) : '空';
});
</script>

<style scoped>
.workspace-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-left: 3px solid var(--ws-color);
  transition: 0.16s ease;
}

.workspace-card:hover {
  box-shadow: var(--shadow);
}

.workspace-card.archived {
  opacity: 0.72;
}

.workspace-card__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.workspace-card__badge {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 650;
  color: #ffffff;
  background: var(--ws-color);
  flex: 0 0 auto;
}

.workspace-card__title {
  min-width: 0;
  flex: 1 1 auto;
}

.workspace-card__title strong {
  display: block;
  font-size: 15px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-card__title p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.workspace-card__muted {
  color: var(--text-faint) !important;
}

.workspace-card__live,
.workspace-card__archived {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  font-weight: 600;
}

.workspace-card__live {
  background: var(--success-soft);
  color: var(--success);
}

.workspace-card__archived {
  background: var(--surface-muted);
  color: var(--text-muted);
}

.workspace-card__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.workspace-card__stats div {
  min-width: 0;
}

.workspace-card__stats dt {
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 3px;
}

.workspace-card__stats dd {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
