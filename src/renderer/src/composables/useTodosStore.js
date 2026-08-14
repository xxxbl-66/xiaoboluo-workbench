import { ref } from 'vue';
import { workbench } from './useWorkbench.js';

const todos = ref([]);

async function loadTodos() {
  try {
    todos.value = await workbench.todos.list();
  } catch (_) {
    todos.value = [];
  }
}

export function useTodosStore() {
  return { todos, loadTodos };
}