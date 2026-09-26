/** Workspace 和便签页共用同一条原记录的保存方式；归属不属于编辑字段。 */
export function saveNoteRecord(notesApi, noteId, draft) {
  return notesApi.update(noteId, {
    title: draft.title,
    content: draft.content
  });
}
