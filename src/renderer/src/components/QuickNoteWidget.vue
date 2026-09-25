<template>
  <div class="quick-note-widget">
    <textarea
      v-model="quickContent"
      class="quick-note-input"
      placeholder="随手记点什么…"
      spellcheck="false"
    ></textarea>
    <div class="quick-note-status" :class="statusClass">
      {{ statusText }}
      <button v-if="status === 'error'" class="quick-note-retry" type="button" @click="retry">重试保存</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { createQuickNoteSaver, normalizeQuickNoteContent } from '../composables/quick-note.js';

const quickContent = ref('');
const status = ref('idle');
const errorMessage = ref('');
let loaded = false;

/**
 * 保存控制器负责全部"要不要保存"的判断：
 * 空字符串是合法内容，是否保存只看有没有未保存变更。
 */
const saver = createQuickNoteSaver({
  getContent: () => quickContent.value,
  save: (content) => workbench.files.notes.saveQuick(content),
  onStatusChange: (next) => {
    status.value = next.status;
    errorMessage.value = next.error;
  }
});

const statusClass = computed(() => ({
  saving: status.value === 'saving' || status.value === 'pending',
  error: status.value === 'error'
}));

const statusText = computed(() => {
  if (status.value === 'error') return errorMessage.value || '保存失败';
  if (status.value === 'saving') return '保存中…';
  if (status.value === 'pending') return '有未保存的修改…';
  return '已保存';
});

async function loadQuickNote() {
  let loadedContent = '';
  try {
    const note = await workbench.files.notes.getQuick();
    loadedContent = normalizeQuickNoteContent(note && note.content);
  } catch (_) {
    // 读取失败时保持空白，后续输入仍然可以保存
  }
  if (quickContent.value === '' && saver.revision === 0) {
    quickContent.value = loadedContent;
  }
  // 载入赋值不产生"未保存变更"；用户真正输入过的内容也不会被覆盖
  saver.clearTimer();
  loaded = true;
}

watch(quickContent, () => {
  if (!loaded) return;
  saver.markChanged();
});

async function retry() {
  const result = await saver.flush();
  if (result && result.ok) toast('便签已保存');
  else toast((result && result.error) || '便签保存失败', 'error');
}

onMounted(loadQuickNote);

onBeforeUnmount(() => {
  // 只要有未保存变更就立刻写盘，内容为空字符串同样要写。
  // 慢请求返回时由控制器比对 revision，过期响应不会覆盖更新的内容。
  const pending = saver.flushWithRetry();
  if (pending && typeof pending.catch === 'function') pending.catch(() => {});
});
</script>

<style scoped>
.quick-note-input {
  width: 100%;
  min-height: 104px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
  outline: none;
}

.quick-note-input:focus {
  border-color: var(--primary);
}

.quick-note-status {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-faint);
}

.quick-note-status.saving {
  color: var(--text-muted);
}

.quick-note-status.error {
  color: var(--danger);
}

.quick-note-retry {
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 11px;
}
</style>
