<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>图片收藏</h2>
        <p>原图路径不变，缩略图缓存到本地数据目录。</p>
      </div>
      <button class="primary" type="button" @click="addImage">添加图片</button>
    </div>

    <div v-if="items.length" class="image-grid">
      <figure v-for="item in items" :key="item.id" class="image-card">
        <div class="image-preview" @click="preview = item">
          <img v-if="item.thumbnailDataUrl" :src="item.thumbnailDataUrl" :alt="item.name" />
          <div v-else class="image-missing">缩略图不可用</div>
        </div>
        <figcaption>
          <span :title="item.name">{{ item.name }}</span>
          <div>
            <button class="icon-button" type="button" @click="openOriginal(item)">↗</button>
            <button class="icon-button danger" type="button" @click="removeImage(item)">×</button>
          </div>
        </figcaption>
      </figure>
    </div>
    <div v-else class="empty-state"><div class="empty-icon"><LineIcon name="image" :size="30" /></div><p>还没有图片收藏。</p></div>

    <Modal :model-value="!!preview" title="图片预览" width="860px" @close="preview = null">
      <div class="preview-body">
        <img v-if="preview && preview.thumbnailDataUrl" :src="preview.thumbnailDataUrl" :alt="preview.name" />
      </div>
      <template #footer>
        <span class="preview-path">{{ preview ? preview.path : '' }}</span>
        <button class="ghost" type="button" @click="preview = null">关闭</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const items = ref([]);
const preview = ref(null);

async function loadItems() {
  items.value = await workbench.files.images.list();
}

async function addImage() {
  try {
    const filePath = await workbench.system.selectImage();
    if (!filePath) return;
    const entry = await workbench.files.images.add(filePath);
    items.value = [entry, ...items.value.filter((item) => item.id !== entry.id)];
    toast('已添加图片');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function openOriginal(item) {
  const result = await workbench.files.open(item.path);
  if (!result.ok) toast('原图已删除或无法打开', 'error');
}

async function removeImage(item) {
  items.value = await workbench.files.images.remove(item.id);
}

onMounted(loadItems);
</script>
