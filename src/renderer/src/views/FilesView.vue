<template>
  <div class="view files-view">
    <header class="view-header">
      <div>
        <h1>文件</h1>
        <p>浏览本地文件，收藏常用文件与图片，记录便签。</p>
      </div>
    </header>

    <div class="segmented-tabs">
      <button :class="{ active: activeTab === 'browser' }" type="button" @click="activeTab = 'browser'">文件浏览</button>
      <button :class="{ active: activeTab === 'favorites' }" type="button" @click="activeTab = 'favorites'">收藏</button>
      <button :class="{ active: activeTab === 'images' }" type="button" @click="activeTab = 'images'">图片</button>
      <button :class="{ active: activeTab === 'notes' }" type="button" @click="activeTab = 'notes'">便签</button>
    </div>

    <FileBrowser v-if="activeTab === 'browser'" />
    <FavoritesPanel v-else-if="activeTab === 'favorites'" />
    <ImagesPanel v-else-if="activeTab === 'images'" />
    <NotesPanel v-else />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import FileBrowser from '../components/FileBrowser.vue';
import FavoritesPanel from '../components/FavoritesPanel.vue';
import ImagesPanel from '../components/ImagesPanel.vue';
import NotesPanel from '../components/NotesPanel.vue';

const activeTab = ref('browser');
</script>
