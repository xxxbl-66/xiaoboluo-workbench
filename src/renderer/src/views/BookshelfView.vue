<template>
  <div class="view bookshelf-view">
    <header class="view-header">
      <div>
        <h1>我的书架</h1>
        <p>添加本地书籍，或从在线书城下载到书架。</p>
      </div>
      <button class="primary" type="button" @click="addLocalBook">添加本地书</button>
    </header>

    <div class="segmented-tabs">
      <button :class="{ active: activeTab === 'library' }" type="button" @click="activeTab = 'library'">我的书籍</button>
      <button :class="{ active: activeTab === 'store' }" type="button" @click="activeTab = 'store'">在线书城</button>
    </div>

    <section v-if="activeTab === 'library'" class="panel books-library">
      <div class="panel-head">
        <div>
          <h2>书籍列表</h2>
          <p>共 {{ books.length }} 本 · 点击书籍即可打开阅读。</p>
        </div>
        <button class="ghost small" type="button" @click="refreshBooks">刷新</button>
      </div>

      <div v-if="books.length" class="book-grid">
        <article v-for="book in books" :key="book.id" class="book-card" @dblclick="openBook(book)">
          <div class="book-cover" :style="coverStyle(book)">
            <span>{{ book.title.slice(0, 2) }}</span>
          </div>
          <div class="book-info">
            <strong :title="book.title">{{ book.title }}</strong>
            <span>{{ formatExt(book.ext) }} · {{ formatDate(book.addedAt) }}</span>
          </div>
          <div class="book-actions">
            <button class="ghost small" type="button" @click="openBook(book)">打开</button>
            <button class="icon-button danger" type="button" @click="removeBook(book)">×</button>
          </div>
        </article>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon"><LineIcon name="bookshelf" :size="30" /></div>
        <p>书架还是空的，添加一本喜欢的书吧。</p>
      </div>
    </section>

    <section v-else class="bookshelf-store">
      <div class="store-note">
        <span><LineIcon name="external" :size="18" /></span>
        <p>已内置 10000txt.com。登录或浏览网页后，点击书籍下载，文件会自动进入“我的书籍”。</p>
      </div>
      <webview
        class="store-webview"
        src="https://www.10000txt.com/"
        partition="persist:bookshelf"
        allowpopups
      ></webview>
    </section>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import LineIcon from '../components/LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const activeTab = ref('library');
const books = ref([]);
let removeBooksListener = null;

async function loadBooks() {
  try {
    books.value = await workbench.books.list();
  } catch (_) {}
}

async function refreshBooks() {
  await loadBooks();
}

async function addLocalBook() {
  try {
    const filePath = await workbench.system.selectBook();
    if (!filePath) return;
    await workbench.books.add(filePath);
    await loadBooks();
    toast('书籍已加入书架');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openBook(book) {
  const result = await workbench.books.open(book.id);
  if (!result.ok) toast(result.error || '无法打开书籍', 'error');
}

async function removeBook(book) {
  if (!window.confirm(`确定从书架移除「${book.title}」吗？`)) return;
  books.value = await workbench.books.remove(book.id);
}

function formatExt(ext) {
  return ext ? ext.replace('.', '').toUpperCase() : 'BOOK';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function coverStyle(book) {
  const palettes = [
    ['#f97316', '#fb923c'],
    ['#6366f1', '#818cf8'],
    ['#0ea5e9', '#38bdf8'],
    ['#10b981', '#34d399'],
    ['#f43f5e', '#fb7185'],
    ['#8b5cf6', '#a78bfa']
  ];
  let hash = 0;
  for (const char of book.title || '书') {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  const [from, to] = palettes[hash % palettes.length];
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}

onMounted(() => {
  loadBooks();
  if (workbench.books.onChanged) {
    removeBooksListener = workbench.books.onChanged(() => loadBooks());
  }
});

onBeforeUnmount(() => {
  if (typeof removeBooksListener === 'function') removeBooksListener();
});
</script>
