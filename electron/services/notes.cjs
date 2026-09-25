const { id } = require('../defaults.cjs');

/**
 * 便签服务（主进程侧）。
 *
 * 快速便签原来直接写在 main.cjs 里，逻辑无法被单独测试，
 * 也是"清空后立即切页丢内容"问题涉及的服务端一半。
 * 这里保持与 notes.json 完全相同的结构（不新增表、不做 migration）。
 */

const QUICK_TITLE = '快速便签';

/**
 * 便签内容规范化。
 *
 * 关键点：空字符串是合法内容。
 * 老实现用 `String(content || '')` 再配合调用方"内容非空才保存"，
 * 会把"用户清空了便签"当成"没有变化"而丢掉。
 * 这里 null / undefined 才等价于空串，其余一律按字符串保存（含 "0"、"false"）。
 */
function normalizeContent(content) {
  if (content === undefined || content === null) return '';
  return typeof content === 'string' ? content : String(content);
}

function findQuickNote(notes) {
  const items = Array.isArray(notes) ? notes : [];
  return items.find((item) => item && item.type === 'quick') || null;
}

/** 读取快速便签；不存在时不写盘，只返回一条内存中的空便签 */
function readQuickNote(notes) {
  const quick = findQuickNote(notes);
  if (quick) {
    return { ...quick, content: normalizeContent(quick.content) };
  }
  const now = new Date().toISOString();
  return {
    id: id(),
    title: QUICK_TITLE,
    content: '',
    type: 'quick',
    pinned: false,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 写入快速便签内容。
 * @returns {{notes:Array, quick:object}} 写入后的整表与新便签，供调用方落盘
 */
function applyQuickNote(notes, content, nowIso) {
  const items = Array.isArray(notes) ? [...notes] : [];
  const stamp = nowIso || new Date().toISOString();
  const text = normalizeContent(content);
  const index = items.findIndex((item) => item && item.type === 'quick');

  if (index === -1) {
    const quick = {
      id: id(),
      title: QUICK_TITLE,
      content: text,
      type: 'quick',
      pinned: false,
      createdAt: stamp,
      updatedAt: stamp
    };
    items.unshift(quick);
    return { notes: items, quick };
  }

  const quick = { ...items[index], content: text, updatedAt: stamp };
  items[index] = quick;
  return { notes: items, quick };
}

module.exports = {
  QUICK_TITLE,
  normalizeContent,
  findQuickNote,
  readQuickNote,
  applyQuickNote
};
