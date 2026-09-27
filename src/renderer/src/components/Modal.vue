<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal-backdrop" @mousedown.self="$emit('close')" @keydown.esc.stop.prevent="$emit('close')">
      <section ref="panel" class="modal-panel" :style="{ maxWidth: width }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
        <header class="modal-header">
          <h3>{{ title }}</h3>
          <button class="icon-button" type="button" aria-label="关闭弹窗" @click="$emit('close')">×</button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: String, default: '520px' }
});

defineEmits(['close']);
const panel = ref(null);
watch(() => props.modelValue, async (opened) => {
  if (!opened) return;
  await nextTick();
  const first = panel.value?.querySelector?.('.modal-body input:not([type="checkbox"]):not([type="radio"]):not([disabled]), .modal-body textarea:not([disabled]), .modal-body select:not([disabled])')
    || panel.value?.querySelector?.('button:not([disabled])');
  (first || panel.value)?.focus?.();
}, { immediate: true });
</script>
