<template>
  <Teleport to="body">
    <div class="reader" :class="`reader--${prefs.theme}`">
      <header class="reader-top">
        <button class="reader-top-btn" type="button" @click="closeReader">‹ 返回</button>
        <div class="reader-top-title">
          <strong>{{ bookTitle }}</strong>
          <span>{{ currentTitle }}</span>
        </div>
        <div class="reader-top-actions">
          <button class="reader-top-btn" :class="{ active: showCatalog }" type="button" @click="showCatalog = !showCatalog">目录</button>
          <button class="reader-top-btn" :class="{ active: showSettings }" type="button" @click="showSettings = !showSettings">Aa</button>
        </div>
      </header>

      <main v-if="loading" class="reader-center">
        <p>正在打开书籍…</p>
      </main>

      <main v-else-if="error" class="reader-center">
        <p>{{ error }}</p>
        <button class="primary" type="button" @click="closeReader">返回</button>
      </main>

      <main v-else-if="!data.supported" class="reader-center">
        <p>该格式暂不支持内置阅读，请用系统默认程序打开。</p>
        <div class="reader-center-actions">
          <button class="ghost" type="button" @click="closeReader">返回</button>
          <button class="primary" type="button" @click="openExternal">用系统打开</button>
        </div>
      </main>

      <main v-else ref="contentEl" class="reader-body" @scroll.passive="onScroll">
        <pre class="reader-text" :style="textStyle">{{ chapterText }}</pre>
      </main>

      <footer v-if="data && data.supported" class="reader-foot">
        <button class="reader-foot-btn" type="button" :disabled="current <= 0" @click="gotoChapter(current - 1)">上一章</button>
        <span class="reader-progress">{{ current + 1 }} / {{ chapters.length }} · {{ percent }}</span>
        <button class="reader-foot-btn" type="button" :disabled="current >= chapters.length - 1" @click="gotoChapter(current + 1)">下一章</button>
      </footer>

      <aside v-if="showCatalog" class="reader-drawer">
        <div class="reader-drawer-head">
          <strong>目录</strong>
          <button class="icon-button" type="button" @click="showCatalog = false">×</button>
        </div>
        <div class="reader-catalog">
          <button
            v-for="(ch, i) in chapters"
            :key="i"
            class="reader-catalog-item"
            :class="{ active: i === current }"
            type="button"
            @click="gotoChapter(i)"
          >
            {{ ch.title }}
          </button>
        </div>
      </aside>

      <aside v-if="showSettings" class="reader-drawer">
        <div class="reader-drawer-head">
          <strong>阅读设置</strong>
          <button class="icon-button" type="button" @click="showSettings = false">×</button>
        </div>

        <div class="reader-settings">
          <div class="reader-settings-row">
            <span class="reader-settings-label">字号</span>
            <button class="reader-step" type="button" @click="adjustFont(-1)">A-</button>
            <input type="range" min="14" max="30" :value="prefs.fontSize" @input="setFontSize(Number($event.target.value))" />
            <button class="reader-step" type="button" @click="adjustFont(1)">A+</button>
            <strong class="reader-value">{{ prefs.fontSize }}</strong>
          </div>

          <div class="reader-settings-row">
            <span class="reader-settings-label">行距</span>
            <input type="range" min="1.5" max="2.6" step="0.1" :value="prefs.lineHeight" @input="setLineHeight(Number($event.target.value))" />
            <strong class="reader-value">{{ prefs.lineHeight.toFixed(1) }}</strong>
          </div>

          <div class="reader-settings-row reader-settings-col">
            <span class="reader-settings-label">字体</span>
            <div class="reader-chips">
              <button v-for="f in fontOptions" :key="f.value" type="button" :class="{ active: prefs.fontFamily === f.value }" @click="setFontFamily(f.value)">
                {{ f.label }}
              </button>
            </div>
          </div>

          <div class="reader-settings-row reader-settings-col">
            <span class="reader-settings-label">配色</span>
            <div class="reader-themes">
              <button
                v-for="t in themeOptions"
                :key="t.value"
                type="button"
                :class="{ active: prefs.theme === t.value }"
                :style="{ background: t.bg, color: t.color }"
                @click="setTheme(t.value)"
              >
                {{ t.label }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';

const props = defineProps({
  book: { type: Object, required: true }
});

const emit = defineEmits(['close']);

const loading = ref(true);
const error = ref('');
const data = ref(null);
const text = ref('');
const chapters = ref([]);
const current = ref(0);
const prefs = ref({ fontSize: 18, lineHeight: 1.9, fontFamily: 'system', theme: 'light' });
const showCatalog = ref(false);
const showSettings = ref(false);
const contentEl = ref(null);

const fontMap = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  serif: "Georgia, 'Songti SC', 'SimSun', 'STSong', serif",
  hei: "'PingFang SC', 'Microsoft YaHei', 'Heiti SC', 'SimHei', sans-serif",
  kai: "'Kaiti SC', 'KaiTi', 'STKaiti', 'BiauKai', serif",
  fang: "'FangSong', 'STFangsong', '仿宋', serif",
  round: "'Yuanti SC', 'YouYuan', '幼圆', 'Microsoft YaHei', sans-serif"
};

