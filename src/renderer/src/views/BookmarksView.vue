<template>
  <div class="view bookmarks-view">
    <div class="bookmark-module">
      <p class="bookmark-module__path">WORKSPACE / BOOKMARKS</p>
      <h2 class="bookmark-module__title">我的收藏夹</h2>
      <p class="bookmark-module__desc">文章、推文、视频和灵感，统一收纳在一个地方。</p>

      <form class="bookmark-module__composer" @submit.prevent="openCreateFromComposer">
        <input v-model="composerTitle" class="bookmark-module__input" placeholder="粘贴链接或输入标题" />
        <select v-model="composerType" class="bookmark-module__select" aria-label="收藏类型">
          <option value="article">文章</option>
          <option value="tweet">推文</option>
          <option value="video">视频</option>
          <option value="idea">想法</option>
        </select>
        <button class="bookmark-module__add" type="submit">添加</button>
      </form>

      <div class="bookmark-module__meta">
        <div class="bookmark-module__stack">
          <span>CURRENT STACK</span>
          <strong>{{ filteredItems.length }} / {{ items.length }}</strong>
        </div>
        <div class="bookmark-module__filters">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="bookmark-module__filter"
            :class="{ active: filter === tab.value }"
            type="button"
            @click="filter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div class="bookmark-module__card">
        <div v-if="filteredItems.length" class="bookmark-module__list">
          <article v-for="item in filteredItems" :key="item.id" class="bookmark-module__item" @dblclick="openBookmark(item)">
            <span class="bookmark-module__type-icon">
              <LineIcon :name="typeIcon(item.type)" :size="18" />
            </span>

            <div class="bookmark-module__content">
              <span class="bookmark-module__name">{{ item.title || '未命名收藏' }}</span>
              <div class="bookmark-module__tags">
                <span class="bookmark-module__tag">{{ typeLabel(item.type) }}</span>
                <span class="bookmark-module__tag">{{ formatTime(item.createdAt) }}</span>
                <span v-if="item.url" class="bookmark-module__tag url">{{ domainOf(item.url) }}</span>
              </div>
            </div>

            <div class="bookmark-module__actions">
              <button class="bookmark-module__icon" type="button" title="打开" @click.stop="openBookmark(item)">
                <LineIcon name="external" :size="16" />
              </button>
              <button class="bookmark-module__icon" type="button" title="编辑" @click.stop="openEdit(item)">
                <LineIcon name="edit" :size="16" />
              </button>
              <button class="bookmark-module__icon danger" type="button" title="删除" @click.stop="removeItem(item)">
                <LineIcon name="trash" :size="16" />
              </button>
            </div>
          </article>
        </div>
        <div v-else class="bookmark-module__empty">暂无收藏</div>

        <button class="bookmark-module__clear" type="button" @click="clearItems">清空收藏</button>
      </div>

      <p class="bookmark-module__end">END OF YOUR COLLECTION</p>
    </div>

    <Modal v-model="showModal" :title="editingItem ? '编辑收藏' : '添加收藏'" width="560px" @close="closeModal">
      <div class="form-grid">
        <label>
          类型
          <select v-model="form.type">
            <option value="article">文章</option>
            <option value="tweet">推文</option>
            <option value="video">视频</option>
            <option value="idea">想法</option>
          </select>
        </label>
        <label>
          标题
          <input v-model="form.title" placeholder="给自己看的标题" />
        </label>
        <label class="full">
          链接
          <input v-model="form.url" placeholder="https://…（想法可留空）" />
        </label>
        <label class="full">
          备注
          <textarea v-model="form.note" rows="3" placeholder="为什么收藏它？"></textarea>
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="closeModal">取消</button>
        <button class="primary" type="button" @click="saveBookmark">保存</button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from '../components/Modal.vue';
import LineIcon from '../components/LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const items = ref([]);
const filter = ref('all');
const showModal = ref(false);
const editingItem = ref(null);
const form = ref({ type: 'article', title: '', url: '', note: '' });
const composerTitle = ref('');
const composerType = ref('article');

const tabs = [
  { value: 'all', label: '全部' },
  { value: 'article', label: '文章' },
  { value: 'tweet', label: '推文' },
  { value: 'video', label: '视频' },
  { value: 'idea', label: '想法' }
];

const filteredItems = computed(() => {
  if (filter.value === 'all') return items.value;
  return items.value.filter((item) => item.type === filter.value);
});

