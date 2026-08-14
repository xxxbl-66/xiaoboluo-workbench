<template>
  <section class="panel file-browser">
    <div class="browser-toolbar">
      <button class="icon-button" type="button" :disabled="!current.parent" @click="browse(current.parent)">⬅</button>
      <button class="icon-button" type="button" @click="browse(current.path)">⟳</button>
      <input v-model="pathInput" class="path-input" spellcheck="false" @keyup.enter="goToPath" />
      <button class="ghost small" type="button" @click="goToPath">转到</button>
    </div>

    <div class="drive-row">
      <button
        v-for="drive in drives"
        :key="drive.path"
        class="drive-chip"
        :class="{ active: current.path.toUpperCase().startsWith(drive.path.toUpperCase()) }"
        type="button"
        @click="browse(drive.path)"
      >
        {{ drive.name }}
      </button>
    </div>

    <div class="browser-breadcrumb">
      <button v-for="(segment, index) in breadcrumbs" :key="index" type="button" @click="jumpToSegment(index)">
        {{ segment.label }}
      </button>
    </div>

    <div v-if="loading" class="empty-state small"><p>正在读取文件夹…</p></div>
    <div v-else-if="current.error" class="empty-state small"><p>{{ current.error }}</p></div>
    <div v-else class="file-grid">
      <article
        v-for="entry in current.entries"
        :key="entry.path"
        class="file-item"
        :class="{ folder: entry.isDirectory }"
        @dblclick="entry.isDirectory ? browse(entry.path) : openEntry(entry)"
      >
        <div class="file-icon"><LineIcon :name="fileIcon(entry)" :size="27" /></div>
        <div class="file-name" :title="entry.name">{{ entry.name }}</div>
        <div class="file-meta">{{ entry.isDirectory ? '文件夹' : formatSize(entry.size) }}</div>
        <button
          class="file-favorite"
          :class="{ active: isFavorite(entry) }"
          type="button"
          :title="isFavorite(entry) ? '取消收藏' : (entry.isDirectory ? '收藏文件夹' : '添加到收藏')"
          @click.stop="toggleFavorite(entry)"
        >{{ isFavorite(entry) ? '★' : '☆' }}</button>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const drives = ref([]);
const current = ref({ path: '', parent: null, entries: [], error: null });
const pathInput = ref('');
const loading = ref(false);
const favorites = ref([]);

const favoritePathSet = computed(() => new Set(
  favorites.value.map((item) => String(item.path || '').toLowerCase())
));

const breadcrumbs = computed(() => {
  const value = (current.value.path || '').replace(/\//g, '\\');
  if (!value) return [];
  const driveMatch = value.match(/^([A-Za-z]:\\)(.*)$/);
  if (driveMatch) {
    const prefix = driveMatch[1];
    const parts = driveMatch[2].split('\\').filter(Boolean);
    const items = [{ label: prefix, path: prefix }];
    let acc = prefix;
    for (const part of parts) {
      acc += `${part}\\`;
      items.push({ label: part, path: acc });
    }
    return items;
  }
  return [{ label: value, path: value }];
});

function fileIcon(entry) {
  if (entry.isDirectory) return 'folder';
  const ext = entry.ext;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(ext)) return 'image';
  if (['.md', '.txt'].includes(ext)) return 'file';
  if (['.exe', '.lnk', '.bat', '.cmd'].includes(ext)) return 'app';
  if (['.zip', '.rar', '.7z'].includes(ext)) return 'files';
  return 'file';
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function browse(dir) {
  loading.value = true;
  try {
    current.value = await workbench.files.browse(dir);
    pathInput.value = current.value.path;
  } finally {
    loading.value = false;
  }
}

async function goToPath() {
  if (!pathInput.value.trim()) return;
  await browse(pathInput.value.trim());
}

function jumpToSegment(index) {
  const target = breadcrumbs.value[index];
  if (target && target.path) browse(target.path);
}

async function openEntry(entry) {
  const result = await workbench.files.open(entry.path);
  if (!result.ok) toast(result.error || '无法打开文件', 'error');
}

function isFavorite(entry) {
  return favoritePathSet.value.has(String(entry.path || '').toLowerCase());
}

async function loadFavorites() {
  try {
    favorites.value = await workbench.files.favorites.list();
  } catch (_) {}
}

async function toggleFavorite(entry) {
  try {
    const existing = favorites.value.find((item) => String(item.path).toLowerCase() === String(entry.path).toLowerCase());
    if (existing) {
      favorites.value = await workbench.files.favorites.remove(existing.id);
      toast('已取消收藏');
    } else {
      favorites.value = await workbench.files.favorites.add(entry.path);
      toast('已添加到收藏');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(async () => {
  await loadFavorites();
  drives.value = await workbench.files.drives();
  const initial = drives.value.find((drive) => drive.name.toUpperCase() === 'C:') || drives.value[0];
  if (initial) await browse(initial.path);
});
</script>
