export function bookmarkUrlError(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (['http:', 'https:'].includes(url.protocol) && url.hostname) return '';
  } catch (_) { /* shown below */ }
  return '链接只支持完整的 http 或 https 网址。';
}
