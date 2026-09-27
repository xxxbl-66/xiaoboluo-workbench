<template>
  <section class="work-focus panel" aria-label="当前工作重点">
    <div v-if="loading && !activeSession" class="empty-state small" role="status">正在读取工作进度…</div>
    <div v-else-if="error && !activeSession" class="state-error" role="alert">
      工作进度加载失败：{{ error }}
      <button class="ghost small" type="button" @click="load">重试</button>
    </div>
    <template v-else-if="activeSession">
      <div class="work-focus__top">
        <span class="work-focus__eyebrow"><span class="work-focus__dot"></span> 当前正在工作</span>
        <span class="work-focus__time">已进行 {{ formatDuration(elapsedSeconds) }}</span>
      </div>
      <h2>{{ activeWorkspace?.id === activeSession.workspaceId ? activeWorkspace.name : '当前工作空间' }}</h2>
      <div v-if="lastSession?.nextStep" class="work-focus__next">
        <span>上次留下的下一步</span>
        <strong>{{ lastSession.nextStep }}</strong>
      </div>
      <p class="work-focus__sub">本次工作正在计时。任务、资料和结束记录都在工作空间中。</p>
      <p v-if="error" class="state-error" role="alert">项目资料暂时无法读取：{{ error }} <button class="ghost small" type="button" @click="load">重试</button></p>
      <div class="work-focus__actions">
        <button class="primary" type="button" @click="$emit('open', activeSession.workspaceId)">进入工作空间</button>
        <button class="ghost" type="button" @click="$emit('end', activeSession.workspaceId)">结束工作</button>
      </div>
    </template>
    <template v-else-if="recent">
      <div class="work-focus__top">
        <span class="work-focus__eyebrow">继续最近工作</span>
        <span class="work-focus__time">{{ recent.lastWorkedAt ? formatRelative(recent.lastWorkedAt) : '尚无工作记录' }}</span>
      </div>
      <h2>{{ recent.name }}</h2>
      <div class="work-focus__next">
        <span>下一步</span>
        <strong>{{ lastSession?.nextStep || '上次未留下下一步，进入工作空间查看当前任务。' }}</strong>
      </div>
      <p v-if="lastCompleted" class="work-focus__sub">上次完成：{{ lastCompleted }}</p>
      <div class="work-focus__actions">
        <button v-if="lastSession" class="primary" type="button" @click="$emit('continue', recent.id)">继续工作</button>
        <button v-else class="primary" type="button" @click="$emit('open', recent.id)">进入工作空间</button>
        <button v-if="lastSession" class="ghost" type="button" @click="$emit('open', recent.id)">先查看项目</button>
      </div>
      <p v-if="lastSession" class="work-focus__hint">继续会创建新工作记录，并按设置打开工作环境。</p>
    </template>
    <template v-else>
      <span class="work-focus__eyebrow">开始使用</span>
      <h2>把正在做的事放进工作空间</h2>
      <p class="work-focus__sub">建立项目后，任务、资料和每次工作的下一步都能集中查看。</p>
      <button class="primary" type="button" @click="$emit('go-workspace')">创建工作空间</button>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { workbench } from '../composables/useWorkbench.js';
import { useWorkSession } from '../composables/useWorkSession.js';
import { formatDuration, formatRelative } from '../utils/duration.js';

defineEmits(['open', 'continue', 'end', 'go-workspace']);
const { activeSession, elapsedSeconds } = useWorkSession();
const recent = ref(null);
const activeWorkspace = ref(null);
const lastSession = ref(null);
const loading = ref(true);
const error = ref('');
let generation = 0;
const lastCompleted = computed(() => {
  const items = lastSession.value?.completedTodos;
  if (!Array.isArray(items)) return '';
  return items.filter((item) => item && typeof item.title === 'string').slice(0, 2).map((item) => item.title).join('、');
});

async function load() {
  const request = ++generation;
  loading.value = true;
  error.value = '';
  try {
    if (activeSession.value) {
      activeWorkspace.value = null;
      lastSession.value = null;
      const activeWorkspaceId = activeSession.value.workspaceId;
      const list = await workbench.workspaces.list({ includeArchived: true });
      if (request !== generation) return;
      activeWorkspace.value = list.find((item) => item.id === activeWorkspaceId) || null;
      recent.value = null;
      try {
        const prior = await workbench.sessions.last(activeWorkspaceId);
        if (request === generation && activeSession.value?.workspaceId === activeWorkspaceId) lastSession.value = prior;
      } catch (_) {
        if (request === generation) lastSession.value = null;
      }
    } else {
      const list = await workbench.workspaces.recent(1);
      if (request !== generation) return;
      recent.value = list[0] || null;
      activeWorkspace.value = null;
      const prior = recent.value ? await workbench.sessions.last(recent.value.id) : null;
      if (request !== generation || activeSession.value) return;
      lastSession.value = prior;
    }
  } catch (reason) {
    if (request === generation) error.value = reason?.message || '未知错误';
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch(() => activeSession.value?.id, load);
onMounted(load);
</script>

<style scoped>
.work-focus { display: flex; flex-direction: column; gap: 12px; border-left: 3px solid var(--primary); padding: 20px 24px; }
.work-focus__top, .work-focus__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.work-focus__top { justify-content: space-between; }
.work-focus__eyebrow { color: var(--primary); font-weight: 700; font-size: 12px; display: inline-flex; align-items: center; gap: 7px; }
.work-focus__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
.work-focus__time, .work-focus__sub, .work-focus__hint { color: var(--text-muted); font-size: 12px; }
.work-focus h2 { margin: 0; font-size: 22px; line-height: 1.3; }
.work-focus__sub, .work-focus__hint { margin: 0; }
.work-focus__next { display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; border-radius: var(--radius-sm); background: var(--primary-soft); }
.work-focus__next span { font-size: 11px; color: var(--text-muted); }
.work-focus__next strong { font-size: 15px; font-weight: 650; }
@media (max-width: 720px) { .work-focus { padding: 16px; } }
</style>
