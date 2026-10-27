'use strict';

/**
 * 渲染层自测：用 jsdom 真实加载 index.html + renderer.js，
 * 走一遍新增 / 勾选 / 撤销 / 排序 / 截止时间的 DOM 结果。
 * 不需要 GPU，跑得比开窗口快得多。
 *
 * node test/renderer.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'src/renderer/renderer.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedState() {
  return {
    version: 1,
    settings: {
      alwaysOnTop: true,
      skin: 'paper',
      autoLaunch: false,
      globalHotkey: true,
      collapseDone: true,
      window: { x: null, y: null, width: 340, height: 470 }
    },
    todos: [
      {
        id: 'p1',
        text: '今天下午把周报发给张工',
        done: false,
        pinned: true,
        order: 1024,
        dueAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
        remindedAt: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      },
      {
        id: 'o1',
        text: '买咖啡豆',
        done: false,
        pinned: false,
        order: 2048,
        dueAt: null,
        remindedAt: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      },
      {
        id: 'o2',
        text: '看一遍代码结构',
        done: false,
        pinned: false,
        order: 3072,
        dueAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
        remindedAt: null,
        createdAt: new Date().toISOString(),
        completedAt: null
      },
      {
        id: 'd1',
        text: '整理 10 月的报销单',
        done: true,
        pinned: false,
        order: 4096,
        dueAt: null,
        remindedAt: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date(Date.now() - 3600 * 1000).toISOString()
      }
    ]
  };
}

let saveCount = 0;
let lastSaved = null;
const handlers = {};

async function boot() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  window.api = {
    load: async () => ({
      state: seedState(),
      loadError: null,
      autostart: false,
      hotkey: 'Control+Alt+T',
      packaged: false,
      dataDir: 'C:/tmp'
    }),
    saveState: (s) => {
      saveCount++;
      lastSaved = s;
    },
    setAlwaysOnTop: async (on) => on,
    hide: () => {},
    quit: () => {},
    setAutoLaunch: async (on) => on,
    setHotkey: async (on) => on,
    setSkin: async (s) => s,
    openDataDir: async () => {},
    notify: async () => {},
    onSkinChanged: (cb) => (handlers.skin = cb),
    onSettingsChanged: (cb) => (handlers.settings = cb),
    onRemindersMarked: (cb) => (handlers.marked = cb),
    onRemindersPulse: (cb) => (handlers.pulse = cb)
  };

  window.eval(script);
  await sleep(120);
  return { dom, window, doc: window.document };
}

function rows(doc) {
  return Array.from(doc.querySelectorAll('#list > .row'));
}

function doneRows(doc) {
  return Array.from(doc.querySelectorAll('#doneList > .row'));
}

let passed = 0;
const ok = (n) => {
  passed++;
  console.log('  \u2713 ' + n);
};

async function run() {
  const { window, doc } = await boot();
  const click = (elm) =>
    elm.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  console.log('\n[1] 首屏渲染');
  assert.strictEqual(rows(doc).length, 3, '应有 3 条未完成');
  assert.strictEqual(doc.querySelector('#countBadge').textContent, '3');
  ok('未完成 3 条，顶部角标显示 3');

  assert.ok(rows(doc)[0].classList.contains('pinned'), '置顶项应排第一');
  assert.ok(rows(doc)[0].textContent.includes('周报'));
  ok('置顶项带 pinned 类并排在最前');

  assert.ok(doc.querySelector('#list .chip-due.today'), '今天到期应有 today 标记');
  ok('今天到期条目显示橙色 today 徽标');

  assert.strictEqual(doc.querySelectorAll('#doneList > .row').length, 1);
  assert.ok(doc.getElementById('doneBlock').hidden === false, '有已完成项时区域应显示');
  assert.ok(!doc.getElementById('doneBlock').classList.contains('open'), '默认应折叠');
  ok('已完成区显示但默认折叠');

  console.log('\n[2] 新增待办');
  const input = doc.getElementById('input');
  input.value = '给打印机换墨盒';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(30);

  assert.strictEqual(rows(doc).length, 4, '新增后应 4 条');
  assert.ok(rows(doc)[1].textContent.includes('给打印机换墨盒'), '新条目应插在置顶项之后最前');
  assert.strictEqual(input.value, '', '提交后输入框应清空');
  ok('回车新增，插入顶部且输入框清空');

  input.value = '   ';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(30);
  assert.strictEqual(rows(doc).length, 4, '空白不应提交');
  ok('纯空格不提交');

  console.log('\n[3] 勾选完成');
  const target = rows(doc)[1];
  const targetId = target.dataset.id;
  click(target.querySelector('[data-act="toggle"]'));
  await sleep(260);

  assert.strictEqual(rows(doc).length, 3, '完成后应从待办区移除');
  assert.strictEqual(doc.getElementById('doneCount').textContent, '2');
  assert.ok(
    doc.getElementById('doneBlock').classList.contains('open'),
    '首次勾完应自动展开已完成区'
  );
  assert.ok(
    doneRows(doc).some((r) => r.dataset.id === targetId),
    '应出现在已完成列表'
  );
  ok('勾选后下沉到已完成区，并自动展开一次');

  console.log('\n[4] 取消完成回到原位');
  const back = doneRows(doc).find((r) => r.dataset.id === targetId);
  click(back.querySelector('[data-act="toggle"]'));
  await sleep(260);
  assert.strictEqual(rows(doc).length, 4, '应回到待办区');
  assert.strictEqual(rows(doc)[1].dataset.id, targetId, '应回到原来的位置');
  ok('取消勾选后回到原来的排序位置');

  console.log('\n[5] 删除与撤销');
  const delRow = rows(doc)[1];
  const delId = delRow.dataset.id;
  click(delRow.querySelector('[data-act="del"]'));
  await sleep(60);
  assert.strictEqual(rows(doc).length, 3, '删除后应少一条');
  assert.ok(!doc.getElementById('toast').hidden, '应弹出可撤销提示');

  const undoBtn = doc.querySelector('.toast-act');
  assert.ok(undoBtn && undoBtn.textContent.includes('撤销'));
  click(undoBtn);
  await sleep(60);
  assert.strictEqual(rows(doc).length, 4, '撤销后应恢复');
  assert.ok(rows(doc).some((r) => r.dataset.id === delId));
  ok('删除后 5 秒内可撤销，条目完整恢复');

  console.log('\n[6] 置顶');
  const pinRow = rows(doc)[2];
  click(pinRow.querySelector('[data-act="pin"]'));
  await sleep(60);
  assert.ok(rows(doc)[0].dataset.pin === '1', '置顶后应排到最前');
  ok('单条置顶后排到最前');

  console.log('\n[7] 截止时间');
  const dueRow = rows(doc)[2];
  const dueId = dueRow.dataset.id;
  click(dueRow.querySelector('[data-act="due"]'));
  await sleep(30);
  assert.ok(!doc.getElementById('duePop').hidden, '日期浮层应打开');

  const tomorrow = doc.querySelector('[data-quick="tomorrow"]');
  click(tomorrow);
  await sleep(20);
  assert.ok(doc.getElementById('dueInput').value.includes('T09:00'), '快捷选项应填入明天 09:00');
  click(doc.getElementById('dueSave'));
  await sleep(60);
  // 保存会触发重渲染，旧引用已失效，按 id 重新取
  const fresh = doc.querySelector(`#list .row[data-id="${dueId}"]`);
  assert.ok(fresh, '条目应仍在待办区');
  assert.ok(fresh.querySelector('.chip-due'), '保存后应出现截止时间徽标');
  ok('设置截止时间并可保存显示');

  console.log('\n[8] 落盘调用');
  await sleep(400);
  assert.ok(saveCount > 0, '应调用过保存');
  assert.ok(Array.isArray(lastSaved.todos), '保存内容结构正确');
  ok(`触发 ${saveCount} 次状态保存，数据结构完整`);

  console.log('\n[9] 已完成折叠交互');
  click(doc.getElementById('doneHead'));
  await sleep(30);
  const open1 = doc.getElementById('doneBlock').classList.contains('open');
  click(doc.getElementById('doneHead'));
  await sleep(30);
  assert.notStrictEqual(open1, doc.getElementById('doneBlock').classList.contains('open'));
  ok('已完成区可展开 / 收起');

  console.log(`\n全部通过：${passed} 项\n`);
  process.exit(0);
}

run().catch((e) => {
  console.error('\n失败：', e.message);
  process.exit(1);
});
