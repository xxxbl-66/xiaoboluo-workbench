<template>
  <div class="view bookshelf-view">
    <header class="view-header">
      <div>
        <p class="view-kicker">WORKSPACE / BOOKSHELF</p>
        <h1>我的书架</h1>
        <p>添加本地书籍，或从在线书城下载到书架。</p>
      </div>
    </header>

    <div class="bookshelf-toolbar">
      <div class="segmented-tabs">
        <button :class="{ active: activeTab === 'library' }" type="button" @click="activeTab = 'library'">我的书籍</button>
        <button :class="{ active: activeTab === 'store' }" type="button" @click="activeTab = 'store'">在线书城</button>
      </div>
      <button class="primary" type="button" @click="addLocalBook">添加本地书</button>
    </div>

    <section v-if="activeTab === 'library'" class="panel books-library">
      <div class="library-filterbar">
        <div class="category-filter">
          <button
            class="category-chip"
            :class="{ active: categoryFilter === 'all' }"
            type="button"
            @click="categoryFilter = 'all'"
          >
            全部
          </button>
          <button
            v-for="category in categories"
            :key="category.id"
            class="category-chip"
            :class="{ active: categoryFilter === category.id }"
            type="button"
            @click="categoryFilter = category.id"
          >
            <span>{{ category.name }}</span>
            <span
              class="category-delete"
              role="button"
              tabindex="0"
              title="删除分类"
              @click.stop="removeCategory(category)"
              @keydown.enter.stop.prevent="removeCategory(category)"
            >×</span>
          </button>
          <button
            class="category-chip favorite-chip"
            :class="{ active: categoryFilter === 'favorite' }"
            type="button"
            @click="categoryFilter = 'favorite'"
          >
            <LineIcon name="bookmarks" :size="15" />
            收藏
          </button>
          <button class="category-add" type="button" @click="openCategoryModal">＋ 新增</button>
        </div>
        <div class="library-summary">显示 {{ filteredBooks.length }} / {{ books.length }} 本</div>
      </div>

      <div v-if="filteredBooks.length" class="book-grid">
        <article v-for="book in filteredBooks" :key="book.id" class="book-card" @click="openBook(book)">
          <div class="book-cover" :style="coverStyle(book)">
            <img v-if="book.coverDataUrl" :src="book.coverDataUrl" :alt="book.title" />
            <span v-else>{{ (book.title || '书').slice(0, 2) }}</span>
            <button
              class="favorite-toggle"
              :class="{ active: book.favorite }"
              type="button"
              :title="book.favorite ? '取消收藏' : '收藏'"
              @click.stop="toggleFavorite(book)"
            >
              <LineIcon name="bookmarks" :size="16" />
            </button>
          </div>
          <div class="book-info">
            <strong :title="book.title">{{ book.title }}</strong>
            <span>{{ formatExt(book.ext) }} · {{ categoryName(book.categoryId) }}</span>
          </div>
          <div class="book-actions">
            <button class="ghost small" type="button" @click.stop="openBook(book)">阅读</button>
            <button class="icon-button" type="button" title="编辑" @click.stop="openEditBook(book)"><LineIcon name="edit" :size="15" /></button>
            <button class="icon-button" type="button" title="用系统打开" @click.stop="openExternal(book)"><LineIcon name="external" :size="15" /></button>
            <button class="icon-button danger" type="button" @click.stop="removeBook(book)">×</button>
          </div>
        </article>
      </div>
      <div v-else class="empty-state">
        <div class="empty-icon"><LineIcon name="bookshelf" :size="30" /></div>
        <p>{{ books.length ? '这个分类下还没有书籍。' : '书架还是空的，添加一本喜欢的书吧。' }}</p>
      </div>
    </section>

    <section v-else class="bookshelf-store">
      <div class="store-toolbar">
        <div class="store-tabs">
          <div
            v-for="store in bookStores"
            :key="store.id"
            class="store-tab"
            :class="{ active: activeStoreId === store.id }"
            role="button"
            tabindex="0"
            @click="selectStore(store)"
          >
            <span>{{ store.name }}</span>
            <button
              v-if="!store.builtin"
              class="store-remove"
              type="button"
              title="删除此书城"
              @click.stop="removeStore(store)"
            >×</button>
          </div>
          <button class="store-add" type="button" @click="openStoreModal">＋ 添加书城</button>
        </div>
        <div v-if="activeStore" class="store-current-url">{{ activeStore.url }}</div>
      </div>

      <div class="store-note">
        <span><LineIcon name="external" :size="18" /></span>
        <p>登录或浏览网页后，点击书籍下载，文件会自动进入“我的书籍”。</p>
      </div>
      <webview
        v-if="activeStore"
        :key="activeStore.id"
        class="store-webview"
        :src="activeStore.url"
        partition="persist:bookshelf"
        allowpopups
      ></webview>
    </section>

    <Modal v-model="showEditModal" title="编辑书籍" width="520px" @close="closeEditModal">
      <div class="book-edit-cover">
        <div class="cover-preview" :style="coverStyle(bookForm)">
          <img v-if="bookForm.coverDataUrl" :src="bookForm.coverDataUrl" alt="封面" />
          <span v-else>{{ (bookForm.title || '书').slice(0, 2) }}</span>
        </div>
        <div class="cover-actions">
          <button class="ghost small" type="button" @click="selectCover">选择封面</button>
          <button class="ghost small" type="button" :disabled="!bookForm.coverDataUrl" @click="bookForm.coverDataUrl = ''">移除封面</button>
        </div>
      </div>

      <div class="form-grid">
        <label class="full">
          书名
          <input v-model="bookForm.title" placeholder="输入书籍名称" />
        </label>
        <label>
          分类
          <select v-model="bookForm.categoryId">
            <option :value="null">未分类</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
        </label>
        <label class="favorite-field">
          <input v-model="bookForm.favorite" type="checkbox" />
          <span>加入收藏</span>
        </label>
      </div>

      <template #footer>
        <button class="ghost" type="button" @click="closeEditModal">取消</button>
        <button class="primary" type="button" @click="saveBook">保存</button>
      </template>
    </Modal>

    <Modal v-model="showCategoryModal" title="新增分类" width="400px" @close="closeCategoryModal">
      <label>
        分类名称
        <input v-model="categoryForm.name" placeholder="例如：科幻 / 历史 / 工具书" @keyup.enter="createCategory" />
      </label>
      <template #footer>
        <button class="ghost" type="button" @click="closeCategoryModal">取消</button>
        <button class="primary" type="button" @click="createCategory">新增</button>
      </template>
    </Modal>

    <Modal v-model="showStoreModal" title="添加在线书城" width="480px" @close="closeStoreModal">
      <label>
        书城名称
        <input v-model="storeForm.name" placeholder="例如：起点中文网" />
      </label>
      <label class="full">
        网址
        <input v-model="storeForm.url" placeholder="https://…" @keyup.enter="createStore" />
      </label>
      <template #footer>
        <button class="ghost" type="button" @click="closeStoreModal">取消</button>
        <button class="primary" type="button" @click="createStore">添加</button>
      </template>
    </Modal>

    <BookReader v-if="readerBook" :book="readerBook" @close="readerBook = null" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import LineIcon from '../components/LineIcon.vue';
