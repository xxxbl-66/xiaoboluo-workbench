<template>
  <section class="ws-resources">
    <div class="segmented-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="{ active: activeTab === tab.id }"
        type="button"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}<span v-if="counts[tab.id]" class="ws-resources__count">{{ counts[tab.id] }}</span>
      </button>
    </div>

    <div class="ws-resources__body">
      <div v-if="loading" class="empty-state small"><p>正在加载…</p></div>

      <template v-else>
        <div v-if="!rows.length" class="empty-state small">
          <p>{{ emptyText }}</p>
        </div>

        <ul v-else class="ws-resources__list">
          <li v-for="row in rows" :key="row.id" :class="{ missing: row.missing }">
            <span class="ws-resources__icon">
              <LineIcon :name="row.icon" :size="18" />
            </span>

            <div class="ws-resources__info">
              <strong>{{ row.title }}</strong>
              <span v-if="row.meta">{{ row.meta }}</span>
              <span v-if="row.missing" class="ws-resources__warn">路径不存在</span>
            </div>

            <div class="ws-resources__actions">
              <button
                v-if="row.openable"
                class="ghost small"
                type="button"
                :disabled="row.missing"
                @click="openRow(row)"
              >
                打开
              </button>
              <button class="ghost small" type="button" @click="unlink(row)">解除关联</button>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <div class="ws-resources__footer">
      <button class="ghost small" type="button" @click="showLink = true">＋ 关联已有{{ currentTabLabel }}</button>
      <button v-if="activeTab === 'favorite'" class="ghost small" type="button" @click="addFavorite">
        ＋ 收藏文件 / 文件夹
      </button>
      <button v-if="activeTab === 'app'" class="ghost small" type="button" @click="addApp">
        ＋ 添加应用
      </button>
      <button v-if="activeTab === 'note'" class="ghost small" type="button" @click="openNoteForm">
        ＋ 在本工作空间新建便签
      </button>
      <button v-if="activeTab === 'bookmark'" class="ghost small" type="button" @click="openBookmarkForm">
        ＋ 在本工作空间新建收藏
      </button>
    </div>

    <WorkspaceLinkModal
      v-model="showLink"
      :kind="activeTab"
      :workspace-id="workspaceId"
      :workspaces="workspaces"
      @close="showLink = false"
      @linked="reload"
    />

    <Modal v-model="showNoteForm" title="新建便签" width="520px" @close="showNoteForm = false">
      <div class="ws-resources__form">
        <label class="full">
          标题
          <input v-model="noteForm.title" placeholder="便签标题" />
        </label>
        <label class="full">
          内容
          <textarea v-model="noteForm.content" rows="6" placeholder="支持 Markdown"></textarea>
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="showNoteForm = false">取消</button>
        <button class="primary" type="button" @click="saveNote">保存</button>
      </template>
    </Modal>

    <Modal v-model="showBookmarkForm" title="新建收藏" width="520px" @close="showBookmarkForm = false">
      <div class="ws-resources__form">
        <label class="full">
          标题
          <input v-model="bookmarkForm.title" placeholder="收藏标题" />
        </label>
        <label class="full">
          链接
          <input v-model="bookmarkForm.url" placeholder="https://" />
        </label>
        <label class="full">
          备注
          <input v-model="bookmarkForm.note" placeholder="可选" />
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="showBookmarkForm = false">取消</button>
        <button class="primary" type="button" @click="saveBookmark">保存</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import LineIcon from './LineIcon.vue';
import Modal from './Modal.vue';
import WorkspaceLinkModal from './WorkspaceLinkModal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  workspaces: { type: Array, default: () => [] }
});

const emit = defineEmits(['changed', 'go-todos']);

const tabs = [
  { id: 'todo', label: '待办' },
  { id: 'goal', label: '长期目标' },
  { id: 'favorite', label: '文件' },
  { id: 'note', label: '便签' },
  { id: 'bookmark', label: '收藏' },
  { id: 'app', label: '快捷应用' }
];

const activeTab = ref('favorite');
const loading = ref(true);
const rows = ref([]);
const counts = ref({});
const showLink = ref(false);
const showNoteForm = ref(false);
const showBookmarkForm = ref(false);
const noteForm = ref({ title: '', content: '' });
const bookmarkForm = ref({ title: '', url: '', note: '' });

const currentTabLabel = computed(() => (tabs.find((tab) => tab.id === activeTab.value) || {}).label || '');

const emptyText = computed(() => {
  if (activeTab.value === 'favorite') return '这个工作空间还没有关联文件，点下面的按钮收藏文件或文件夹。';
  if (activeTab.value === 'app') return '这个工作空间还没有关联快捷应用。';
  return `这个工作空间还没有关联${currentTabLabel.value}。`;
});

