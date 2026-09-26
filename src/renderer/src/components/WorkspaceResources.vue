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

    <input v-model="search" class="ws-resources__search" type="search" :placeholder="`搜索当前${currentTabLabel}`" :aria-label="`搜索当前${currentTabLabel}`" />

    <div class="ws-resources__body">
      <div v-if="loading" class="empty-state small"><p>正在加载…</p></div>

      <template v-else>
        <div v-if="!filteredRows.length" class="empty-state small">
          <p>{{ rows.length ? '没有匹配的资源，请试试其他关键词。' : emptyText }}</p>
        </div>

        <ul v-else class="ws-resources__list">
          <li v-for="row in filteredRows" :key="row.id" :class="{ missing: row.missing }">
            <span class="ws-resources__icon">
              <LineIcon :name="row.icon" :size="18" />
            </span>

            <div class="ws-resources__info">
              <strong>{{ row.title }}</strong>
              <span v-if="row.meta">{{ row.meta }}</span>
              <span v-if="row.missing" class="ws-resources__warn">路径失效</span>
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
              <button v-if="activeTab === 'favorite' && !row.missing" class="ghost small" type="button" @click="revealRow(row)">定位</button>
              <button v-if="activeTab === 'bookmark' && !archived" class="ghost small" type="button" @click="openBookmarkEdit(row)">编辑</button>
              <button v-if="!archived" class="ghost small" type="button" @click="unlink(row)">解除关联</button>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <div v-if="!archived" class="ws-resources__footer">
      <button class="ghost small" type="button" @click="showLink = true">＋ 关联已有{{ currentTabLabel }}</button>
      <button v-if="activeTab === 'favorite'" class="ghost small" type="button" @click="addFavorite('file')">
        ＋ 选择文件
      </button>
      <button v-if="activeTab === 'favorite'" class="ghost small" type="button" @click="addFavorite('folder')">
        ＋ 选择文件夹
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
      :archived="archived"
      @close="showLink = false"
      @linked="reload"
    />

    <Modal v-model="showNoteForm" :title="editingNoteId ? '编辑便签' : '新建便签'" width="520px" @close="showNoteForm = false">
      <div class="ws-resources__form">
        <label class="full">
          标题
          <input v-model="noteForm.title" placeholder="便签标题" :readonly="archived" />
        </label>
        <div class="full">
          <span>内容</span>
          <div class="segmented-tabs"><button type="button" :class="{ active: noteMode === 'edit' }" @click="noteMode = 'edit'">编辑</button><button type="button" :class="{ active: noteMode === 'preview' }" @click="noteMode = 'preview'">预览</button></div>
          <textarea v-if="noteMode === 'edit'" v-model="noteForm.content" rows="8" placeholder="支持 Markdown" aria-label="便签内容" :readonly="archived"></textarea>
          <MarkdownRenderer v-else :content="noteForm.content" />
        </div>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="showNoteForm = false">取消</button>
        <button v-if="!archived" class="primary" type="button" :disabled="savingNote" @click="saveNote">{{ savingNote ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>

    <Modal v-model="showBookmarkForm" :title="editingBookmarkId ? '编辑收藏' : '新建收藏'" width="520px" @close="showBookmarkForm = false">
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
        <button class="primary" type="button" :disabled="savingBookmark" @click="saveBookmark">{{ savingBookmark ? '保存中…' : '保存' }}</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import LineIcon from './LineIcon.vue';
import MarkdownRenderer from './MarkdownRenderer.vue';
import Modal from './Modal.vue';
import WorkspaceLinkModal from './WorkspaceLinkModal.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { filterWorkspaceResourceRows } from './workspace-resource-filter.js';

const props = defineProps({
  workspaceId: { type: String, required: true },
  workspaces: { type: Array, default: () => [] },
  archived: { type: Boolean, default: false }
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
const search = ref('');
const filteredRows = computed(() => filterWorkspaceResourceRows(rows.value, search.value));
const counts = ref({});
const showLink = ref(false);
const showNoteForm = ref(false);
const showBookmarkForm = ref(false);
const noteForm = ref({ title: '', content: '' });
const bookmarkForm = ref({ title: '', url: '', note: '' });
const editingNoteId = ref(null);
const editingBookmarkId = ref(null);
const noteMode = ref('edit');
const savingNote = ref(false);
const savingBookmark = ref(false);
let mounted = true;
let loadGeneration = 0;

const currentTabLabel = computed(() => (tabs.find((tab) => tab.id === activeTab.value) || {}).label || '');

const emptyText = computed(() => {
  if (activeTab.value === 'favorite') return '这个工作空间还没有关联文件，点下面的按钮收藏文件或文件夹。';
  if (activeTab.value === 'app') return '这个工作空间还没有关联快捷应用。';
  return `这个工作空间还没有关联${currentTabLabel.value}。`;
});

function normalize(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

async function load() {
  const generation = ++loadGeneration;
  const workspaceId = props.workspaceId;
  const tab = activeTab.value;
  const current = () => mounted && generation === loadGeneration && props.workspaceId === workspaceId && activeTab.value === tab;
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
      todo: todos.filter((item) => normalize(item.workspaceId) === workspaceId),
      goal: goals.filter((item) => normalize(item.workspaceId) === workspaceId),
      favorite: favorites.filter((item) => normalize(item.workspaceId) === workspaceId),
      note: notes.filter((item) => normalize(item.workspaceId) === workspaceId),
      bookmark: bookmarks.filter((item) => normalize(item.workspaceId) === workspaceId),
      app: apps.filter((item) => normalize(item.workspaceId) === workspaceId)
    };
    if (!current()) return;
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
        searchText: item.title || '无标题便签',
        openable: true,
        raw: item
      }),
      bookmark: (item) => ({
        id: item.id,
        icon: 'bookmarks',
        title: item.title || item.url,
        meta: item.url,
        url: item.url,
        raw: item,
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

    if (!current()) return;
    rows.value = scoped[tab].map((item) => {
      const row = builders[tab](item);
      if (row.path) row.missing = exists[row.path] === false;
      return row;
    });
  } catch (error) {
    if (current()) { toast(error.message, 'error'); rows.value = []; }
  } finally {
    if (current()) loading.value = false;
  }
}

function reload() {
  load();
  emit('changed');
}

async function openRow(row) {
  try {
    if (activeTab.value === 'note') { openNote(row); return; }
    let result;
    if (activeTab.value === 'app') {
      result = await workbench.apps.launch(row.id);
    } else if (activeTab.value === 'bookmark') {
      result = await workbench.system.openExternal(row.url);
    } else {
      result = await workbench.files.open(row.path);
    }
    if (result && result.ok === false) throw new Error(result.error || '打开失败');
  } catch (error) {
    toast(error.message || '打开失败', 'error');
  }
}

async function revealRow(row) {
  try {
    const result = await workbench.files.reveal(row.path);
    if (result && result.ok === false) throw new Error(result.error || '定位失败');
  } catch (error) { toast(error.message || '定位失败', 'error'); }
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

async function addFavorite(kind) {
  const workspaceId = props.workspaceId;
  try {
    const filePath = kind === 'folder' ? await workbench.system.selectDirectory() : await workbench.system.selectFile();
    if (!filePath || !mounted || props.workspaceId !== workspaceId) return;
    await workbench.files.favorites.add(filePath, workspaceId);
    toast('已收藏到当前工作空间');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addApp() {
  const workspaceId = props.workspaceId;
  try {
    const filePath = await workbench.system.selectApp();
    if (!filePath || !mounted || props.workspaceId !== workspaceId) return;
    await workbench.apps.add(filePath, { workspaceId });
    toast('已添加到当前工作空间');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openNoteForm() {
  editingNoteId.value = null;
  noteForm.value = { title: '', content: '' };
  noteMode.value = 'edit';
  showNoteForm.value = true;
}

function openNote(row) {
  editingNoteId.value = row.id;
  noteForm.value = { title: row.raw.title || '', content: row.raw.content || '' };
  noteMode.value = 'preview';
  showNoteForm.value = true;
}

async function saveNote() {
  if (savingNote.value) return;
  if (props.archived) return;
  const workspaceId = props.workspaceId;
  savingNote.value = true;
  try {
    const title = noteForm.value.title.trim();
    if (!title) throw new Error('请输入便签标题');
    if (editingNoteId.value) {
      await workbench.files.notes.update(editingNoteId.value, { title, content: noteForm.value.content });
    } else {
      await workbench.files.notes.create({ title, content: noteForm.value.content, workspaceId });
    }
    if (!mounted || props.workspaceId !== workspaceId) return;
    showNoteForm.value = false;
    toast('便签已保存');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    savingNote.value = false;
  }
}

function openBookmarkForm() {
  editingBookmarkId.value = null;
  bookmarkForm.value = { title: '', url: '', note: '' };
  showBookmarkForm.value = true;
}

function openBookmarkEdit(row) {
  if (props.archived) return;
  editingBookmarkId.value = row.id;
  bookmarkForm.value = { title: row.raw.title || '', url: row.raw.url || '', note: row.raw.note || '' };
  showBookmarkForm.value = true;
}

async function saveBookmark() {
  if (savingBookmark.value) return;
  if (props.archived) return;
  const workspaceId = props.workspaceId;
  savingBookmark.value = true;
  try {
    const url = bookmarkForm.value.url.trim();
    if (!url) throw new Error('请输入链接');
    const data = { title: bookmarkForm.value.title.trim() || url, url, note: bookmarkForm.value.note };
    if (editingBookmarkId.value) await workbench.bookmarks.update(editingBookmarkId.value, data);
    else await workbench.bookmarks.create({ ...data, workspaceId });
    if (!mounted || props.workspaceId !== workspaceId) return;
    showBookmarkForm.value = false;
    toast('收藏已保存');
    reload();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    savingBookmark.value = false;
  }
}

watch(activeTab, () => { search.value = ''; load(); });
watch(() => props.workspaceId, () => {
  search.value = '';
  rows.value = [];
  counts.value = {};
  showNoteForm.value = false;
  showBookmarkForm.value = false;
  showLink.value = false;
  load();
});
watch(showLink, (value) => {
  if (!value) reload();
});

load();
onBeforeUnmount(() => { mounted = false; loadGeneration++; });
defineExpose({ refresh: load });
</script>

<style scoped>
.ws-resources {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ws-resources__search { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }

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