const fontOptions = [
  { value: 'system', label: '系统' },
  { value: 'serif', label: '宋体' },
  { value: 'hei', label: '黑体' },
  { value: 'kai', label: '楷体' },
  { value: 'fang', label: '仿宋' },
  { value: 'round', label: '圆体' }
];

const themeOptions = [
  { value: 'light', label: '浅色', bg: '#f7f7f5', color: '#1f2937' },
  { value: 'sepia', label: '羊皮纸', bg: '#f4ecd8', color: '#4a3a24' },
  { value: 'green', label: '护眼', bg: '#e7f2e7', color: '#2f3b2f' },
  { value: 'dark', label: '深色', bg: '#15171a', color: '#d7d7d2' }
];

let scrollTimer = null;
let prefsTimer = null;

const bookTitle = computed(() => (data.value && data.value.title) || props.book.title || '书籍');
const currentTitle = computed(() => chapters.value[current.value]?.title || '');
const chapterText = computed(() => {
  if (!text.value || !chapters.value.length) return '';
  const ch = chapters.value[current.value];
  return text.value.slice(ch.start, ch.end);
});
const percent = computed(() => {
  if (!chapters.value.length) return '';
  return `${Math.round(((current.value + 1) / chapters.value.length) * 1000) / 10}%`;
});
const textStyle = computed(() => ({
  fontSize: `${prefs.value.fontSize}px`,
  lineHeight: String(prefs.value.lineHeight),
  fontFamily: fontMap[prefs.value.fontFamily] || fontMap.system
}));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function savePrefs() {
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    workbench.reader.update({ prefs: { ...prefs.value } }).catch(() => {});
  }, 350);
}

function saveProgress() {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    workbench.reader.update({
      progress: { [props.book.id]: { chapter: current.value, scroll: contentEl.value ? contentEl.value.scrollTop : 0 } }
    }).catch(() => {});
  }, 500);
}

function adjustFont(delta) {
  prefs.value.fontSize = clamp(prefs.value.fontSize + delta, 14, 30);
  savePrefs();
}

function setFontSize(value) {
  prefs.value.fontSize = clamp(value, 14, 30);
  savePrefs();
}

function setLineHeight(value) {
  prefs.value.lineHeight = clamp(value, 1.5, 2.6);
  savePrefs();
}

function setFontFamily(value) {
  prefs.value.fontFamily = value;
  savePrefs();
}

function setTheme(value) {
  prefs.value.theme = value;
  savePrefs();
}

async function load() {
  try {
    const [readerState, bookData] = await Promise.all([
      workbench.reader.get(),
      workbench.books.read(props.book.id)
    ]);
    prefs.value = { ...prefs.value, ...(readerState.prefs || {}) };
    data.value = bookData;
    if (bookData.supported) {
      text.value = bookData.text || '';
      chapters.value = bookData.chapters || [];
      const saved = readerState.progress && readerState.progress[props.book.id];
      if (saved && typeof saved.chapter === 'number' && saved.chapter >= 0 && saved.chapter < chapters.value.length) {
        current.value = saved.chapter;
      }
      await nextTick();
      if (contentEl.value && saved && typeof saved.scroll === 'number') {
        contentEl.value.scrollTop = saved.scroll;
      }
    }
  } catch (e) {
    error.value = e.message || '书籍读取失败';
  } finally {
    loading.value = false;
  }
}

function gotoChapter(index) {
  if (index < 0 || index >= chapters.value.length) return;
  current.value = index;
  showCatalog.value = false;
  nextTick(() => {
    if (contentEl.value) contentEl.value.scrollTop = 0;
  });
  saveProgress();
}

function onScroll() {
  saveProgress();
}

async function openExternal() {
  try {
    await workbench.books.open(props.book.id);
  } catch (e) {
    // 忽略系统打开失败
  }
  closeReader();
}

