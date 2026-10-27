'use strict';

/**
 * 重复提醒规则 —— 纯函数，不依赖 Electron / DOM，可以单独跑测试。
 *
 * repeat = {
 *   type: 'daily' | 'weekdays' | 'weekly' | 'interval',
 *   weekday: 1..7,         // type=weekly，1 = 周一 … 7 = 周日
 *   intervalMin: 5..1440   // type=interval
 * }
 *
 * 设计要点：
 * 1. 下一次时间一律由「上一次的计划时刻」推进，而不是由「当前时间」推进。
 *    否则每次轮询都会把 09:00 的提醒漂移到 09:00:20、09:00:40……
 * 2. 推进结果必须严格大于 now，这样 20 秒轮询天然幂等，不需要「已提醒过」标记。
 * 3. 关机多日后开机，只把 dueAt 推到未来一次，并把跳过的次数返回给调用方，
 *    用于文案「已跳过 N 次」，避免同一件事连弹七八条通知。
 */

const MIN_INTERVAL = 5;
const MAX_INTERVAL = 1440;

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 脏数据一律收敛到合法值或 null，绝不把非法规则抛给调度层 */
function normalizeRepeat(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const type = raw.type;
  if (type === 'daily' || type === 'weekdays') return { type };

  if (type === 'weekly') {
    const wd = Math.round(Number(raw.weekday));
    // weekday 缺失/非法时退化成「每天」：宁可多提醒一次，
    // 也不要把用户设好的提醒默默丢掉。
    if (!Number.isFinite(wd) || wd < 1 || wd > 7) return { type: 'daily' };
    return { type: 'weekly', weekday: wd };
  }

  if (type === 'interval') {
    const m = Math.round(Number(raw.intervalMin));
    if (!Number.isFinite(m) || m < MIN_INTERVAL) return null;
    return { type: 'interval', intervalMin: Math.min(MAX_INTERVAL, m) };
  }

  return null;
}

/** 从某一个计划时刻推进到「下一次同规则」的时刻 */
function step(from, rep) {
  const d = new Date(from.getTime());
  switch (rep.type) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      return d;
    case 'weekdays':
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
      return d;
    case 'weekly': {
      const target = rep.weekday === 7 ? 0 : rep.weekday;
      let add = (target - d.getDay() + 7) % 7;
      if (add === 0) add = 7; // 同一天 = 下周，而不是今天
      d.setDate(d.getDate() + add);
      return d;
    }
    default:
      return null;
  }
}

/**
 * @param {string|Date} fromISO 上一次的计划时刻（通常是 todo.dueAt）
 * @param {object} repeat 重复规则
 * @param {Date|number} now 当前时间
 * @returns {{at:string, skipped:number}|null} 下一次 ISO 时刻 + 跳过了几次
 */
function nextOccurrence(fromISO, repeat, now = new Date()) {
  const rep = normalizeRepeat(repeat);
  if (!rep) return null;

  const from = fromISO instanceof Date ? fromISO : new Date(fromISO);
  if (isNaN(from.getTime())) return null;

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return null;

  // 间隔型直接算，不用循环：关机一个月 + 5 分钟间隔会推进上万次，
  // 循环会把主进程卡住，这里必须 O(1)。
  if (rep.type === 'interval') {
    const span = rep.intervalMin * 60000;
    const delta = nowMs - from.getTime();
    const n = Math.floor(delta / span) + 1;
    return {
      at: new Date(from.getTime() + n * span).toISOString(),
      skipped: Math.max(0, n - 1)
    };
  }

  let cur = from;
  let guard = 0;
  while (cur.getTime() <= nowMs && guard < 5000) {
    const nx = step(cur, rep);
    if (!nx) return null;
    cur = nx;
    guard += 1;
  }
  if (cur.getTime() <= nowMs) return null; // 兜底：极端脏数据，放弃推进

  return { at: cur.toISOString(), skipped: Math.max(0, guard - 1) };
}

function formatInterval(min) {
  if (min % 60 === 0) return `${min / 60} 小时`;
  return `${min} 分钟`;
}

/** 徽标文案：每天 09:30 / 工作日 09:30 / 每周三 09:30 / 每 30 分钟 */
function describeRepeat(repeat, dueAtISO) {
  const rep = normalizeRepeat(repeat);
  if (!rep) return '';

  const d = dueAtISO ? new Date(dueAtISO) : null;
  const valid = d && !isNaN(d.getTime());
  const p = (n) => String(n).padStart(2, '0');
  const hhmm = valid ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '';

  switch (rep.type) {
    case 'daily':
      return `每天${hhmm}`;
    case 'weekdays':
      return `工作日${hhmm}`;
    case 'weekly':
      return `每周${WEEK_CN[rep.weekday === 7 ? 0 : rep.weekday]}${hhmm}`;
    case 'interval':
      return `每 ${formatInterval(rep.intervalMin)}`;
    default:
      return '';
  }
}

module.exports = {
  normalizeRepeat,
  nextOccurrence,
  describeRepeat,
  formatInterval,
  MIN_INTERVAL,
  MAX_INTERVAL,
  WEEK_CN
};