import Modal from '../components/Modal.vue';
import BookReader from '../components/BookReader.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const activeTab = ref('library');
const books = ref([]);
const categories = ref([]);
const readerBook = ref(null);
const categoryFilter = ref('all');
let removeBooksListener = null;

const showEditModal = ref(false);
const editingBook = ref(null);
const bookForm = ref({ title: '', categoryId: null, favorite: false, coverDataUrl: '' });
const showCategoryModal = ref(false);
const categoryForm = ref({ name: '' });
const bookStores = ref([]);
const activeStoreId = ref('');
const showStoreModal = ref(false);
const storeForm = ref({ name: '', url: '' });

const filteredBooks = computed(() => {
  if (categoryFilter.value === 'favorite') return books.value.filter((item) => item.favorite);
  if (categoryFilter.value === 'all') return books.value;
  return books.value.filter((item) => item.categoryId === categoryFilter.value);
});

const activeStore = computed(() => bookStores.value.find((item) => item.id === activeStoreId.value));

async function loadBooks() {
  try {
    books.value = await workbench.books.list();
  } catch (_) {}
}

async function loadCategories() {
  try {
    categories.value = await workbench.books.categories.list();
  } catch (_) {}
}

async function loadStores() {
  try {
    bookStores.value = await workbench.books.stores.list();
    if (!activeStoreId.value || !bookStores.value.some((item) => item.id === activeStoreId.value)) {
      activeStoreId.value = bookStores.value[0]?.id || '';
    }
  } catch (_) {}
}

function selectStore(store) {
  activeStoreId.value = store.id;
}

function openStoreModal() {
  storeForm.value = { name: '', url: '' };
  showStoreModal.value = true;
}

function closeStoreModal() {
  showStoreModal.value = false;
}