function normalize(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function inScope(item) {
  return normalize(item.workspaceId) === props.workspaceId;
}

async function load() {
  loading.value = true;
  try {
    const [todos, goals, favorites, notes, bookmarks, apps] = await Promise.all([
      workbench.todos.list(),
      workbench.goals.list(),
      workbench.files.favorites.list(),
      workbench.files.notes.list(),
      workbench.bookmarks.list(),
      workbench.apps.list()
    ]);

    const scoped = {
      todo: todos.filter(inScope),
      goal: goals.filter(inScope),
      favorite: favorites.filter(inScope),
      note: notes.filter(inScope),
      bookmark: bookmarks.filter(inScope),
      app: apps.filter(inScope)
    };

    counts.value = Object.fromEntries(Object.entries(scoped).map(([key, list]) => [key, list.length]));

    // 路径预检：失效的应用/文件灰显并提示，避免演示时点开才发现失败
    const paths = [
      ...scoped.app.map((item) => item.path),
      ...scoped.favorite.map((item) => item.path)
    ].filter(Boolean);
    let exists = {};
    if (paths.length) {
      try {
        exists = await workbench.system.pathExistsBatch(paths);
      } catch (_) {
        exists = {};
      }
    }

    const builders = {
      todo: (item) => ({
        id: item.id,
        icon: 'todos',
        title: item.title,
        meta: item.completed ? '已完成' : '未完成',
        openable: false
      }),
      goal: (item) => ({
        id: item.id,
        icon: 'review',
        title: item.title,
        meta: item.targetDate ? `期限 ${item.targetDate}` : '',
        openable: false
      }),
      favorite: (item) => ({
        id: item.id,
        icon: item.type === 'folder' ? 'folder' : 'file',
        title: item.name,
        meta: item.path,
        path: item.path,
        openable: true
      }),
      note: (item) => ({
        id: item.id,
        icon: 'note',
        title: item.title || '无标题便签',
        meta: (item.content || '').replace(/\s+/g, ' ').slice(0, 60),
        openable: false
      }),
      bookmark: (item) => ({
        id: item.id,
        icon: 'bookmarks',
        title: item.title || item.url,
        meta: item.url,
        url: item.url,
        openable: true
      }),
      app: (item) => ({
        id: item.id,
        icon: 'app',
        title: item.name,
        meta: `${item.path}${item.groupId ? ` · ${item.groupId}` : ''}`,
        path: item.path,
        openable: true
      })
    };

    rows.value = scoped[activeTab.value].map((item) => {
      const row = builders[activeTab.value](item);
      if (row.path) row.missing = exists[row.path] === false;
      return row;
    });
  } catch (error) {
    toast(error.message, 'error');
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

function reload() {
  load();
  emit('changed');
}

async function openRow(row) {
  try {
    if (activeTab.value === 'app') {
      await workbench.apps.launch(row.id);
    } else if (activeTab.value === 'bookmark') {
      await workbench.system.openExternal(row.url);
    } else {
      await workbench.files.open(row.path);
    }
  } catch (error) {
    toast(error.message || '打开失败', 'error');
  }
}

async function unlink(row) {
  try {
    await workbench.workspaces.linkResource({
      kind: activeTab.value,
      id: row.id,
      workspaceId: null
    });
    toast('已解除关联，项目本身仍然保留');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addFavorite() {
  try {
    const filePath = await workbench.system.selectFile();
    if (!filePath) return;
    await workbench.files.favorites.add(filePath, props.workspaceId);
    toast('已收藏到当前工作空间');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addApp() {
  try {
    const filePath = await workbench.system.selectApp();
    if (!filePath) return;
    await workbench.apps.add(filePath, { workspaceId: props.workspaceId });
    toast('已添加到当前工作空间');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openNoteForm() {
  noteForm.value = { title: '', content: '' };
  showNoteForm.value = true;
}

async function saveNote() {
  try {
    const title = noteForm.value.title.trim();
    if (!title) throw new Error('请输入便签标题');
    await workbench.files.notes.create({
      title,
      content: noteForm.value.content,
      workspaceId: props.workspaceId
    });
    showNoteForm.value = false;
    toast('便签已创建');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openBookmarkForm() {
  bookmarkForm.value = { title: '', url: '', note: '' };
  showBookmarkForm.value = true;
}

async function saveBookmark() {
  try {
    const url = bookmarkForm.value.url.trim();
    if (!url) throw new Error('请输入链接');
    await workbench.bookmarks.create({
      title: bookmarkForm.value.title.trim() || url,
      url,
      note: bookmarkForm.value.note,
      workspaceId: props.workspaceId
    });
    showBookmarkForm.value = false;
    toast('收藏已创建');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

watch(activeTab, load);
watch(() => props.workspaceId, load);
watch(showLink, (value) => {
  if (!value) reload();
});

load();
</script>

<style scoped>
.ws-resources {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ws-resources__count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}

.ws-resources__body {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-height: 130px;
  padding: 6px;
}

.ws-resources__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.ws-resources__list li {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border-radius: var(--radius-xs);
  transition: 0.16s ease;
}

.ws-resources__list li:hover {
  background: var(--surface-muted);
}

.ws-resources__list li.missing {
  opacity: 0.55;
}

.ws-resources__icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--surface-muted);
  color: var(--text-muted);
  flex: 0 0 auto;
}

.ws-resources__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ws-resources__info strong {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-resources__info span {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-resources__warn {
  color: var(--warning) !important;
}

.ws-resources__actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.ws-resources__footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ws-resources__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ws-resources__form .full {
  width: 100%;
}
</style>
