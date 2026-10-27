'use strict';

/**
 * 重复规则纯函数自测。
 * node test/recurrence.test.js
 *
 * 全部用本地时间构造，避免时区差异导致断言飘。
 */

const assert = require('assert');
const {
  normalizeRepeat,
  nextOccurrence,
  describeRepeat,
  MIN_INTERVAL,
  MAX_INTERVAL
} = require('../src/main/recurrence');

let passed = 0;
const ok = (n) => {
  passed++;
  console.log('  \u2713 ' + n);
};

function expectAt(res, y, mo, d, h, mi, label) {
  assert.ok(res && res.at, label + '：应返回下一次时间');
  const a = new Date(res.at);
  const p = (n) => String(n).padStart(2, '0');
  assert.strictEqual(
    `${a.getFullYear()}-${a.getMonth() + 1}-${a.getDate()} ${a.getHours()}:${p(a.getMinutes())}`,
    `${y}-${mo}-${d} ${h}:${p(mi)}`,
    label
  );
}

function run() {
  console.log('\n[1] 每天');
  expectAt(
    nextOccurrence(new Date(2026, 9, 27, 9, 30), { type: 'daily' }, new Date(2026, 9, 27, 10, 0)),
    2026, 10, 28, 9, 30, '今天已过 09:30 → 明天 09:30'
  );
  const missed = nextOccurrence(
    new Date(2026, 9, 24, 9, 30),
    { type: 'daily' },
    new Date(2026, 9, 27, 10, 0)
  );
  expectAt(missed, 2026, 10, 28, 9, 30, '关机 3 天 → 只推进到明天');
  assert.strictEqual(missed.skipped, 3, '应报告跳过 3 次（25/26/27 号）');
  ok('今天已过点顺延到明天；错过多次只推进一次并报告跳过次数');

  console.log('\n[2] 跨年与闰年');
  expectAt(
    nextOccurrence(new Date(2026, 11, 31, 9, 0), { type: 'daily' }, new Date(2026, 11, 31, 23, 0)),
    2027, 1, 1, 9, 0, '跨年 12-31 → 01-01'
  );
  expectAt(
    nextOccurrence(new Date(2028, 1, 28, 9, 0), { type: 'daily' }, new Date(2028, 1, 28, 10, 0)),
    2028, 2, 29, 9, 0, '闰年 2-28 → 2-29'
  );
  ok('跨年与闰年 2 月 29 日均正确');

  console.log('\n[3] 工作日');
  // 2026-10-30 是周五，2026-11-02 是周一
  expectAt(
    nextOccurrence(new Date(2026, 9, 30, 9, 0), { type: 'weekdays' }, new Date(2026, 9, 30, 9, 0, 30)),
    2026, 11, 2, 9, 0, '周五 → 跳过周末到周一'
  );
  expectAt(
    nextOccurrence(new Date(2026, 9, 28, 9, 0), { type: 'weekdays' }, new Date(2026, 9, 28, 9, 1)),
    2026, 10, 29, 9, 0, '周三 → 周四'
  );
  ok('工作日跳过周六日');

  console.log('\n[4] 每周指定星期');
  // 2026-10-28 是周三
  expectAt(
    nextOccurrence(new Date(2026, 9, 28, 9, 0), { type: 'weekly', weekday: 3 }, new Date(2026, 9, 28, 9, 1)),
    2026, 11, 4, 9, 0, '周三 → 下周三'
  );
  expectAt(
    nextOccurrence(new Date(2026, 9, 29, 9, 0), { type: 'weekly', weekday: 3 }, new Date(2026, 9, 29, 9, 1)),
    2026, 11, 4, 9, 0, '周四 → 下周三'
  );
  expectAt(
    nextOccurrence(new Date(2026, 9, 28, 9, 0), { type: 'weekly', weekday: 7 }, new Date(2026, 9, 28, 9, 1)),
    2026, 11, 1, 9, 0, '周三 → 周日'
  );
  ok('每周：同日顺延 7 天、跨周、周日映射正确');

  console.log('\n[5] 间隔');
  expectAt(
    nextOccurrence(
      new Date(2026, 9, 27, 9, 0),
      { type: 'interval', intervalMin: 30 },
      new Date(2026, 9, 27, 9, 29)
    ),
    2026, 10, 27, 9, 30, '09:00 起，09:29 → 09:30'
  );
  const skipOne = nextOccurrence(
    new Date(2026, 9, 27, 9, 0),
    { type: 'interval', intervalMin: 30 },
    new Date(2026, 9, 27, 9, 31)
  );
  expectAt(skipOne, 2026, 10, 27, 10, 0, '09:00 起，09:31 → 10:00');
  assert.strictEqual(skipOne.skipped, 1, '09:31 时 09:30 已错过，应报告跳过 1 次');
  expectAt(
    nextOccurrence(
      new Date(2026, 9, 27, 23, 40),
      { type: 'interval', intervalMin: 30 },
      new Date(2026, 9, 27, 23, 45)
    ),
    2026, 10, 28, 0, 10, '跨零点 23:40 → 次日 00:10'
  );
  ok('间隔：命中整点、跳过计算、跨零点');

  console.log('\n[6] 关机很久也不能卡死');
  const sixYearsAgo = new Date(2021, 0, 1, 9, 0);
  const fakeNow = new Date(2026, 9, 27, 9, 0);
  const t0 = Date.now();
  const longGap = nextOccurrence(
    sixYearsAgo,
    { type: 'interval', intervalMin: MIN_INTERVAL },
    fakeNow
  );
  assert.ok(Date.now() - t0 < 50, '间隔型必须 O(1)，不能循环推进');
  assert.ok(
    longGap && new Date(longGap.at).getTime() > fakeNow.getTime(),
    '应推到 now 之后'
  );
  const dailyGap = nextOccurrence(
    sixYearsAgo,
    { type: 'daily' },
    fakeNow
  );
  expectAt(dailyGap, 2026, 10, 28, 9, 0, '五年未开机，每天 09:00 → 明天');
  ok('五年空档仍能正确推进（间隔型 O(1)、按日型有上限保护）');

  console.log('\n[7] 脏数据不抛异常');
  assert.strictEqual(normalizeRepeat(null), null);
  assert.strictEqual(normalizeRepeat({ type: 'yearly' }), null);
  assert.strictEqual(normalizeRepeat({ type: 'interval', intervalMin: 0 }), null);
  assert.strictEqual(normalizeRepeat({ type: 'interval', intervalMin: -5 }), null);
  assert.deepStrictEqual(normalizeRepeat({ type: 'weekly' }), { type: 'daily' });
  assert.deepStrictEqual(normalizeRepeat({ type: 'weekly', weekday: 9 }), { type: 'daily' });
  assert.deepStrictEqual(normalizeRepeat({ type: 'weekly', weekday: '3' }), {
    type: 'weekly',
    weekday: 3
  });
  assert.strictEqual(
    normalizeRepeat({ type: 'interval', intervalMin: 99999 }).intervalMin,
    MAX_INTERVAL
  );
  assert.strictEqual(nextOccurrence('这不是时间', { type: 'daily' }, new Date()), null);
  assert.strictEqual(nextOccurrence(new Date(), null, new Date()), null);
  ok('非法规则一律归一化或返回 null，绝不抛异常');

  console.log('\n[8] 文案');
  assert.strictEqual(describeRepeat({ type: 'daily' }, new Date(2026, 9, 28, 9, 30).toISOString()), '每天 09:30');
  assert.strictEqual(
    describeRepeat({ type: 'weekdays' }, new Date(2026, 9, 28, 9, 0).toISOString()),
    '工作日 09:00'
  );
  assert.strictEqual(
    describeRepeat({ type: 'weekly', weekday: 3 }, new Date(2026, 9, 28, 9, 0).toISOString()),
    '每周三 09:00'
  );
  assert.strictEqual(
    describeRepeat({ type: 'weekly', weekday: 7 }, new Date(2026, 10, 1, 9, 0).toISOString()),
    '每周日 09:00'
  );
  assert.strictEqual(describeRepeat({ type: 'interval', intervalMin: 30 }), '每 30 分钟');
  assert.strictEqual(describeRepeat({ type: 'interval', intervalMin: 120 }), '每 2 小时');
  assert.strictEqual(describeRepeat(null), '');
  ok('徽标文案：每天 / 工作日 / 每周X / 每 N 分钟 / 每 N 小时');

  console.log(`\n全部通过：${passed} 项\n`);
}

try {
  run();
  process.exit(0);
} catch (e) {
  console.error('\n失败：', e.message);
  process.exit(1);
}
