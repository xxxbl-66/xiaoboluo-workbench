import { computed, reactive, ref } from 'vue';

const timerMode = ref('countdown');
const timerSeconds = ref(25 * 60);
const durationMinutes = ref(25);
const running = ref(false);
const ringtone = ref({ type: 'builtin', id: 'chime' });
let tickHandle = null;
let customAudio = null;

const displayTime = computed(() => {
  const total = Math.max(0, Math.floor(timerSeconds.value));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
});

function clearTick() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function stopAlarm() {
  if (customAudio) {
    try {
      customAudio.pause();
      customAudio.currentTime = 0;
    } catch (_) {}
    customAudio = null;
  }
}

function playBuiltin(id) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    const patterns = {
      chime: [[880, 0, 0.18], [1174.66, 0.2, 0.22], [1567.98, 0.45, 0.36]],
      wind: [[523.25, 0, 0.24], [659.25, 0.2, 0.24], [783.99, 0.45, 0.42]],
      beep: [[660, 0, 0.16], [660, 0.2, 0.16], [660, 0.4, 0.28]]
    };
    const sequence = patterns[id] || patterns.chime;
    sequence.forEach(([frequency, start, duration]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const startAt = now + start;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.08);
    });
    const last = sequence[sequence.length - 1];
    const closeAt = (last[1] + last[2] + 0.5) * 1000;
    setTimeout(() => {
      try {
        context.close();
      } catch (_) {}
    }, closeAt);
  } catch (_) {}
}

function playAlarm() {
  const tone = ringtone.value || { type: 'builtin', id: 'chime' };
  if (tone.type === 'custom' && tone.dataUrl) {
    try {
      customAudio = new Audio(tone.dataUrl);
      customAudio.play();
    } catch (_) {}
    return;
  }
  playBuiltin(tone.id || 'chime');
}

function tick() {
  if (timerMode.value === 'countdown') {
    if (timerSeconds.value <= 0) {
      timerSeconds.value = 0;
      running.value = false;
      clearTick();
      playAlarm();
      return;
    }
    timerSeconds.value -= 1;
  } else {
    timerSeconds.value += 1;
  }
}

function start() {
  if (running.value) return;
  if (timerMode.value === 'countdown' && timerSeconds.value <= 0) {
    timerSeconds.value = Math.max(1, durationMinutes.value) * 60;
  }
  running.value = true;
  clearTick();
  tickHandle = setInterval(tick, 1000);
}

function pause() {
  running.value = false;
  clearTick();
  stopAlarm();
}

function toggle() {
  if (running.value) pause();
  else start();
}

function reset() {
  pause();
  timerSeconds.value = timerMode.value === 'countdown'
    ? Math.max(1, durationMinutes.value) * 60
    : 0;
}

function switchMode(mode) {
  if (running.value) return;
  timerMode.value = mode;
  reset();
}

function setDuration(minutes) {
  const value = Math.max(1, Math.round(Number(minutes) || 1));
  durationMinutes.value = value;
  if (!running.value && timerMode.value === 'countdown') {
    timerSeconds.value = value * 60;
  }
}

function setRingtone(tone) {
  ringtone.value = tone || { type: 'builtin', id: 'chime' };
}

export function useTimer() {
  return reactive({
    timerMode,
    timerSeconds,
    durationMinutes,
    running,
    displayTime,
    start,
    pause,
    toggle,
    reset,
    switchMode,
    setDuration,
    setRingtone,
    playAlarm,
    stopAlarm
  });
}