/** 自定义铃声只有落盘成功后才通知用户。 */
export async function saveCustomTone(audio, updateSettings, notify) {
  if (!audio) return { ok: false, canceled: true };
  const outcome = await updateSettings({
    timerRingtone: { type: 'custom', id: 'custom', name: audio.name, dataUrl: audio.dataUrl }
  });
  if (outcome.ok) notify('自定义铃声已保存');
  return outcome;
}
