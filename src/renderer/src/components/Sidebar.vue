<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="avatar-button">
        <img v-if="user.avatarDataUrl" :src="user.avatarDataUrl" alt="头像" />
        <span v-else>{{ user.name ? user.name.slice(0, 1) : '小' }}</span>
      </div>
      <div class="brand-text">
        <strong>四一四工作台</strong>
        <span>{{ user.name }}</span>
      </div>
    </div>

    <section class="checkin-card">
      <div class="checkin-date">{{ todayLabel }}</div>
      <button class="checkin-button" :class="{ done: checkin.todayChecked }" type="button" @click="toggleCheckin">
        {{ checkin.todayChecked ? '今日已打卡' : '打卡签到' }}
      </button>
      <div class="checkin-streak">连续打卡 {{ checkin.streak }} 天 · 累计 {{ checkin.total }} 天</div>
    </section>

    <nav class="nav-list" aria-label="主导航">
      <div v-for="group in navGroups" :key="group.label" class="nav-group" :class="{ 'nav-group--bottom': group.label === '设置' }">
        <p class="nav-group__title">{{ group.label }}</p>
        <button
          v-for="item in group.items"
          :key="item.id"
          class="nav-item"
          :class="{ active: active === item.id, dragging: dragId === item.id }"
          type="button"
          :aria-current="active === item.id ? 'page' : undefined"
          draggable="true"
          @dragstart="startDrag(item.id, $event)"
          @dragover.prevent
          @drop="dropOn(item.id)"
          @dragend="dragId = null"
          @click="$emit('navigate', item.id)"
        >
          <span class="drag-handle"><LineIcon name="menu" :size="12" /></span>
          <span class="nav-icon"><LineIcon :name="item.icon" :size="18" /></span>
          <span class="nav-item__label">{{ item.label }}</span>
          <span v-if="item.id === 'workspace' && activeSession" class="nav-working" title="有正在进行的工作">●</span>
        </button>
      </div>
    </nav>

    <div class="sidebar-footer">
      <span>本地离线 · 数据存于本机</span>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';
import { useWorkSession } from '../composables/useWorkSession.js';

const props = defineProps({
  active: {
    type: String,
    default: 'dashboard'
  },
  settings: {
    type: Object,
    default: () => ({ user: { name: '用户', avatarDataUrl: '' }, navOrder: [] })
  }
});

defineEmits(['navigate']);

const checkin = ref({ todayChecked: false, streak: 0, total: 0, dates: [] });
const settings = ref({ user: { name: '用户', avatarDataUrl: '' }, navOrder: [] });
const user = ref({ name: '用户', avatarDataUrl: '' });
const dragId = ref(null);
const { activeSession } = useWorkSession();

watch(
  () => props.settings,
  (value) => {
    if (!value) return;
    settings.value = value;
    user.value = {
      name: value.user?.name || '用户',
      avatarDataUrl: value.user?.avatarDataUrl || ''
    };
  },
  { immediate: true, deep: true }
);

const baseNavItems = [
  { id: 'dashboard', icon: 'dashboard', label: '今天', group: '工作' },
  { id: 'workspace', icon: 'workspace', label: '工作空间', group: '工作' },
  { id: 'todos', icon: 'todos', label: '待办', group: '工作' },
  { id: 'calendar', icon: 'calendar', label: '日历', group: '工作' },
  { id: 'files', icon: 'files', label: '文件与便签', group: '资料' },
  { id: 'bookmarks', icon: 'bookmarks', label: '收藏夹', group: '资料' },
  { id: 'bookshelf', icon: 'bookshelf', label: '我的书架', group: '资料' },
  { id: 'workflow', icon: 'play', label: '工作流', group: '工具' },
  { id: 'review', icon: 'review', label: '今日复盘', group: '工具' },
  { id: 'chat', icon: 'chat', label: '对话', group: '工具' },
  { id: 'settings', icon: 'settings', label: '设置', group: '设置' }
];

const orderedNavItems = computed(() => {
  const order = settings.value.navOrder || [];
  const base = [...baseNavItems];
  if (order.length) {
    base.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      const av = ai === -1 ? 999 : ai;
      const bv = bi === -1 ? 999 : bi;
      return av - bv;
    });
  }
  return base;
});
const navGroups = computed(() => ['工作', '资料', '工具', '设置'].map((label) => ({
  label,
  items: orderedNavItems.value.filter((item) => item.group === label)
})));

const todayLabel = computed(() => {
  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 周${week}`;
});

async function loadSidebar() {
  try {
    const [checkinData, settingsData] = await Promise.all([
      workbench.checkins.get(),
      workbench.settings.get()
    ]);
    checkin.value = checkinData;
    settings.value = settingsData;
    user.value = { name: settingsData.user?.name || '用户', avatarDataUrl: settingsData.user?.avatarDataUrl || '' };
  } catch (_) {}
}

async function toggleCheckin() {
  try {
    checkin.value = await workbench.checkins.toggle();
    toast(checkin.value.todayChecked ? '打卡成功' : '已取消今日打卡');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function startDrag(id, event) {
  dragId.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }
}

async function dropOn(targetId) {
  if (!dragId.value || dragId.value === targetId) {
    dragId.value = null;
    return;
  }
  const source = baseNavItems.find((item) => item.id === dragId.value);
  const target = baseNavItems.find((item) => item.id === targetId);
  if (!source || !target || source.group !== target.group) {
    dragId.value = null;
    return;
  }
  const ids = orderedNavItems.value.map((item) => item.id);
  const from = ids.indexOf(dragId.value);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return;
  ids.splice(from, 1);
  ids.splice(to, 0, dragId.value);
  dragId.value = null;
  try {
    const next = await workbench.settings.update({ navOrder: ids });
    if (!next) throw new Error('导航顺序未能保存，请重试。');
    settings.value = next;
    toast('导航顺序已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(loadSidebar);
</script>