function typeLabel(type) {
  return { article: 'ARTICLE', tweet: 'TWEET', video: 'VIDEO', idea: 'IDEA' }[type] || 'ARTICLE';
}

function typeIcon(type) {
  return { article: 'file', tweet: 'chat', video: 'external', idea: 'note' }[type] || 'bookmarks';
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return url;
  }
}

function isWebUrl(value) {
  return /^(https?:\/\/|www\.)/i.test(String(value || '').trim());
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

async function loadItems() {
  items.value = await workbench.bookmarks.list();
}

function openCreate() {
  editingItem.value = null;
  const raw = composerTitle.value.trim();
  const isUrl = isWebUrl(raw);
  form.value = {
    type: composerType.value || 'article',
    title: isUrl ? domainOf(normalizeUrl(raw)) : raw,
    url: isUrl ? normalizeUrl(raw) : '',
    note: ''
  };
  showModal.value = true;
}

function openCreateFromComposer() {
  openCreate();
  composerTitle.value = '';
}

function openEdit(item) {
  editingItem.value = item;
  form.value = { type: item.type, title: item.title, url: item.url || '', note: item.note || '' };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingItem.value = null;
}

async function saveBookmark() {
  try {
    if (!form.value.title.trim() && form.value.type !== 'idea') throw new Error('请填写标题');
    const payload = { ...form.value };
    if (editingItem.value) {
      await workbench.bookmarks.update(editingItem.value.id, payload);
    } else {
      await workbench.bookmarks.create(payload);
    }
    await loadItems();
    closeModal();
    toast('收藏已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openBookmark(item) {
  if (item.url) {
    try {
      await workbench.system.openExternal(item.url);
    } catch (error) {
      toast(error.message, 'error');
    }
  } else if (item.note) {
    toast(item.note);
  }
}

async function removeItem(item) {
  if (!window.confirm(`确定删除「${item.title || '未命名收藏'}」吗？`)) return;
  items.value = await workbench.bookmarks.remove(item.id);
}

async function clearItems() {
  if (!window.confirm('确定清空所有收藏吗？此操作不可撤销。')) return;
  await Promise.all(items.value.map((item) => workbench.bookmarks.remove(item.id)));
  await loadItems();
  toast('收藏已清空');
}

onMounted(loadItems);
</script>

<style scoped>
.bookmark-module {
  max-width: 860px;
  margin: 0 auto;
  color: var(--text);
}

.bookmark-module__path {
  margin: 0 0 10px;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--text-faint);
}

.bookmark-module__title {
  margin: 0;
  font-size: 34px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text);
}

.bookmark-module__desc {
  margin: 8px 0 24px;
  color: var(--text-muted);
  font-size: 14px;
}

.bookmark-module__composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px 88px;
  gap: 10px;
  margin-bottom: 24px;
}

.bookmark-module__input,
.bookmark-module__select {
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 0 12px;
  font-size: 14px;
  color: var(--text);
  outline: none;
}

.bookmark-module__input:focus,
.bookmark-module__select:focus {
  border-color: var(--primary);
}

.bookmark-module__add {
  height: 42px;
  border-radius: 10px;
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
  font-size: 14px;
}

.bookmark-module__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.bookmark-module__stack {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.bookmark-module__stack span {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}

.bookmark-module__stack strong {
  font-size: 15px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.bookmark-module__filters {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.bookmark-module__filter {
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.bookmark-module__filter.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.bookmark-module__card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
  padding: 16px;
}

.bookmark-module__list {
  display: flex;
  flex-direction: column;
}

.bookmark-module__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}

.bookmark-module__item:last-child {
  border-bottom: 0;
}

.bookmark-module__type-icon {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--primary-soft);
  color: var(--primary-strong);
}

.bookmark-module__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bookmark-module__name {
  color: var(--text);
  font-size: 15px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.bookmark-module__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bookmark-module__tag {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
}

.bookmark-module__tag.url {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-module__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bookmark-module__icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--text-faint);
}

.bookmark-module__icon:hover {
  background: var(--surface-2);
  color: var(--text);
}

.bookmark-module__icon.danger:hover {
  color: var(--danger);
}

.bookmark-module__empty {
  padding: 30px 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 14px;
}

.bookmark-module__clear {
  margin-top: 12px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.bookmark-module__end {
  margin: 26px 0 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 11px;
  letter-spacing: 0.18em;
}

@media (max-width: 600px) {
  .bookmark-module__composer {
    grid-template-columns: 1fr;
  }

  .bookmark-module__meta {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
