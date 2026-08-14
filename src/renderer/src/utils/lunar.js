const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573, 0x052d0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520
];

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];

function leapMonth(year) {
  return LUNAR_INFO[year - MIN_YEAR] & 0xf;
}

function leapDays(year) {
  if (leapMonth(year)) {
    return (LUNAR_INFO[year - MIN_YEAR] & 0x10000) ? 30 : 29;
  }
  return 0;
}

function monthDays(year, month) {
  return (LUNAR_INFO[year - MIN_YEAR] & (0x10000 >> month)) ? 30 : 29;
}

function yearDays(year) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (LUNAR_INFO[year - MIN_YEAR] & i) ? 1 : 0;
  }
  return sum + leapDays(year);
}

function solarToLunar(year, month, day) {
  const base = Date.UTC(1900, 0, 31);
  const target = Date.UTC(year, month - 1, day);
  let offset = Math.round((target - base) / 86400000);

  let lunarYear = MIN_YEAR;
  let temp = 0;
  for (; lunarYear <= MAX_YEAR; lunarYear++) {
    temp = yearDays(lunarYear);
    if (offset < temp) break;
    offset -= temp;
  }

  const leap = leapMonth(lunarYear);
  let isLeap = false;
  let lunarMonth = 0;
  for (let i = 1; i <= 12; i++) {
    if (leap > 0 && i === leap + 1 && !isLeap) {
      i -= 1;
      isLeap = true;
      temp = leapDays(lunarYear);
    } else {
      temp = monthDays(lunarYear, i);
    }
    if (isLeap && i === leap + 1) isLeap = false;
    if (offset < temp) {
      lunarMonth = i;
      break;
    }
    offset -= temp;
  }

  return {
    year: lunarYear,
    month: lunarMonth,
    day: offset + 1,
    isLeap
  };
}

function lunarText(lunar) {
  if (!lunar) return '';
  const month = lunar.isLeap ? `闰${MONTH_NAMES[lunar.month - 1]}` : MONTH_NAMES[lunar.month - 1];
  return `农历${month}${DAY_NAMES[lunar.day - 1]}`;
}

function festivalText(solarYear, solarMonth, solarDay, lunar) {
  if (solarMonth === 1 && solarDay === 1) return '元旦';
  if (solarMonth === 4 && (solarDay === 4 || solarDay === 5)) return '清明节';
  if (solarMonth === 5 && solarDay === 1) return '劳动节';
  if (solarMonth === 10 && solarDay === 1) return '国庆节';
  if (solarMonth === 6 && solarDay === 1) return '儿童节';

  if (!lunar || lunar.isLeap) return '';
  const m = lunar.month;
  const d = lunar.day;
  if (m === 1 && d === 1) return '春节';
  if (m === 1 && d === 15) return '元宵节';
  if (m === 5 && d === 5) return '端午节';
  if (m === 7 && d === 7) return '七夕节';
  if (m === 8 && d === 15) return '中秋节';
  if (m === 9 && d === 9) return '重阳节';
  if (m === 12 && d === 8) return '腊八节';
  if (m === 12 && d === 23) return '小年';
  if (m === 12 && (d === 29 || d === 30)) return '除夕';
  return '';
}

export function getLunarInfo(date) {
  const solarYear = date.getFullYear();
  const solarMonth = date.getMonth() + 1;
  const solarDay = date.getDate();
  if (solarYear < MIN_YEAR || solarYear > MAX_YEAR) {
    return { lunarText: '', festival: '' };
  }
  const lunar = solarToLunar(solarYear, solarMonth, solarDay);
  const festival = festivalText(solarYear, solarMonth, solarDay, lunar);
  return {
    lunarText: lunarText(lunar),
    festival
  };
}

export function getDayLabel(date) {
  const info = getLunarInfo(date);
  return info.festival || info.lunarText;
}
