<template>
  <Modal :model-value="modelValue" title="还在工作中" width="480px" @close="backToWork">
    <div class="shutdown-confirm">
      <p class="shutdown-confirm__question">当前还有正在进行的工作，是否结束本次工作？</p>

      <div v-if="session" class="shutdown-confirm__meta">
        <div>
          <span>工作空间</span>
          <strong>{{ workspaceName || '未归类的工作' }}</strong>
        </div>
        <div>
          <span>已进行</span>
          <strong>{{ formatDuration(elapsedSeconds) }}</strong>
        </div>
      </div>

      <ul class="shutdown-confirm__options">
        <li><strong>返回工作</strong>：取消关闭，当前工作继续计时，窗口保持可用。</li>
        <li><strong>结束工作</strong>：直接结束这次工作并保存时长，保存成功后关闭应用。需要填写完成事项与备注时，可以先返回工作再结束。</li>
        <li><strong>保留会话并退出</strong>：这次工作保持未结束，下次启动会提示你处理，不会静默算作已完成。</li>
      </ul>

      <p v-if="errorMessage" class="shutdown-confirm__error">{{ errorMessage }}</p>
    </div>

    <template #footer>
      <button class="ghost" type="button" :disabled="busy" @click="backToWork">返回工作</button>
      <button class="ghost" type="button" :disabled="busy" @click="$emit('keep')">保留会话并退出</button>
      <button class="primary" type="button" :disabled="busy" @click="$emit('end')">
        {{ busy ? '处理中…' : '结束工作' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import Modal from './Modal.vue';
import { formatDuration } from '../utils/duration.js';

defineProps({
  modelValue: { type: Boolean, default: false },
  session: { type: Object, default: null },
  workspaceName: { type: String, default: '' },
  elapsedSeconds: { type: Number, default: 0 },
  busy: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' }
});

const emit = defineEmits(['back', 'end', 'keep']);

function backToWork() {
  emit('back');
}
</script>

<style scoped>
.shutdown-confirm {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.shutdown-confirm__question {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}

.shutdown-confirm__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}

.shutdown-confirm__meta span {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 4px;
}

.shutdown-confirm__meta strong {
  font-size: 15px;
  color: var(--text);
}

.shutdown-confirm__options {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.65;
}

.shutdown-confirm__options strong {
  color: var(--text);
}

.shutdown-confirm__error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
