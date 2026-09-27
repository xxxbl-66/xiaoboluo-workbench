/** Read legacy and damaged history without letting one bad item break a card. */
export function completedTodosOf(session) {
  if (!session || typeof session !== 'object') return [];
  const valid = (items) => Array.isArray(items) ? items.filter((item) =>
    item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.id === 'string' && item.id.trim()
    && typeof item.title === 'string' && item.title.trim()
  ) : [];
  const snapshots = valid(session.completedTodoSnapshots);
  return snapshots.length ? snapshots : valid(session.completedTodos);
}
