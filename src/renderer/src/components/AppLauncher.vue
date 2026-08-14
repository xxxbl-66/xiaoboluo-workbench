<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>快捷应用</h2>
        <p>启动本地程序，工作台不接管外部软件。</p>
      </div>
      <div class="panel-actions">
        <button class="ghost" type="button" @click="scanFolder">选择文件夹</button>
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
        @dragstart="startDrag(app.id)"
        @dragover.prevent
        @drop="handleDrop(app.id)"
        @dragend="endDrag"
        @click="clickApp(app)"
      >
        <img v-if="app.iconDataUrl" class="app-icon" :src="app.iconDataUrl" alt="" />
        <div v-else class="app-icon fallback"><LineIcon name="app" :size="24" /></div>
        <div class="app-name" :title="app.name">{{ app.name }}</div>

        <div class="app-card-actions">
          <button type="button" title="编辑" @click.stop="openEditApp(app)"><LineIcon name="edit" :size="14" /></button>
          <button type="button" title="删除" @click.stop="removeApp(app)"><LineIcon name="trash" :size="14" /></button>
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
<Modal v-model="showScanModal" title="选择要添加的应用" width="560px" @close="closeScanModal">
      <div v-if="scanLoading" class="scan-state">正在扫描应用…</div>
      <div v-else-if="scanCandidates.length" class="scan-candidate-list">
        <button
          v-for="candidate in scanCandidates"
          :key="candidate.path"
          type="button"
          class="scan-candidate"
          :class="{ selected: isSelected(candidate.path) }"
          @click="toggleCandidate(candidate.path)"
        >
          <span class="scan-checkbox" :class="{ checked: isSelected(candidate.path) }">
            <LineIcon v-if="isSelected(candidate.path)" name="check" :size="13" />
          </span>
          <img v-if="candidate.iconDataUrl" class="scan-icon" :src="candidate.iconDataUrl" alt="" />
          <div v-else class="scan-icon fallback"><LineIcon name="app" :size="20" /></div>
          <div class="scan-meta">
            <div class="scan-name">{{ candidate.name }}</div>
            <div class="scan-path">{{ candidate.path }}</div>
          </div>
        </button>
      </div>
      <div v-else class="scan-state">没有发现新的应用。</div>
      <template #footer>
        <button class="ghost" type="button" @click="toggleSelectAll">
          {{ selectedPaths.length === scanCandidates.length ? '取消全选' : '全选' }}
        </button>
        <button class="ghost" type="button" @click="closeScanModal">取消</button>
        <button class="primary" type="button" :disabled="!selectedPaths.length" @click="addSelectedCandidates">
          添加选中 ({{ selectedPaths.length }})
        </button>
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
const didDrag = ref(false);
const appForm = ref({ path: '', name: '', groupId: 'default' });
const groupForm = ref({ name: '' });
const showScanModal = ref(false);
const scanLoading = ref(false);
const scanCandidates = ref([]);
const selectedPaths = ref([]);

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

async function runScan(folderPath) {
  scanLoading.value = true;
  scanCandidates.value = [];
  selectedPaths.value = [];
  showScanModal.value = true;
  try {
    scanCandidates.value = await workbench.apps.scanCandidates(folderPath || '');
  } catch (error) {
    toast(error.message, 'error');
    showScanModal.value = false;
  } finally {
    scanLoading.value = false;
  }
}

async function scanDesktop() {
  await runScan('');
}

async function scanFolder() {
  const folderPath = await workbench.system.selectDirectory();
  if (!folderPath) return;
  await runScan(folderPath);
}

function toggleCandidate(path) {
  selectedPaths.value = isSelected(path)
    ? selectedPaths.value.filter((item) => item !== path)
    : [...selectedPaths.value, path];
}

function isSelected(path) {
  return selectedPaths.value.includes(path);
}

function toggleSelectAll() {
  if (selectedPaths.value.length === scanCandidates.value.length) {
    selectedPaths.value = [];
  } else {
    selectedPaths.value = scanCandidates.value.map((item) => item.path);
  }
}

async function addSelectedCandidates() {
  const chosen = scanCandidates.value.filter((item) => isSelected(item.path));
  if (!chosen.length) return;
  try {
    const payload = chosen.map((item) => ({
      path: item.path,
      name: item.name,
      iconSource: item.iconSource
    }));
    const added = await workbench.apps.addBatch(payload, activeGroupId.value);
    await loadApps();
    showScanModal.value = false;
    toast(added.length ? '已添加 ' + added.length + ' 个应用' : '未添加新应用');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function closeScanModal() {
  showScanModal.value = false;
  scanCandidates.value = [];
  selectedPaths.value = [];
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

function startDrag(id) {
  didDrag.value = true;
  dragAppId.value = id;
}

function endDrag() {
  setTimeout(() => {
    didDrag.value = false;
    dragAppId.value = null;
  }, 0);
}

function clickApp(app) {
  if (didDrag.value) return;
  launch(app);
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

<style scoped>
.group-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: none;
}

.group-tabs::-webkit-scrollbar {
  display: none;
}

.group-tab {
  flex: 0 0 auto;
}

.app-grid {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 4px 2px 12px;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}

.app-grid::-webkit-scrollbar {
  height: 8px;
}

.app-grid::-webkit-scrollbar-track {
  background: transparent;
}

.app-grid::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
}

.app-grid .app-card {
  flex: 0 0 132px;
  min-height: 142px;
  scroll-snap-align: start;
  user-select: none;
}

.scan-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow: auto;
}

.scan-candidate {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
}

.scan-candidate:hover {
  background: var(--surface-2);
}

.scan-candidate.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.scan-checkbox {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--border-strong);
  border-radius: 5px;
  color: #fff;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.scan-checkbox.checked {
  background: var(--primary);
  border-color: var(--primary);
}

.scan-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  object-fit: contain;
  border-radius: 8px;
}

.scan-icon.fallback {
  display: grid;
  place-items: center;
  background: var(--primary-soft);
  color: var(--primary-strong);
}

.scan-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scan-name {
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scan-path {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scan-state {
  padding: 24px;
  text-align: center;
  color: var(--text-faint);
}
</style>
