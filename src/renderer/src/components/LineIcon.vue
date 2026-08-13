<template>
  <svg
    class="line-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, default: 'circle' },
  size: { type: [Number, String], default: 20 }
});

const iconPaths = {
  circle: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  todos: ['M4 12h16', 'M4 12l3-3', 'M4 12l3 3', 'M10 5h10', 'M10 19h10'],
  calendar: ['M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', 'M16 2v4', 'M8 2v4', 'M3 9h18'],
  review: ['M21 12a9 9 0 1 1-9-9', 'M21 3v6h-6'],
  bookmarks: ['M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z'],
  bookshelf: ['M4 4h6v16H4z', 'M14 4h6v16h-6z', 'M4 9h6', 'M14 9h6'],
  files: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  chat: ['M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.41 1.41-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.41-1.41.06-.06A1.7 1.7 0 0 0 8.6 15 1.7 1.7 0 0 0 7.04 14H7v-2h.04A1.7 1.7 0 0 0 8.6 10.6a1.7 1.7 0 0 0-.34-1.88L8.2 8.66l1.41-1.41.06.06A1.7 1.7 0 0 0 11.4 7.04V7h2v.04A1.7 1.7 0 0 0 15 8.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.41 1.41-.06.06A1.7 1.7 0 0 0 18.6 15H19v2h-.04A1.7 1.7 0 0 0 17.4 17'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  panel: ['M4 4h16v16H4z', 'M14 4v16'],
  app: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', 'M4 9h16', 'M9 9v11'],
  image: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', 'M8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'M21 15l-4-4-8 8'],
  note: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  file: ['M6 2h8l4 4v16H6z', 'M14 2v4h4', 'M9 13h6', 'M9 17h6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.35-4.35'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 15H6L5 6', 'M10 11v5', 'M14 11v5'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  external: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  chevronRight: ['M9 18l6-6-6-6'],
  check: ['M20 6 9 17l-5-5'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z']
};

const paths = computed(() => iconPaths[props.name] || iconPaths.circle);
</script>

<style scoped>
.line-icon {
  display: inline-block;
  vertical-align: -0.12em;
  flex: 0 0 auto;
}
</style>
