<template>
  <div class="timer-widget">
    <div class="timer-tabs">
      <button :class="{ active: timer.timerMode === 'countdown' }" type="button" @click="timer.switchMode('countdown')">倒计时</button>
      <button :class="{ active: timer.timerMode === 'stopwatch' }" type="button" @click="timer.switchMode('stopwatch')">秒表</button>
    </div>

    <div class="timer-display">{{ timer.displayTime }}</div>

    <div v-if="timer.timerMode === 'countdown'" class="timer-countdown">
      <div class="timer-presets">
        <button
          v-for="preset in presets"
          :key="preset.minutes"
          class="preset-chip"
          :class="{ active: !timer.running && timer.durationMinutes === preset.minutes }"
          type="button"
          @click="applyPreset(preset.minutes)"
        >
          {{ preset.label }}
        </button>
      </div>

      <div class="timer-minutes">
        <input v-model.number="customMinutes" type="number" min="1" max="600" :disabled="timer.running" @change="applyCustom" />
        <span>分钟</span>
      </div>
    </div>

    <div class="timer-actions">
      <button class="primary small" type="button" @click="timer.toggle()">
        {{ timer.running ? '暂停' : '开始' }}
      </button>
      <button class="ghost small" type="button" @click="timer.reset()">重置</button>
    </div>

    <p class="timer-hint">计时结束后会播放设置的提醒铃声。</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useTimer } from '../composables/useTimer.js';
import { workbench } from '../composables/useWorkbench.js';

const timer = useTimer();
const presets = [
  { label: '5 分钟', minutes: 5 },
  { label: '10 分钟', minutes: 10 },
  { label: '15 分钟', minutes: 15 },
  { label: '25 分钟', minutes: 25 },
  { label: '45 分钟', minutes: 45 },
  { label: '60 分钟', minutes: 60 }
];
const customMinutes = ref(timer.durationMinutes);

function applyPreset(minutes) {
  customMinutes.value = minutes;
  timer.setDuration(minutes);
}

function applyCustom() {
  timer.setDuration(customMinutes.value);
}

onMounted(async () => {
  try {
    const settings = await workbench.settings.get();
    timer.setRingtone(settings.timerRingtone || { type: 'builtin', id: 'chime' });
  } catch (_) {}
});
</script>

<style scoped>
.timer-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.timer-tabs button {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
}

.timer-tabs button.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.timer-display {
  font-family: var(--font-mono);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: center;
  color: var(--text);
}

.timer-countdown {
  margin-top: 12px;
}

.timer-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}

.preset-chip {
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
}

.preset-chip.active {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary-strong);
}

.timer-minutes {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 10px 0;
}

.timer-minutes input {
  width: 72px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-align: center;
  outline: none;
}

.timer-minutes input:focus {
  border-color: var(--primary);
}

.timer-minutes span {
  color: var(--text-muted);
  font-size: 13px;
}

.timer-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.timer-hint {
  margin: 10px 0 0;
  color: var(--text-faint);
  font-size: 11px;
  text-align: center;
}
</style>