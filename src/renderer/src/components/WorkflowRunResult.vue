<template>
  <section class="run-result" :class="{ 'run-result--failed': result?.failedCount || error }" aria-live="polite">
    <div class="run-result__head">
      <div>
        <strong>{{ workflowName || result?.workflowName || '工作流' }}</strong>
        <p v-if="result">{{ status }} · 成功 {{ result.successCount }}/{{ result.totalCount }}，失败 {{ result.failedCount }}</p>
        <p v-else>执行失败：{{ error }}</p>
      </div>
      <div class="run-result__actions">
        <button v-if="result" class="ghost small" type="button" @click="expanded = !expanded">{{ expanded ? '收起' : '查看步骤' }}</button>
        <button class="ghost small" type="button" aria-label="关闭执行结果" @click="$emit('close')">关闭</button>
      </div>
    </div>
    <ol v-if="result && expanded" class="run-result__steps">
      <li v-for="step in result.steps" :key="step.index" :class="{ 'run-result__step--failed': !step.ok }">
        <span aria-hidden="true">{{ step.ok ? '✓' : '✕' }}</span>
        <div>
          <strong>第 {{ step.index + 1 }} 步 · {{ step.label }}</strong>
          <p>{{ step.ok ? successText(step.type) : step.error }}</p>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  result: { type: Object, default: null },
  error: { type: String, default: '' },
  workflowName: { type: String, default: '' }
});
defineEmits(['close']);

const expanded = ref(false);
const status = computed(() => {
  if (!props.result) return '';
  if (props.result.failedCount === 0) return '全部成功';
  return props.result.successCount ? '部分成功' : '全部失败';
});
watch(() => props.result, (value) => { expanded.value = Boolean(value?.failedCount); }, { immediate: true });

function successText(type) {
  if (type === 'url') return '已提交浏览器打开请求';
  if (type === 'app') return '已提交应用启动请求';
  return '已提交系统打开请求';
}
</script>

<style scoped>
.run-result { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.run-result--failed { border-color: var(--warning); }
.run-result__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.run-result__head strong { font-size: 13px; }
.run-result__head p, .run-result__steps p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; }
.run-result__actions { display: flex; gap: 5px; flex-shrink: 0; }
.run-result__steps { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 7px; }
.run-result__steps li { display: flex; gap: 9px; padding: 8px 10px; border-radius: 8px; background: var(--surface); }
.run-result__steps li > span { color: var(--primary-strong); }
.run-result__steps .run-result__step--failed > span, .run-result__step--failed p { color: var(--warning); }
.run-result__steps strong { font-size: 12px; }
</style>