async function createStore() {
  try {
    const entry = await workbench.books.stores.add(storeForm.value);
    await loadStores();
    activeStoreId.value = entry.id;
    closeStoreModal();
    toast('书城已添加');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeStore(store) {
  if (!window.confirm(`确定移除书城「${store.name}」吗？`)) return;
  bookStores.value = await workbench.books.stores.remove(store.id);
  if (activeStoreId.value === store.id) {
    activeStoreId.value = bookStores.value[0]?.id || '';
  }
}

function categoryName(categoryId) {
  if (!categoryId) return '未分类';
  return categories.value.find((item) => item.id === categoryId)?.name || '未分类';
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
  readerBook.value = book;
}

async function openExternal(book) {
  const result = await workbench.books.open(book.id);
  if (!result.ok) toast(result.error || '无法打开书籍', 'error');
}

function openEditBook(book) {
  editingBook.value = book;
  bookForm.value = {
    title: book.title || '',
    categoryId: book.categoryId || null,
    favorite: Boolean(book.favorite),
    coverDataUrl: book.coverDataUrl || ''
  };
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingBook.value = null;
}

async function selectCover() {
  try {
    const coverDataUrl = await workbench.books.selectCover();
    if (coverDataUrl) bookForm.value.coverDataUrl = coverDataUrl;
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function saveBook() {
  try {
    if (!editingBook.value) return;
    if (!bookForm.value.title.trim()) throw new Error('请输入书名');
    const updated = await workbench.books.update(editingBook.value.id, {
      title: bookForm.value.title,
      categoryId: bookForm.value.categoryId || null,
      favorite: Boolean(bookForm.value.favorite),
      coverDataUrl: bookForm.value.coverDataUrl || ''
    });
    const index = books.value.findIndex((item) => item.id === updated.id);
    if (index !== -1) books.value[index] = updated;
    closeEditModal();
    toast('书籍信息已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleFavorite(book) {
  try {
    const updated = await workbench.books.update(book.id, { favorite: !book.favorite });
    const index = books.value.findIndex((item) => item.id === updated.id);
    if (index !== -1) books.value[index] = updated;
    if (categoryFilter.value === 'favorite' && !updated.favorite) {
      books.value = books.value.filter((item) => item.id !== updated.id);
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openCategoryModal() {
  categoryForm.value = { name: '' };
  showCategoryModal.value = true;
}

function closeCategoryModal() {
  showCategoryModal.value = false;
}

async function createCategory() {
  try {
    const name = categoryForm.value.name.trim();
    if (!name) throw new Error('请输入分类名称');
    await workbench.books.categories.create(name);
    await loadCategories();
    closeCategoryModal();
    toast('分类已新增');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeCategory(category) {
  if (!window.confirm(`确定删除分类「${category.name}」吗？分类下的书籍会变为未分类。`)) return;
  try {
    categories.value = await workbench.books.categories.remove(category.id);
    if (categoryFilter.value === category.id) categoryFilter.value = 'all';
    await loadBooks();
    toast('分类已删除');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeBook(book) {
  if (!window.confirm(`确定从书架移除「${book.title}」吗？`)) return;
  books.value = await workbench.books.remove(book.id);
}

function formatExt(ext) {
  return ext ? ext.replace('.', '').toUpperCase() : 'BOOK';
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
  const title = book.title || bookForm.value.title || '书';
  let hash = 0;
  for (const char of title) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  const [from, to] = palettes[hash % palettes.length];
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}

onMounted(() => {
  loadBooks();
  loadCategories();
  loadStores();
  if (workbench.books.onChanged) {
    removeBooksListener = workbench.books.onChanged(() => loadBooks());
  }
});

onBeforeUnmount(() => {
  if (typeof removeBooksListener === 'function') removeBooksListener();
});
</script>

<style scoped>
.bookshelf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.bookshelf-toolbar .segmented-tabs {
  margin: 0;
}

.store-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
}

.store-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.store-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.store-tab.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.store-remove {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
}

.store-remove:hover {
  background: rgba(0, 0, 0, 0.1);
}

.store-add {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.store-add:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.store-current-url {
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: 12px;
}

.library-filterbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.category-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.category-delete {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border-radius: 50%;
  background: transparent;
  color: var(--text-faint);
  font-size: 14px;
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease;
}

.category-chip:hover .category-delete {
  color: var(--text-muted);
}

.category-delete:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.category-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.favorite-chip {
  color: var(--text-muted);
}

.favorite-chip.active {
  background: var(--primary);
  color: var(--on-primary);
}

.category-add {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.category-add:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.library-summary {
  color: var(--text-faint);
  font-size: 12px;
  white-space: nowrap;
}

.book-card {
  position: relative;
}

.book-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.favorite-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-muted);
  transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.favorite-toggle :deep(.line-icon) {
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: center bottom;
}

.favorite-toggle.active {
  color: #ffffff;
  background: #f59e0b;
  box-shadow: 0 5px 14px rgba(245, 158, 11, 0.34);
}

.favorite-toggle.active :deep(.line-icon) {
  transform: scaleY(1.42);
}

.book-edit-cover {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 8px;
}

.cover-preview {
  width: 96px;
  height: 128px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  overflow: hidden;
  color: #ffffff;
  font-weight: 700;
  flex: 0 0 96px;
}

.cover-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}

.favorite-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 760px) {
  .library-filterbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
