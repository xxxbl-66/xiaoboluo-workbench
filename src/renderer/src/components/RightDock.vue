<template>
  <aside class="right-dock">
    <section class="dock-card">
      <header class="dock-header">
        <span>快速便签</span>
        <span class="dock-hint" :class="{ saving }">{{ saving ? '保存中…' : '已保存' }}</span>
      </header>
      <textarea
        v-model="quickContent"
        class="quick-note"
        placeholder="随手记点什么…"
        spellcheck="false"
      ></textarea>
    </section>

    <section class="dock-card timer-card">
      <header class="dock-header">
        <span>计时器</span>
        <span class="dock-hint">{{ running ? '运行中' : '已停止' }}</span>
      </header>

      <div class="timer-tabs">
        <button :class="{ active: timerMode === 'countdown' }" type="button" @click="switchMode('countdown')">倒计时</button>
        <button :class="{ active: timerMode === 'stopwatch' }" type="button" @click="switchMode('stopwatch')">秒表</button>
      </div>

      <div class="timer-display">{{ displayTime }}</div>

      <div v-if="timerMode === 'countdown'" class="timer-minutes">
        <input v-model.number="minutes" type="number" min="1" max="180" :disabled="running" />
        <span>分钟</span>
      </div>

      <div class="timer-actions">
        <button class="primary small" type="button" @click="toggleTimer">
          {{ running ? '暂停' : '开始' }}
        </button>
        <button class="ghost small" type="button" @click="resetTimer">重置</button>
      </div>
    </section>
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { workbench } from '../composables/useWorkbench.js';

const quickContent = ref('');
const saving = ref(false);
let saveTimer = null;

const timerMode = ref('countdown');
const minutes = ref(25);
const timerSeconds = ref(25 * 60);
const running = ref(false);
let timerId = null;

const displayTime = computed(() => {
  const total = Math.max(0, Math.floor(timerSeconds.value));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
});

async function loadQuickNote() {
  try {
    const note = await workbench.files.notes.getQuick();
    quickContent.value = note.content || '';
  } catch (_) {}
}

watch(quickContent, (value) => {
  if (saveTimer) clearTimeout(saveTimer);
  saving.value = true;
  saveTimer = setTimeout(async () => {
    try {
      await workbench.files.notes.saveQuick(value);
    } finally {
      saving.value = false;
    }
  }, 450);
});

function switchMode(mode) {
  if (running.value) return;
  timerMode.value = mode;
  resetTimer();
}

function startTicking() {
  if (timerId) return;
  timerId = setInterval(() => {
    if (timerMode.value === 'countdown') {
      if (timerSeconds.value <= 0) {
        stopTicking();
        running.value = false;
        return;
      }
      timerSeconds.value -= 1;
    } else {
      timerSeconds.value += 1;
    }
  }, 1000);
}

function stopTicking() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function toggleTimer() {
  running.value = !running.value;
  if (running.value) {
    startTicking();
  } else {
    stopTicking();
  }
}

function resetTimer() {
  stopTicking();
  running.value = false;
  timerSeconds.value = timerMode.value === 'countdown' ? Math.max(1, minutes.value) * 60 : 0;
}

onMounted(loadQuickNote);

onBeforeUnmount(() => {
  stopTicking();
  if (saveTimer) {
    clearTimeout(saveTimer);
    if (quickContent.value) workbench.files.notes.saveQuick(quickContent.value).catch(() => {});
  }
});
</script>
