<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal-backdrop" @mousedown.self="$emit('close')">
      <section class="modal-panel" :style="{ maxWidth: width }">
        <header class="modal-header">
          <h3>{{ title }}</h3>
          <button class="icon-button" type="button" @click="$emit('close')">×</button>
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
defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: String, default: '520px' }
});

defineEmits(['close']);
</script>
