export function filterWorkspaceResourceRows(rows, query) {
  const term = String(query || '').trim().toLocaleLowerCase();
  if (!term) return rows;
  return rows.filter((row) => String(row.searchText ?? `${row.title || ''} ${row.meta || ''}`).toLocaleLowerCase().includes(term));
}
