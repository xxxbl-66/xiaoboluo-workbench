<template>
  <div class="view bookmarks-view">
    <header class="view-header">
      <div>
        <h1>收藏夹</h1>
        <p>文章、推文、视频和灵感，统一收纳在一个地方。</p>
      </div>
      <button class="primary" type="button" @click="openCreate">添加收藏</button>
    </header>

    <div class="segmented-tabs bookmark-tabs">
      <button :class="{ active: filter === 'all' }" type="button" @click="filter = 'all'">全部</button>
      <button :class="{ active: filter === 'article' }" type="button" @click="filter = 'article'">文章</button>
      <button :class="{ active: filter === 'tweet' }" type="button" @click="filter = 'tweet'">推文</button>
      <button :class="{ active: filter === 'video' }" type="button" @click="filter = 'video'">视频</button>
      <button :class="{ active: filter === 'idea' }" type="button" @click="filter = 'idea'">想法</button>
    </div>

    <div v-if="filteredItems.length" class="bookmark-grid">
      <article v-for="item in filteredItems" :key="item.id" class="bookmark-card" :class="item.type" @dblclick="openBookmark(item)">
        <div class="bookmark-card-top">
          <span class="bookmark-type-icon"><LineIcon :name="typeIcon(item.type)" :size="17" /></span>
          <span class="bookmark-type">{{ typeLabel(item.type) }}</span>
          <span class="bookmark-time">{{ formatTime(item.createdAt) }}</span>
        </div>
        <h3>{{ item.title || '未命名收藏' }}</h3>
        <p v-if="item.note">{{ item.note }}</p>
        <div v-if="item.url" class="bookmark-url" :title="item.url">{{ item.url }}</div>
        <footer>
          <button class="ghost small" type="button" @click="openBookmark(item)">打开</button>
          <button class="icon-button" type="button" @click="openEdit(item)">✎</button>
          <button class="icon-button danger" type="button" @click="removeItem(item)">🗑</button>
        </footer>
      </article>
    </div>
    <div v-else class="empty-state">
      <div class="empty-icon">⭐</div>
      <p>还没有收藏，点“添加收藏”开始。</p>
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

const filteredItems = computed(() => {
  if (filter.value === 'all') return items.value;
  return items.value.filter((item) => item.type === filter.value);
});

function typeLabel(type) {
  return { article: '文章', tweet: '推文', video: '视频', idea: '想法' }[type] || '文章';
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

async function loadItems() {
  items.value = await workbench.bookmarks.list();
}

function openCreate() {
  editingItem.value = null;
  form.value = { type: 'article', title: '', url: '', note: '' };
  showModal.value = true;
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
    toast('这是想法收藏：' + item.note);
  }
}

async function removeItem(item) {
  if (!window.confirm(`确定删除「${item.title || '未命名收藏'}」吗？`)) return;
  items.value = await workbench.bookmarks.remove(item.id);
}

onMounted(loadItems);
</script>
