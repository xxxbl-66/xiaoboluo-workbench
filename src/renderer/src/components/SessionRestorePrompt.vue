<template>
  <Modal :model-value="modelValue" title="检测到未结束的工作" width="560px" @close="$emit('later')">
    <div class="restore-prompt">
      <p class="restore-prompt__lead">
        上次使用工作台时，有一段工作没有结束。请明确选择怎么处理它。
      </p>

      <div class="restore-prompt__meta">
        <div>
          <span>工作空间</span>
          <strong>{{ workspaceName || '未归类的工作' }}</strong>
        </div>
        <div>
          <span>开始时间</span>
          <strong>{{ formatDateTime(session && session.startedAt) }}</strong>
        </div>
        <div>
          <span>当前状态</span>
          <strong>尚未结束</strong>
        </div>
        <div>
          <span>已显示经过时间</span>
          <strong>{{ formatDuration(elapsedSeconds) }}</strong>
        </div>
      </div>

      <p class="restore-prompt__warn">
        软件在关闭期间无法判断你是否真的在工作，所以"经过时间"可能包含离线时段。
        如果希望时长准确，请选择"结束并校正时长"。
      </p>

      <ul class="restore-prompt__options">
        <li><strong>继续这段工作</strong>：恢复原记录继续计时，不会新建第二条工作记录。</li>
        <li><strong>结束并校正时长</strong>：结束原记录，并填写你确认的有效工作时长。</li>
        <li><strong>暂不处理</strong>：保留原记录不结束，稍后仍可在这里处理。</li>
      </ul>

      <p v-if="errorMessage" class="restore-prompt__error">{{ errorMessage }}</p>
    </div>

    <template #footer>
      <button class="ghost" type="button" :disabled="busy" @click="$emit('later')">暂不处理</button>
      <button class="ghost" type="button" :disabled="busy" @click="$emit('adjust')">结束并校正时长</button>
      <button class="primary" type="button" :disabled="busy" @click="$emit('resume')">
        {{ busy ? '处理中…' : '继续这段工作' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import Modal from './Modal.vue';
import { formatDuration, formatDateTime } from '../utils/duration.js';

defineProps({
  modelValue: { type: Boolean, default: false },
  session: { type: Object, default: null },
  workspaceName: { type: String, default: '' },
  elapsedSeconds: { type: Number, default: 0 },
  busy: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' }
});

defineEmits(['resume', 'adjust', 'later']);
</script>

<style scoped>
.restore-prompt {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.restore-prompt__lead {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}

.restore-prompt__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
}

.restore-prompt__meta span {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 4px;
}

.restore-prompt__meta strong {
  font-size: 15px;
  color: var(--text);
}

.restore-prompt__warn {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-xs);
  background: var(--warning-soft);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.65;
}

.restore-prompt__options {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.65;
}

.restore-prompt__options strong {
  color: var(--text);
}

.restore-prompt__error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
