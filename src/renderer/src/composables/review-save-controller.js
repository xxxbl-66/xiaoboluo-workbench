import { runSave } from './save-result.js';

/** 保持复盘保存回执与用户当前草稿的版本一致。 */
export function createReviewSaveController({ getDraft, write, applySaved }) {
  let revision = 0;

  return {
    markChanged() {
      revision += 1;
    },
    async save() {
      const savingRevision = revision;
      const payload = getDraft();
      const outcome = await runSave(() => write(payload), { fallback: '复盘保存失败' });
      const current = savingRevision === revision;
      if (outcome.ok && current) applySaved(outcome.data);
      return { ...outcome, current };
    }
  };
}
