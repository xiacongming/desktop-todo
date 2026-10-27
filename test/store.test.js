'use strict';

/**
 * 数据层自测：原子写入、备份、损坏恢复。
 * 不依赖 Electron，直接 node test/store.test.js 跑。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store, normalizeState } = require('../src/main/store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-test-'));
let passed = 0;

function ok(name) {
  passed++;
  console.log('  \u2713 ' + name);
}

async function run() {
  console.log('\n[1] 基础读写');
  const s1 = new Store(dir);
  s1.load();
  assert.deepStrictEqual(s1.get().todos, []);
  ok('初次启动为空列表');

  await s1.save({
    version: 1,
    settings: { skin: 'noir', window: { x: 10, y: 20, width: 400, height: 500 } },
    todos: [
      { id: 'a', text: '写周报', done: false, order: 1024 },
      { id: 'b', text: '买咖啡豆', done: true, order: 2048 }
    ]
  });

  assert.ok(fs.existsSync(path.join(dir, 'todos.json')), '主文件应存在');
  assert.ok(!fs.existsSync(path.join(dir, 'todos.json.tmp')), '不应残留临时文件');
  ok('原子写入完成且无 .tmp 残留');

  const s2 = new Store(dir);
  s2.load();
  assert.strictEqual(s2.get().todos.length, 2);
  assert.strictEqual(s2.get().settings.skin, 'noir');
  assert.strictEqual(s2.get().settings.window.width, 400);
  ok('重开后内容与设置都还原');

  console.log('\n[2] 主文件损坏 → 读备份');
  await s2.save({ settings: {}, todos: [{ id: 'a', text: '写周报' }, { id: 'b', text: '买咖啡豆' }] });
  await s2.save({ settings: {}, todos: [{ id: 'a', text: '写周报' }, { id: 'b', text: '买咖啡豆' }, { id: 'c', text: '交房租' }] });

  fs.writeFileSync(path.join(dir, 'todos.json'), '{ 这不是 JSON', 'utf8');
  const s3 = new Store(dir);
  s3.load();
  assert.ok(s3.get().todos.length >= 2, '应从备份恢复出数据');
  assert.ok(s3.loadError && s3.loadError.includes('备份'));
  ok('主文件损坏时从备份恢复，并给出提示');

  console.log('\n[3] 主文件与备份都损坏 → 空数据启动');
  fs.writeFileSync(path.join(dir, 'todos.json'), 'garbage', 'utf8');
  fs.writeFileSync(path.join(dir, 'todos.bak.json'), 'garbage', 'utf8');
  const s4 = new Store(dir);
  s4.load();
  assert.deepStrictEqual(s4.get().todos, []);
  assert.ok(s4.loadError && s4.loadError.length > 0);
  assert.ok(fs.existsSync(path.join(dir, 'todos.json')), '原文件不得被删除');
  ok('双损坏时降级为空数据，原文件保留');

  console.log('\n[4] 脏数据归一化');
  const n = normalizeState({
    todos: [
      { text: '   ' },
      { text: 'x'.repeat(900) },
      { text: 'ok', done: true, pinned: true },
      null,
      'nope'
    ]
  });
  assert.strictEqual(n.todos.length, 2, '空文本与非法项应被丢弃');
  assert.strictEqual(n.todos[0].text.length, 500, '超长文本应截断到 500');
  assert.strictEqual(n.todos[1].pinned, false, '已完成项不应保持置顶');
  ok('空项丢弃 / 超长截断 / 已完成不置顶');

  console.log('\n[5] 并发写入不互相覆盖');
  const s5 = new Store(dir);
  s5.load();
  const jobs = [];
  for (let i = 0; i < 30; i++) {
    jobs.push(s5.save({ settings: {}, todos: [{ id: 'x', text: 'seq' + i, order: i }] }));
  }
  await Promise.all(jobs);
  const s6 = new Store(dir);
  s6.load();
  assert.strictEqual(s6.get().todos[0].text, 'seq29');
  ok('30 次并发写入串行落盘，最终一致');

  console.log('\n[6] v1 数据迁移到 v2');
  const migrated = normalizeState({
    version: 1,
    todos: [
      {
        id: 'v1',
        text: '交房租',
        dueAt: '2026-10-01T01:00:00.000Z',
        remindedAt: '2026-10-01T01:00:20.000Z'
      }
    ]
  });
  assert.strictEqual(migrated.version, 2, '版本应升到 2');
  assert.strictEqual(migrated.todos[0].firedAt, '2026-10-01T01:00:20.000Z', 'remindedAt 应迁移为 firedAt');
  assert.strictEqual(migrated.todos[0].repeat, null, '旧数据不应凭空产生重复规则');
  assert.strictEqual(migrated.todos[0].remindedAt, '2026-10-01T01:00:20.000Z', '旧字段保留，供回退读取');
  ok('v1 → v2 版本升级、remindedAt 迁移为 firedAt、旧字段保留');

  console.log('\n[7] 重复规则脏数据归一化');
  const dirty = normalizeState({
    todos: [
      { text: 'A', dueAt: '2026-10-01T01:00:00.000Z', repeat: { type: 'yearly' } },
      { text: 'B', dueAt: '2026-10-01T01:00:00.000Z', repeat: { type: 'interval', intervalMin: 0 } },
      { text: 'C', dueAt: '2026-10-01T01:00:00.000Z', repeat: { type: 'interval', intervalMin: -30 } },
      { text: 'D', dueAt: '2026-10-01T01:00:00.000Z', repeat: { type: 'weekly' } },
      { text: 'E', dueAt: '2026-10-01T01:00:00.000Z', repeat: { type: 'interval', intervalMin: 99999 } },
      { text: 'F', repeat: { type: 'daily' } }
    ]
  });
  assert.strictEqual(dirty.todos[0].repeat, null, '未知类型应丢弃');
  assert.strictEqual(dirty.todos[1].repeat, null, '间隔 0 应丢弃');
  assert.strictEqual(dirty.todos[2].repeat, null, '负间隔应丢弃');
  assert.deepStrictEqual(dirty.todos[3].repeat, { type: 'daily' }, '缺 weekday 的 weekly 退化为每天');
  assert.strictEqual(dirty.todos[4].repeat.intervalMin, 1440, '超过一天应截到 1440 分钟');
  assert.strictEqual(dirty.todos[5].repeat, null, '没有截止时间的规则应丢弃');
  ok('非法类型丢弃 / 零负间隔丢弃 / weekly 缺 weekday 退化 / 间隔封顶 / 无时间不生效');

  console.log('\n[8] 多行文本往返不丢换行');
  const multi = new Store(path.join(dir, 'multi'));
  multi.load();
  await multi.save({
    settings: {},
    todos: [{ id: 'm', text: '账号：admin\n密码：见密码管理器\n端口：8080' }]
  });
  const multiReload = new Store(path.join(dir, 'multi'));
  multiReload.load();
  assert.strictEqual(
    multiReload.get().todos[0].text,
    '账号：admin\n密码：见密码管理器\n端口：8080'
  );
  assert.strictEqual(multiReload.get().todos[0].text.split('\n').length, 3, '应仍是 3 行');
  const longMulti = normalizeState({ todos: [{ text: 'x\n'.repeat(400) }] });
  assert.ok(longMulti.todos[0].text.length <= 500, '多行文本同样受 500 字上限约束');
  ok('换行完整保留，且多行文本仍受 500 字上限约束');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n全部通过：${passed} 项\n`);
}

run().catch((e) => {
  console.error('\n失败：', e.message);
  console.error('数据目录：', dir);
  process.exit(1);
});
