/**
 * 本地日期工具。
 *
 * 重点：dateKey 必须使用【本地日期】，不能用 toISOString().slice(0, 10)。
 * 后者是 UTC 日期，中国用户（UTC+8）在 00:00–08:00 之间会得到"昨天"，
 * 在 16:00 之后又会得到"明天"，导致复盘统计错一天。
 */

function toDate(value) {
  if (value instanceof Date) return value;
  if (value === undefined || value === null) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** 本地日期键：YYYY-MM-DD */
function localDateKey(value) {
  const date = toDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 今天（本地）的 YYYY-MM-DD */
function todayKey(value) {
  return localDateKey(value === undefined ? new Date() : value);
}

/** 从 YYYY-MM-DD 生成本地零点的 Date；非法输入返回 null */
function dateKeyToDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** 相对今天偏移若干天的本地日期键 */
function shiftDateKey(days, from) {
  const date = toDate(from);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + Number(days || 0));
  return localDateKey(date);
}

/** 两个 ISO 时间之间的真实秒数（不小于 0；非法输入返回 0） */
function elapsedSeconds(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = endIso === undefined || endIso === null ? Date.now() : new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

module.exports = { localDateKey, todayKey, dateKeyToDate, shiftDateKey, elapsedSeconds };
