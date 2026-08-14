<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="avatar-button">
        <img v-if="user.avatarDataUrl" :src="user.avatarDataUrl" alt="头像" />
        <span v-else>{{ user.name ? user.name.slice(0, 1) : '小' }}</span>
      </div>
      <div class="brand-text">
        <strong>{{ user.name || '小菠萝' }}</strong>
        <span>的工作台</span>
      </div>
    </div>

    <section class="checkin-card">
      <div class="checkin-date">{{ todayLabel }}</div>
      <button class="checkin-button" :class="{ done: checkin.todayChecked }" type="button" @click="toggleCheckin">
        {{ checkin.todayChecked ? '今日已打卡' : '打卡签到' }}
      </button>
      <div class="checkin-streak">连续打卡 {{ checkin.streak }} 天 · 累计 {{ checkin.total }} 天</div>
    </section>

    <nav class="nav-list">
      <button
        v-for="item in orderedNavItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: active === item.id, dragging: dragId === item.id }"
        type="button"
        draggable="true"
        @dragstart="startDrag(item.id, $event)"
        @dragover.prevent
        @drop="dropOn(item.id)"
        @dragend="dragId = null"
        @click="$emit('navigate', item.id)"
      >
        <span class="drag-handle"><LineIcon name="menu" :size="12" /></span>
        <span class="nav-icon"><LineIcon :name="item.icon" :size="19" /></span>
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <span>本地离线 · 数据不丢失</span>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import LineIcon from './LineIcon.vue';
import { workbench } from '../composables/useWorkbench.js';
import { toast } from '../composables/toast.js';

const props = defineProps({
  active: {
    type: String,
    default: 'dashboard'
  },
  settings: {
    type: Object,
    default: () => ({ user: { name: '小菠萝', avatarDataUrl: '' }, navOrder: [] })
  }
});

defineEmits(['navigate']);

const checkin = ref({ todayChecked: false, streak: 0, total: 0, dates: [] });
const settings = ref({ user: { name: '小菠萝', avatarDataUrl: '' }, navOrder: [] });
const user = ref({ name: '小菠萝', avatarDataUrl: '' });
const dragId = ref(null);

watch(
  () => props.settings,
  (value) => {
    if (!value) return;
    settings.value = value;
    user.value = {
      name: value.user?.name || '小菠萝',
      avatarDataUrl: value.user?.avatarDataUrl || ''
    };
  },
  { immediate: true, deep: true }
);

const baseNavItems = [
  { id: 'dashboard', icon: 'dashboard', label: '驾驶舱' },
  { id: 'todos', icon: 'todos', label: '待办' },
  { id: 'calendar', icon: 'calendar', label: '日历' },
  { id: 'review', icon: 'review', label: '今日复盘' },
  { id: 'bookmarks', icon: 'bookmarks', label: '收藏夹' },
  { id: 'bookshelf', icon: 'bookshelf', label: '我的书架' },
  { id: 'files', icon: 'files', label: '文件' },
  { id: 'chat', icon: 'chat', label: '对话' },
  { id: 'settings', icon: 'settings', label: '设置' }
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
    user.value = { name: settingsData.user?.name || '小菠萝', avatarDataUrl: settingsData.user?.avatarDataUrl || '' };
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
  const ids = orderedNavItems.value.map((item) => item.id);
  const from = ids.indexOf(dragId.value);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return;
  ids.splice(from, 1);
  ids.splice(to, 0, dragId.value);
  dragId.value = null;
  try {
    const next = await workbench.settings.update({ navOrder: ids });
    settings.value = next;
    toast('导航顺序已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

onMounted(loadSidebar);
</script>
