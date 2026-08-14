export const QUADRANTS = {
  importantUrgent: { label: '重要且紧急', className: 'q-red', rank: 0 },
  urgentNotImportant: { label: '紧急不重要', className: 'q-yellow', rank: 1 },
  importantNotUrgent: { label: '重要不紧急', className: 'q-blue', rank: 2 },
  notImportantNotUrgent: { label: '不重要不紧急', className: 'q-green', rank: 3 }
};

export function getQuadrant(todo) {
  const importance = todo.importance || (todo.priority === 'low' ? 'low' : 'high');
  const urgency = todo.urgency || (todo.priority === 'high' ? 'high' : 'low');
  if (importance === 'high' && urgency === 'high') return QUADRANTS.importantUrgent;
  if (importance === 'low' && urgency === 'high') return QUADRANTS.urgentNotImportant;
  if (importance === 'high' && urgency === 'low') return QUADRANTS.importantNotUrgent;
  return QUADRANTS.notImportantNotUrgent;
}

export function sortTodosByQuadrant(todos) {
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const rank = getQuadrant(a).rank - getQuadrant(b).rank;
    if (rank !== 0) return rank;
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    if (aDue !== bDue) return aDue - bDue;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}