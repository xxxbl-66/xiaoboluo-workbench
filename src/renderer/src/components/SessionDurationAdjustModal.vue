<template>
  <Modal :model-value="modelValue" :title="finishActive ? '结束并校正工作时长' : '校正有效工作时长'" width="520px" @close="requestClose">
    <div class="duration-adjust">
      <p class="duration-adjust__hint">
        {{ finishActive
          ? '填写有效工作时长后，工作会话才会结束并保存。取消时原会话仍在进行中。'
          : '只校正这次工作的有效时长，开始时间、结束时间、归属工作空间和完成事项都不会被改动。' }}
      </p>

      <div v-if="session" class="duration-adjust__meta">
        <div>
          <span>工作空间</span>
          <strong>{{ workspaceName || '未归类的工作' }}</strong>
        </div>
        <div>
          <span>开始时间</span>
          <strong>{{ formatDateTime(session.startedAt) }}</strong>
        </div>
        <div>
          <span>{{ finishActive ? '当前经过时间' : '记录的墙上时长' }}</span>
          <strong>{{ formatDuration(wallSeconds) }}</strong>
        </div>
        <div>
          <span>校正后有效时长</span>
          <strong>{{ previewSeconds === null ? '待填写' : formatDuration(previewSeconds) }}</strong>
        </div>
      </div>

      <label class="full">
        有效工作时长（分钟）
        <input v-model="minutesInput" type="number" min="0" step="1" inputmode="numeric" />
      </label>
      <p class="duration-adjust__quick">
        <button
          v-for="preset in presets"
          :key="preset"
          class="ghost small"
          type="button"
          :disabled="busy"
          @click="minutesInput = String(preset)"
        >{{ preset }} 分钟</button>
      </p>

      <label class="full">
        校正说明（可选）
        <input v-model="reason" placeholder="例如：忘记结束，实际只工作了 3 小时" maxlength="200" />
      </label>

      <p class="duration-adjust__note">{{ DURATION_ADJUST_HINT }}</p>
      <p v-if="errorMessage" class="duration-adjust__error">{{ errorMessage }}</p>
      <p v-if="adjustmentCount > 0" class="duration-adjust__note">
        这条记录已经校正过 {{ adjustmentCount }} 次，每次校正都会保留上一次的时长记录。
      </p>
    </div>

    <template #footer>
      <button class="ghost" type="button" :disabled="busy" @click="requestClose">取消</button>
      <button class="primary" type="button" :disabled="busy || !canSubmit" @click="submit">
        {{ busy ? '正在保存…' : (finishActive ? '结束并保存' : '保存校正结果') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { formatDuration, formatDateTime } from '../utils/duration.js';
import { adjustSessionDuration, DURATION_ADJUST_HINT, parseDurationSeconds } from '../composables/session-duration.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 要校正的会话（必须是已结束的记录） */
  session: { type: Object, default: null },
  workspaceName: { type: String, default: '' },
  /** 主进程校正函数：(sessionId, seconds, options) => Promise */
  adjust: { type: Function, required: true },
  finishActive: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'adjusted']);

function requestClose() {
  if (!busy.value) emit('close');
}

const presets = [30, 60, 90, 120, 180];

const minutesInput = ref('');
const reason = ref('');
const busy = ref(false);
const errorMessage = ref('');

const wallSeconds = computed(() => {
  if (!props.session) return 0;
  const startedAt = new Date(props.session.startedAt).getTime();
  const endedAt = new Date(props.session.endedAt || Date.now()).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
  return Math.max(0, Math.round((endedAt - startedAt) / 1000));
});

const currentSeconds = computed(() => {
  const value = Number(props.session && props.session.durationSeconds);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
});

const previewSeconds = computed(() => {
  const text = String(minutesInput.value || '').trim();
  if (!text || !/^\d+$/.test(text)) return null;
  const seconds = Number(text) * 60;
  return parseDurationSeconds(seconds).ok ? seconds : null;
});

const canSubmit = computed(() => previewSeconds.value !== null);

const adjustmentCount = computed(() => {
  const value = Number(props.session && props.session.durationAdjustmentCount);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // 默认填当前记录的有效时长，用户在此基础上修正
    minutesInput.value = props.finishActive ? '' : String(Math.round(currentSeconds.value / 60));
    reason.value = '';
    errorMessage.value = '';
    busy.value = false;
  },
  { immediate: true }
);

async function submit() {
  if (busy.value || !canSubmit.value) return;
  busy.value = true;
  errorMessage.value = '';
  try {
    const result = await adjustSessionDuration(props.session, minutesInput.value, {
      unit: 'minutes',
      allowActive: props.finishActive,
      reason: reason.value.trim(),
      adjust: props.adjust
    });
    if (!result.ok) {
      // 失败时不关闭弹窗，保留用户填写的分钟数与说明，可以直接重试
      errorMessage.value = result.error;
      return;
    }
    emit('adjusted', result.session);
    emit('close');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.duration-adjust {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.duration-adjust__hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-xs);
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.duration-adjust__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}

.duration-adjust__meta span {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 3px;
}

.duration-adjust__meta strong {
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
}

.duration-adjust__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: -6px 0 0;
}

.duration-adjust__note {
  margin: 0;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.6;
}

.duration-adjust__error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.full {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
