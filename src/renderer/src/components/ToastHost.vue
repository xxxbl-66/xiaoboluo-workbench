<template>
  <div class="toast-host">
    <div v-for="item in toastState.items" :key="item.id" class="toast" :class="item.type">
      {{ item.message }}
    </div>
  </div>
</template>

<script setup>
import { toastState } from '../composables/toast.js';
</script>
