<template>
  <div class="quick-note-widget">
    <textarea
      v-model="quickContent"
      class="quick-note-input"
      placeholder="随手记点什么…"
      spellcheck="false"
    ></textarea>
    <div class="quick-note-status" :class="{ saving }">{{ saving ? '保存中…' : '已保存' }}</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { workbench } from '../composables/useWorkbench.js';

const quickContent = ref('');
const saving = ref(false);
let saveTimer = null;

async function loadQuickNote() {
  try {
    const note = await workbench.files.notes.getQuick();
    quickContent.value = note.content || '';
  } catch (_) {}
}

watch(quickContent, (value) => {
  if (saveTimer) clearTimeout(saveTimer);
  saving.value = true;
  saveTimer = setTimeout(async () => {
    try {
      await workbench.files.notes.saveQuick(value);
    } finally {
      saving.value = false;
    }
  }, 450);
});

onMounted(loadQuickNote);

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    if (quickContent.value) workbench.files.notes.saveQuick(quickContent.value).catch(() => {});
  }
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
</style>