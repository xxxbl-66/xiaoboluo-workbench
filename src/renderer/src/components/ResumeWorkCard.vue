<template>
  <section v-if="session" class="resume-card panel">
    <header class="resume-card__head">
      <div>
        <p class="resume-card__kicker">上次做到哪里</p>
        <h2>
          {{ formatRelative(session.startedAt) }}
          <span class="resume-card__duration">{{ formatDuration(session.durationSeconds) }}</span>
        </h2>
      </div>
      <button class="primary" type="button" :disabled="busy" @click="$emit('resume')">
        <LineIcon name="play" :size="15" />
        {{ busy ? '正在恢复…' : '继续上次工作' }}
      </button>
    </header>

    <div class="resume-card__grid">
      <div class="resume-card__block">
        <span class="resume-card__label">上次完成</span>
        <ul v-if="completed.length" class="resume-card__list">
          <li v-for="todo in completed" :key="todo.id">
            <LineIcon name="check" :size="13" />
            <span>{{ todo.title }}</span>
          </li>
        </ul>
        <p v-else class="resume-card__empty">上次没有勾选完成的任务</p>
      </div>

      <div class="resume-card__block">
        <span class="resume-card__label">当前剩余</span>
        <ul v-if="remaining.length" class="resume-card__list resume-card__list--todo">
          <li v-for="todo in remaining" :key="todo.id">
            <span class="resume-card__box"></span>
            <span>{{ todo.title }}</span>
          </li>
        </ul>
        <p v-else class="resume-card__empty">这个工作空间没有未完成任务</p>
      </div>
    </div>

    <div class="resume-card__notes">
      <div>
        <span class="resume-card__label">上次备注</span>
        <p>{{ session.note || '（没有填写）' }}</p>
      </div>
      <div>
        <span class="resume-card__label">下一步</span>
        <p :class="{ 'resume-card__next--empty': !session.nextStep }">
          {{ session.nextStep || '（没有填写）' }}
        </p>
      </div>
    </div>
  </section>

  <section v-else class="resume-card resume-card--empty panel">
    <p class="resume-card__kicker">上次做到哪里</p>
    <p>这个工作空间还没有工作记录。点击「开始工作」记录第一次，之后就能一键接着继续。</p>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import LineIcon from './LineIcon.vue';
import { formatDuration, formatRelative } from '../utils/duration.js';

const props = defineProps({
  session: { type: Object, default: null },
  busy: { type: Boolean, default: false }
});

defineEmits(['resume']);

const completed = computed(() => (
  props.session && Array.isArray(props.session.completedTodos) ? props.session.completedTodos : []
));
const remaining = computed(() => (
  props.session && Array.isArray(props.session.remainingTodos) ? props.session.remainingTodos : []
));
</script>

<style scoped>
.resume-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.resume-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.resume-card__head .primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.resume-card__kicker {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-faint);
}

.resume-card__head h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.resume-card__duration {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-muted);
  padding: 3px 10px;
  border-radius: 999px;
}

.resume-card__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.resume-card__block {
  min-width: 0;
}

.resume-card__label {
  display: block;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 7px;
}

.resume-card__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.resume-card__list li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text);
  min-width: 0;
}

.resume-card__list li span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resume-card__list li :deep(.line-icon) {
  color: var(--success);
  flex: 0 0 auto;
}

.resume-card__box {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1.5px solid var(--border-strong);
  flex: 0 0 auto;
}

.resume-card__empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}

.resume-card__notes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.resume-card__notes p {
  margin: 0;
  font-size: 13px;
  color: var(--text);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.resume-card__next--empty {
  color: var(--text-faint);
}

.resume-card--empty p:last-child {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.7;
}
</style>