function closeReader() {
  if (scrollTimer) clearTimeout(scrollTimer);
  workbench.reader.update({
    progress: { [props.book.id]: { chapter: current.value, scroll: contentEl.value ? contentEl.value.scrollTop : 0 } }
  }).catch(() => {});
  emit('close');
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    closeReader();
  } else if (event.key === 'ArrowLeft' && current.value > 0) {
    gotoChapter(current.value - 1);
  } else if (event.key === 'ArrowRight' && current.value < chapters.value.length - 1) {
    gotoChapter(current.value + 1);
  }
}

onMounted(() => {
  load();
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  if (scrollTimer) clearTimeout(scrollTimer);
  if (prefsTimer) clearTimeout(prefsTimer);
});
</script>

<style scoped>
.reader {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  background: var(--reader-bg);
  color: var(--reader-text);
  outline: none;
}

.reader--light { --reader-bg: #f7f7f5; --reader-text: #1f2937; --reader-muted: #8a8f98; --reader-panel: #ffffff; --reader-border: #ece9e2; }
.reader--sepia { --reader-bg: #f4ecd8; --reader-text: #4a3a24; --reader-muted: #a08c66; --reader-panel: #fbf5e6; --reader-border: #e5d8b8; }
.reader--green { --reader-bg: #e7f2e7; --reader-text: #2f3b2f; --reader-muted: #7d8f7d; --reader-panel: #f3f8f3; --reader-border: #d4e2d4; }
.reader--dark { --reader-bg: #15171a; --reader-text: #d7d7d2; --reader-muted: #8b8b85; --reader-panel: #1e2024; --reader-border: #2c2f34; }

.reader-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--reader-panel);
  border-bottom: 1px solid var(--reader-border);
}

.reader-top-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  text-align: center;
}

.reader-top-title strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-top-title span {
  font-size: 12px;
  color: var(--reader-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-top-actions {
  display: flex;
  gap: 6px;
}

.reader-top-btn,
.reader-foot-btn,
.reader-step {
  border: 1px solid var(--reader-border);
  background: transparent;
  color: var(--reader-text);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 13px;
  cursor: pointer;
}

.reader-top-btn.active {
  border-color: var(--primary, #3b82f6);
  color: var(--primary-strong, #2563eb);
}

.reader-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--reader-muted);
  padding: 24px;
  text-align: center;
}

.reader-center-actions {
  display: flex;
  gap: 8px;
}

.reader-body {
  flex: 1;
  overflow: auto;
  padding: 28px clamp(18px, 6vw, 88px) 52px;
}

.reader-text {
  margin: 0 auto;
  max-width: 780px;
  white-space: pre-wrap;
  word-break: break-word;
  font-weight: 400;
  color: var(--reader-text);
}

.reader-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--reader-panel);
  border-top: 1px solid var(--reader-border);
}

.reader-foot-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.reader-progress {
  font-size: 12px;
  color: var(--reader-muted);
  font-variant-numeric: tabular-nums;
}

.reader-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(360px, 88vw);
  background: var(--reader-panel);
  border-left: 1px solid var(--reader-border);
  box-shadow: -16px 0 40px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.reader-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--reader-border);
}

.reader-drawer-head strong {
  font-size: 15px;
}

.reader-catalog {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.reader-catalog-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 11px 12px;
  border-radius: 8px;
  background: transparent;
  border: 0;
  color: var(--reader-text);
  font-size: 14px;
  cursor: pointer;
}

.reader-catalog-item:hover {
  background: rgba(127, 127, 127, 0.08);
}

.reader-catalog-item.active {
  color: var(--primary-strong, #2563eb);
  background: rgba(59, 130, 246, 0.12);
}

.reader-settings {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow: auto;
}

.reader-settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.reader-settings-col {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.reader-settings-label {
  min-width: 44px;
  font-size: 13px;
  color: var(--reader-muted);
}

.reader-settings-row input[type='range'] {
  flex: 1;
  accent-color: var(--primary, #3b82f6);
}

.reader-value {
  min-width: 34px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.reader-chips,
.reader-themes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reader-chips button,
.reader-themes button {
  border: 1px solid var(--reader-border);
  background: transparent;
  color: var(--reader-text);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 13px;
  cursor: pointer;
}

.reader-chips button.active,
.reader-themes button.active {
  border-color: var(--primary, #3b82f6);
  box-shadow: 0 0 0 1px var(--primary, #3b82f6);
}

@media (max-width: 640px) {
  .reader-top {
    flex-wrap: wrap;
  }

  .reader-top-title {
    order: 3;
    width: 100%;
    text-align: left;
  }

  .reader-body {
    padding: 20px 16px 44px;
  }

  .reader-drawer {
    width: 92vw;
  }
}
</style>