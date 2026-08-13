<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>快捷应用</h2>
        <p>启动本地程序，工作台不接管外部软件。</p>
      </div>
      <div class="panel-actions">
        <button class="ghost" type="button" @click="scanDesktop">扫描桌面</button>
        <button class="primary" type="button" @click="openAddApp">添加应用</button>
      </div>
    </div>

    <div class="group-tabs">
      <button
        v-for="group in groups"
        :key="group.id"
        class="group-tab"
        :class="{ active: activeGroupId === group.id }"
        type="button"
        @click="activeGroupId = group.id"
      >
        {{ group.name }}
      </button>
      <button class="group-tab ghost-tab" type="button" @click="openGroupModal()">＋ 分组</button>
    </div>

    <div v-if="activeApps.length" class="app-grid">
      <article
        v-for="app in activeApps"
        :key="app.id"
        class="app-card"
        draggable="true"
        @dragstart="dragAppId = app.id"
        @dragover.prevent
        @drop="handleDrop(app.id)"
        @dblclick="launch(app)"
      >
        <img v-if="app.iconDataUrl" class="app-icon" :src="app.iconDataUrl" alt="" />
        <div v-else class="app-icon fallback"><LineIcon name="app" :size="24" /></div>
        <div class="app-name" :title="app.name">{{ app.name }}</div>
        <button class="app-launch" type="button" @click="launch(app)">启动</button>
        <div class="app-card-actions">
          <button type="button" title="编辑" @click="openEditApp(app)">✎</button>
          <button type="button" title="删除" @click="removeApp(app)">🗑</button>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><LineIcon name="app" :size="30" /></div>
      <p>这里还没有应用，点击“添加应用”或“扫描桌面”。</p>
    </div>

    <Modal v-model="showAppModal" :title="editingApp ? '编辑应用' : '添加应用'" @close="closeAppModal">
      <div class="form-grid">
        <label>
          应用路径
          <input :value="appForm.path" readonly />
        </label>
        <label>
          名称
          <input v-model="appForm.name" placeholder="输入应用名称" />
        </label>
        <label>
          所属分组
          <select v-model="appForm.groupId">
            <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
        </label>
      </div>
      <template #footer>
        <button class="ghost" type="button" @click="closeAppModal">取消</button>
        <button class="primary" type="button" @click="saveApp">保存</button>
      </template>
    </Modal>

    <Modal v-model="showGroupModal" :title="editingGroup ? '编辑分组' : '新建分组'" width="380px" @close="closeGroupModal">
      <label>
        分组名称
        <input v-model="groupForm.name" placeholder="例如：工作 / 设计 / 娱乐" />
      </label>
      <template #footer>
        <button class="ghost" type="button" @click="closeGroupModal">取消</button>
        <button class="primary" type="button" @click="saveGroup">保存</button>
      </template>
    </Modal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from './Modal.vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const groups = ref([]);
const apps = ref([]);
const activeGroupId = ref('default');
const showAppModal = ref(false);
const showGroupModal = ref(false);
const editingApp = ref(null);
const editingGroup = ref(null);
const dragAppId = ref(null);
const appForm = ref({ path: '', name: '', groupId: 'default' });
const groupForm = ref({ name: '' });

const activeApps = computed(() => {
  const list = apps.value.filter((item) => item.groupId === activeGroupId.value);
  return [...list].sort((a, b) => (a.sort || 0) - (b.sort || 0));
});

async function loadGroups() {
  groups.value = await workbench.groups.list();
  if (!groups.value.some((item) => item.id === activeGroupId.value)) {
    activeGroupId.value = groups.value[0]?.id || 'default';
  }
}

async function loadApps() {
  apps.value = await workbench.apps.list();
}

async function openAddApp() {
  const filePath = await workbench.system.selectApp();
  if (!filePath) return;
  const name = filePath.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd)$/i, '');
  editingApp.value = null;
  appForm.value = { path: filePath, name, groupId: activeGroupId.value };
  showAppModal.value = true;
}

function openEditApp(app) {
  editingApp.value = app;
  appForm.value = { path: app.path, name: app.name, groupId: app.groupId };
  showAppModal.value = true;
}

function closeAppModal() {
  showAppModal.value = false;
  editingApp.value = null;
}

async function saveApp() {
  try {
    if (editingApp.value) {
      await workbench.apps.update(editingApp.value.id, {
        name: appForm.value.name,
        groupId: appForm.value.groupId
      });
    } else {
      await workbench.apps.add(appForm.value.path, {
        name: appForm.value.name,
        groupId: appForm.value.groupId
      });
    }
    await loadApps();
    closeAppModal();
    toast('应用已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function removeApp(app) {
  if (!window.confirm(`确定删除“${app.name}”吗？`)) return;
  apps.value = await workbench.apps.remove(app.id);
}

async function launch(app) {
  try {
    await workbench.apps.launch(app.id);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function scanDesktop() {
  try {
    const added = await workbench.apps.scanDesktop(activeGroupId.value);
    await loadApps();
    toast(added.length ? `已添加 ${added.length} 个桌面应用` : '没有发现新的桌面应用');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openGroupModal(group = null) {
  editingGroup.value = group;
  groupForm.value = { name: group ? group.name : '' };
  showGroupModal.value = true;
}

function closeGroupModal() {
  showGroupModal.value = false;
  editingGroup.value = null;
}

async function saveGroup() {
  try {
    if (editingGroup.value) {
      await workbench.groups.update(editingGroup.value.id, groupForm.value.name);
    } else {
      const group = await workbench.groups.create(groupForm.value.name);
      activeGroupId.value = group.id;
    }
    await loadGroups();
    closeGroupModal();
    toast('分组已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function handleDrop(targetId) {
  if (!dragAppId.value || dragAppId.value === targetId) return;
  const ordered = activeApps.value.map((item) => item.id);
  const fromIndex = ordered.indexOf(dragAppId.value);
  const toIndex = ordered.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) return;
  ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, dragAppId.value);
  dragAppId.value = null;
  try {
    const reordered = await workbench.apps.reorder(activeGroupId.value, ordered);
    apps.value = apps.value.map((item) => reordered.find((next) => next.id === item.id) || item);
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(async () => {
  await loadGroups();
  await loadApps();
});
</script>
