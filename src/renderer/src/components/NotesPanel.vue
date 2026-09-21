<template>
  <section class="panel notes-panel">
    <div class="panel-head">
      <div>
        <h2>便签笔记</h2>
        <p>Markdown 快速记事，内容保存在本地 JSON。</p>
      </div>
      <button class="primary" type="button" @click="createNote">新建便签</button>
    </div>

    <div class="notes-layout">
      <aside class="notes-list">
        <button
          v-for="note in notes"
          :key="note.id"
          class="note-list-item"
          :class="{ active: selectedId === note.id }"
          type="button"
          @click="selectNote(note)"
        >
          <strong>{{ note.title }}</strong>
          <span>{{ note.updatedAt ? new Date(note.updatedAt).toLocaleString('zh-CN') : '' }}</span>
        </button>
        <div v-if="!notes.length" class="empty-state small"><p>还没有便签。</p></div>
      </aside>

      <div v-if="selected" class="note-editor">
        <input v-model="selected.title" class="note-title" placeholder="便签标题" @change="saveSelected" />
        <div class="note-mode-tabs">
          <button :class="{ active: mode === 'edit' }" type="button" @click="mode = 'edit'">编辑</button>
          <button :class="{ active: mode === 'preview' }" type="button" @click="mode = 'preview'">预览</button>
          <span class="note-spacer"></span>
          <button class="icon-button danger" type="button" @click="removeSelected">🗑</button>
        </div>
        <textarea v-if="mode === 'edit'" v-model="selected.content" class="note-content" placeholder="支持 Markdown：标题、列表、粗体、代码块…" @input="scheduleSave"></textarea>
        <MarkdownRenderer v-else class="note-preview" :content="selected.content" />
      </div>
      <div v-else class="empty-state"><div class="empty-icon"><LineIcon name="note" :size="30" /></div><p>选择或新建一条便签。</p></div>
    </div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const notes = ref([]);
const selectedId = ref(null);
const selected = ref(null);
const mode = ref('edit');
let saveTimer = null;

async function loadNotes() {
  notes.value = await workbench.files.notes.list();
  if (!selected.value && notes.value.length) {
    selectNote(notes.value[0]);
  }
}

/** 把待保存的防抖内容立刻落盘 */
async function flushPendingSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await saveSelected();
}

async function selectNote(note) {
  // 修复 P1-2：切换便签前先把 500ms 防抖中的输入存下来，否则会丢最后一段输入
  if (selected.value && selected.value.id !== note.id) {
    await flushPendingSave();
  }
  selectedId.value = note.id;
  selected.value = notes.value.find((item) => item.id === note.id) || note;
  mode.value = 'edit';
}

async function createNote() {
  try {
    const note = await workbench.files.notes.create({ title: '无标题便签', content: '' });
    notes.value = [note, ...notes.value];
    selectNote(note);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSelected, 500);
}

async function saveSelected() {
  if (!selected.value) return;
  try {
    const note = await workbench.files.notes.update(selected.value.id, {
      title: selected.value.title,
      content: selected.value.content
    });
    const index = notes.value.findIndex((item) => item.id === note.id);
    if (index !== -1) notes.value[index] = note;
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeSelected() {
  if (!selected.value) return;
  if (!window.confirm(`确定删除「${selected.value.title}」吗？`)) return;
  try {
    notes.value = await workbench.files.notes.remove(selected.value.id);
    selected.value = notes.value[0] || null;
    selectedId.value = selected.value ? selected.value.id : null;
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(loadNotes);

// 修复 P1-2：组件卸载（切换 tab / 切页面）时把未保存内容写回
onBeforeUnmount(() => {
  flushPendingSave();
});
</script>
