<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>文件收藏</h2>
        <p>收藏常用文件或文件夹，只保存原始路径。</p>
      </div>
      <div class="panel-actions">
        <button class="ghost" type="button" @click="addFolderFavorite">收藏文件夹</button>
        <button class="primary" type="button" @click="addFileFavorite">收藏文件</button>
      </div>
    </div>

    <div v-if="items.length" class="favorite-list">
      <article v-for="item in items" :key="item.id" class="favorite-item" @dblclick="openItem(item)">
        <span class="favorite-icon" :class="{ folder: item.type === 'folder' }">
          <LineIcon :name="item.type === 'folder' ? 'folder' : 'file'" :size="20" />
        </span>
        <div class="favorite-info">
          <strong>{{ item.name }}</strong>
          <span>{{ item.path }}</span>
        </div>
        <div class="favorite-actions">
          <button class="ghost small" type="button" @click.stop="openItem(item)">打开</button>
          <button class="icon-button" type="button" title="在文件夹中显示" @click.stop="revealItem(item)"><LineIcon name="search" :size="16" /></button>
          <button class="icon-button danger" type="button" @click.stop="removeItem(item)">×</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state small"><p>还没有文件收藏。</p></div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const items = ref([]);

async function loadItems() {
  items.value = await workbench.files.favorites.list();
}

async function addFavorite(filePath) {
  try {
    items.value = await workbench.files.favorites.add(filePath);
    toast('已收藏');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addFileFavorite() {
  const filePath = await workbench.system.selectFile();
  if (filePath) await addFavorite(filePath);
}

async function addFolderFavorite() {
  const folderPath = await workbench.system.selectDirectory();
  if (folderPath) await addFavorite(folderPath);
}

async function openItem(item) {
  const result = await workbench.files.open(item.path);
  if (!result.ok) toast(result.error || '无法打开', 'error');
}

async function revealItem(item) {
  await workbench.files.reveal(item.path);
}

async function removeItem(item) {
  items.value = await workbench.files.favorites.remove(item.id);
}

onMounted(loadItems);
</script>