<template>
  <Modal :model-value="modelValue" :title="`关联已有${typeLabel}`" width="560px" @close="$emit('close')">
    <div class="link-modal">
      <p class="link-modal__hint">
        {{ hint }}
      </p>

      <div v-if="loading" class="empty-state small"><p>正在加载…</p></div>

      <div v-else-if="!items.length" class="empty-state small">
        <p>{{ emptyText }}</p>
      </div>

      <ul v-else class="link-modal__list">
        <li v-for="item in items" :key="item.id">
          <div class="link-modal__info">
            <strong>{{ item.title }}</strong>
            <span v-if="item.meta">{{ item.meta }}</span>
          </div>
          <span v-if="item.owner" class="link-modal__owner">属于 {{ item.owner }}</span>
          <button class="ghost small" type="button" @click="choose(item)">
            {{ item.owner ? '移动到当前工作空间' : '关联' }}
          </button>
        </li>
      </ul>
    </div>

    <template #footer>
      <button class="ghost" type="button" @click="$emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 'todo' | 'goal' | 'note' | 'bookmark' | 'app' | 'favorite' */
  kind: { type: String, required: true },
  workspaceId: { type: String, required: true },
  /** 当前所有工作空间，用于提示"该项目当前属于 X" */
  workspaces: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'linked']);

const loading = ref(false);
const items = ref([]);

const typeLabel = computed(() => ({
  todo: '待办',
  goal: '长期目标',
  note: '便签',
  bookmark: '收藏',
  app: '快捷应用',
  favorite: '文件'
}[props.kind] || '项目'));

const hint = computed(() => {
  if (props.kind === 'favorite') {
    return '同一路径可以在不同工作空间分别收藏；这里只关联当前未被归类的文件收藏。';
  }
  return '关联只是把归属改成当前工作空间，不会复制内容。原本属于其他工作空间的项目会一并移动。';
});

const emptyText = computed(() => {
  if (props.kind === 'favorite') return '没有可关联的文件收藏，可以先在「文件 → 收藏」里添加。';
  if (props.kind === 'app') return '没有可关联的快捷应用，可以先在「驾驶舱 → 快捷应用」里添加。';
  return `没有可关联的${typeLabel.value}。`;
});

function ownerName(workspaceId) {
  if (!workspaceId) return '';
  const found = props.workspaces.find((item) => item.id === workspaceId);
  return found ? found.name : '';
}

function normalize(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

async function load() {
  loading.value = true;
  try {
    const current = props.workspaceId;
    let rows = [];

    if (props.kind === 'todo') {
      rows = (await workbench.todos.list()).map((item) => ({
        id: item.id,
        title: item.title,
        meta: item.completed ? '已完成' : '未完成',
        workspaceId: item.workspaceId
      }));
    } else if (props.kind === 'goal') {
      rows = (await workbench.goals.list()).map((item) => ({
        id: item.id,
        title: item.title,
        meta: item.targetDate ? `期限 ${item.targetDate}` : '',
        workspaceId: item.workspaceId
      }));
    } else if (props.kind === 'note') {
      rows = (await workbench.files.notes.list()).map((item) => ({
        id: item.id,
        title: item.title || '无标题便签',
        meta: item.type === 'quick' ? '快速便签' : '',
        workspaceId: item.workspaceId
      }));
    } else if (props.kind === 'bookmark') {
      rows = (await workbench.bookmarks.list()).map((item) => ({
        id: item.id,
        title: item.title || item.url,
        meta: item.url,
        workspaceId: item.workspaceId
      }));
    } else if (props.kind === 'app') {
      rows = (await workbench.apps.list()).map((item) => ({
        id: item.id,
        title: item.name,
        meta: item.groupId ? `分组 ${item.groupId}` : '',
        workspaceId: item.workspaceId
      }));
    } else if (props.kind === 'favorite') {
      rows = (await workbench.files.favorites.list()).map((item) => ({
        id: item.id,
        title: item.name,
        meta: item.type === 'folder' ? '文件夹' : '文件',
        workspaceId: item.workspaceId
      }));
    }

    items.value = rows
      .filter((row) => normalize(row.workspaceId) !== current)
      .map((row) => ({ ...row, owner: ownerName(normalize(row.workspaceId)) }));
  } catch (error) {
    toast(error.message, 'error');
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function choose(item) {
  const prompt = item.owner
    ? `「${item.title}」当前属于「${item.owner}」，移动到当前工作空间？`
    : `把「${item.title}」关联到当前工作空间？`;
  if (!window.confirm(prompt)) return;

  try {
    await workbench.workspaces.linkResource({
      kind: props.kind,
      id: item.id,
      workspaceId: props.workspaceId
    });
    toast('已关联到当前工作空间');
    items.value = items.value.filter((row) => row.id !== item.id);
    emit('linked');
  } catch (error) {
    toast(error.message, 'error');
  }
}

watch(
  () => [props.modelValue, props.kind, props.workspaceId],
  () => {
    if (props.modelValue) load();
  },
  { immediate: true }
);
</script>

<style scoped>
.link-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-modal__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.link-modal__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
}

.link-modal__list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-muted);
}

.link-modal__info {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.link-modal__info strong {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-modal__info span {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-modal__owner {
  font-size: 11px;
  color: var(--warning);
  background: var(--warning-soft);
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
</style>
