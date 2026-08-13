<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>文件收藏</h2>
        <p>只保存原始路径，不复制大文件。</p>
      </div>
      <button class="primary" type="button" @click="addFavorite">收藏文件</button>
    </div>

    <div v-if="items.length" class="favorite-list">
      <article v-for="item in items" :key="item.id" class="favorite-item">
        <div class="favorite-icon">📄</div>
        <div class="favorite-info" @dblclick="openItem(item)">
          <strong>{{ item.name }}</strong>
          <span>{{ item.path }}</span>
        </div>
        <div class="favorite-actions">
          <button class="ghost small" type="button" @click="openItem(item)">打开</button>
          <button class="icon-button" type="button" title="在文件夹中显示" @click="revealItem(item)">🔍</button>
          <button class="icon-button danger" type="button" @click="removeItem(item)">×</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state small"><p>还没有文件收藏。</p></div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const items = ref([]);

async function loadItems() {
  items.value = await workbench.files.favorites.list();
}

async function addFavorite() {
  try {
    const filePath = await workbench.system.selectFile();
    if (!filePath) return;
    items.value = await workbench.files.favorites.add(filePath);
    toast('已收藏');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openItem(item) {
  const result = await workbench.files.open(item.path);
  if (!result.ok) toast(result.error || '无法打开文件', 'error');
}

async function revealItem(item) {
  await workbench.files.reveal(item.path);
}

async function removeItem(item) {
  items.value = await workbench.files.favorites.remove(item.id);
}

onMounted(loadItems);
</script>
