import { reactive } from 'vue';

export const toastState = reactive({ items: [] });
let seed = 0;

export function toast(message, type = 'info') {
  const id = ++seed;
  toastState.items.push({ id, message, type });
  setTimeout(() => {
    const index = toastState.items.findIndex((item) => item.id === id);
    if (index !== -1) toastState.items.splice(index, 1);
  }, 2600);
}
