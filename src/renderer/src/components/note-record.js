/** Workspace 和便签页共用同一条原记录的保存方式；归属不属于编辑字段。 */
export async function saveNoteRecord(notesApi, noteId, draft) {
  const saved = await notesApi.update(noteId, {
    title: draft.title,
    content: draft.content
  });
  if (!saved || typeof saved !== 'object') {
    throw new Error('该便签已不存在，当前修改尚未保存。');
  }
  return saved;
}
