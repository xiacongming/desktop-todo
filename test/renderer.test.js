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
    version: 2,
    settings: {
      alwaysOnTop: true,
      skin: 'paper',
      autoLaunch: false,
      globalHotkey: true,
      collapseDone: true,
      composerHeight: null,
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
let ackCount = 0;
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
      version: '1.1.0',
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
    onRemindersFired: (cb) => (handlers.fired = cb),
    onRemindersPulse: (cb) => (handlers.pulse = cb),
    ackReminders: () => {
      ackCount += 1;
    }
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

  const press = (elm, key, extra) =>
    elm.dispatchEvent(
      new window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, extra))
    );
  const typeInto = (elm, value) => {
    elm.value = value;
    elm.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const rowById = (id) => doc.querySelector(`.row[data-id="${id}"]`);

  console.log('\n[10] 多行输入');
  const ta = doc.getElementById('input');
  assert.strictEqual(ta.tagName, 'TEXTAREA', '新增输入框应为 textarea');

  const before10 = rows(doc).length;
  typeInto(ta, '第一行');
  press(ta, 'Enter', { shiftKey: true });
  await sleep(40);
  assert.strictEqual(rows(doc).length, before10, 'Shift+Enter 换行，不提交');

  typeInto(ta, '第一行\n第二行');
  press(ta, 'Enter');
  await sleep(40);
  assert.strictEqual(rows(doc).length, before10 + 1, 'Enter 应提交');
  const multiRow = rows(doc).find((r) => r.textContent.includes('第一行'));
  assert.ok(multiRow, '多行内容应出现在列表');
  assert.ok(multiRow.querySelector('.text').textContent.includes('\n'), '换行需保留');
  assert.ok(multiRow.textContent.includes('第二行'));
  ok('textarea 承载多行，Shift+Enter 换行、Enter 提交，换行不丢失');

  console.log('\n[11] 列表内直接编辑');
  const editId = multiRow.dataset.id;
  click(rowById(editId).querySelector('[data-act="edit"]'));
  await sleep(40);
  const ed = doc.querySelector('.edit-input');
  assert.ok(ed && ed.tagName === 'TEXTAREA', '应出现多行编辑框');
  assert.strictEqual(rowById(editId).dataset.editing, '1', '行应标记为编辑态');
  assert.strictEqual(rowById(editId).getAttribute('draggable'), 'false', '编辑态必须禁用拖拽');

  typeInto(ed, '改过的内容\n第二行');
  press(ed, 'Enter');
  await sleep(60);
  assert.ok(!doc.querySelector('.edit-input'), '编辑框应收起');
  assert.ok(rowById(editId).textContent.includes('改过的内容'), '内容应更新');
  assert.strictEqual(rowById(editId).dataset.editing, '0');
  ok('点编辑按钮进入多行编辑，Enter 保存，编辑期间禁用拖拽');

  console.log('\n[12] 长内容折叠 / 展开');
  const longText = '这是一段很长的待办内容，用来验证折叠与展开逻辑是否可靠。'.repeat(6);
  typeInto(ta, longText);
  press(ta, 'Enter');
  await sleep(60);
  const longRow = rows(doc).find((r) => r.querySelector('.more'));
  assert.ok(longRow, '超长内容应出现展开按钮');
  const longId = longRow.dataset.id;
  assert.strictEqual(longRow.querySelector('.more').textContent, '展开');

  click(longRow.querySelector('.more'));
  await sleep(40);
  assert.ok(rowById(longId).querySelector('.text').classList.contains('expanded'), '点击后应展开');
  assert.strictEqual(rowById(longId).querySelector('.more').textContent, '收起');

  // 触发一次重渲染，展开状态不能在重画后丢失
  click(doc.getElementById('doneHead'));
  await sleep(40);
  assert.ok(
    rowById(longId).querySelector('.text').classList.contains('expanded'),
    '重渲染后仍应保持展开'
  );

  click(rowById(longId).querySelector('.more'));
  await sleep(40);
  assert.ok(!rowById(longId).querySelector('.text').classList.contains('expanded'), '可再次收起');
  ok('超长内容出现展开入口、可收起、重渲染不丢状态');

  console.log('\n[13] 搜索');
  click(doc.getElementById('btnSearch'));
  await sleep(30);
  assert.ok(!doc.getElementById('searchBar').hidden, '搜索条应展开');

  const si = doc.getElementById('searchInput');
  typeInto(si, '周报');
  await sleep(160);
  assert.strictEqual(rows(doc).length, 1, '“周报”应命中 1 条');
  assert.ok(rows(doc)[0].querySelector('mark'), '命中词应高亮');
  assert.strictEqual(doc.getElementById('searchCount').textContent, '1 条');
  assert.ok(doc.getElementById('doneBlock').hidden, '搜索时收起已完成分区');
  assert.strictEqual(rows(doc)[0].getAttribute('draggable'), 'false', '搜索态禁止拖拽');
  ok('搜索过滤 + 命中高亮 + 结果计数 + 搜索态禁拖拽');

  typeInto(si, '周报 张三');
  await sleep(160);
  assert.strictEqual(rows(doc).length, 0, '两个词都要命中才算');
  assert.ok(!doc.getElementById('noResult').hidden, '无结果时显示空状态');
  typeInto(si, '周报 张工');
  await sleep(160);
  assert.strictEqual(rows(doc).length, 1, '“周报 张工”应命中 1 条');
  ok('多关键词按 AND 匹配，无结果有独立空状态');

  typeInto(si, '报销');
  await sleep(160);
  assert.strictEqual(rows(doc).length, 1, '已完成项也应被搜到');
  assert.ok(rows(doc)[0].classList.contains('done'), '已完成项带 done 标记');
  ok('已完成项参与搜索并可辨认');

  // 关掉搜索，加一条带 HTML 的内容，验证高亮不会注入 DOM
  si.focus();
  press(si, 'Escape');
  await sleep(60);
  assert.ok(doc.getElementById('searchBar').hidden, 'Esc 应关闭搜索');

  typeInto(ta, '<img src=x onerror=alert(1)> 密码备忘');
  press(ta, 'Enter');
  await sleep(50);
  click(doc.getElementById('btnSearch'));
  await sleep(30);
  typeInto(si, 'img');
  await sleep(160);
  const inj = rows(doc)[0];
  assert.ok(inj.querySelector('mark'), '应高亮命中词');
  assert.strictEqual(inj.querySelectorAll('img').length, 0, '不得生成真实 img 元素');
  assert.ok(inj.querySelector('.text').textContent.includes('<img'), '原文按纯文本显示');
  ok('高亮逐段转义，HTML 内容不会变成 DOM');

  si.focus();
  press(si, 'Escape');
  await sleep(60);
  assert.ok(rows(doc).length >= 4, '关闭搜索后恢复完整列表');

  console.log('\n[14] 重复提醒');
  const { describeRepeat } = require('../src/main/recurrence');
  const repId = rows(doc)[0].dataset.id;
  click(rowById(repId).querySelector('[data-act="due"]'));
  await sleep(40);
  assert.ok(!doc.getElementById('duePop').hidden, '提醒浮层应打开');

  click(doc.querySelector('[data-repeat="daily"]'));
  await sleep(30);
  assert.ok(!doc.getElementById('duePop').hidden, '选规则不应关闭浮层');
  assert.ok(doc.getElementById('dueInput').value, '选规则后应自动补一个时间');
  assert.ok(doc.querySelector('[data-repeat="daily"]').classList.contains('on'));

  click(doc.querySelector('[data-repeat="weekly"]'));
  await sleep(30);
  assert.ok(!doc.getElementById('weekChips').hidden, '选“每周”应出现星期选择');
  click(doc.querySelector('[data-weekday="6"]'));
  await sleep(30);
  assert.ok(doc.querySelector('[data-weekday="6"]').classList.contains('on'));

  // 切回每天，再用快捷时间，走完整保存路径
  click(doc.querySelector('[data-repeat="daily"]'));
  await sleep(20);
  click(doc.querySelector('[data-quick="tomorrow"]'));
  await sleep(20);
  click(doc.getElementById('dueSave'));
  await sleep(120);
  await sleep(300);

  const savedRep = lastSaved.todos.find((t) => t.id === repId);
  assert.ok(savedRep, '应已落盘');
  // 注意：渲染层对象产生于 jsdom realm，原型不同，deepStrictEqual 会误判，
  // 这里逐字段断言。
  assert.ok(savedRep.repeat, '规则应写入数据');
  assert.strictEqual(savedRep.repeat.type, 'daily');
  assert.ok(savedRep.dueAt, '保存后应有截止时间');
  const repChip = rowById(repId).querySelector('.chip-due');
  assert.ok(repChip && repChip.classList.contains('rep'), '重复提醒用强调色徽标');
  assert.strictEqual(
    repChip.textContent,
    describeRepeat(savedRep.repeat, savedRep.dueAt),
    '渲染层文案必须与主进程一致'
  );
  ok('重复规则可设可存，徽标文案与主进程 describeRepeat 一致');

  console.log('\n[15] 主进程推进后回写 dueAt');
  const nextIso = new Date(new Date(savedRep.dueAt).getTime() + 86400000).toISOString();
  handlers.fired({
    at: new Date().toISOString(),
    items: [
      {
        id: repId,
        dueAt: nextIso,
        repeat: { type: 'daily' },
        remindedAt: null,
        firedAt: new Date().toISOString(),
        skipped: 0
      }
    ]
  });
  await sleep(60);
  const updatedChip = rowById(repId).querySelector('.chip-due');
  assert.strictEqual(
    updatedChip.textContent,
    describeRepeat({ type: 'daily' }, nextIso),
    '界面应显示推进后的下一次时间'
  );
  ok('提醒触发后界面同步新的 dueAt，不会停留在旧时间');

  console.log('\n[16] 到点横幅');
  const alarmTarget = lastSaved.todos.find((t) => !t.done && t.id !== repId);
  assert.ok(alarmTarget, '需要一条未完成的普通待办');
  handlers.fired({
    at: new Date().toISOString(),
    items: [
      {
        id: alarmTarget.id,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        repeat: null,
        remindedAt: new Date().toISOString(),
        firedAt: new Date().toISOString(),
        skipped: 0
      }
    ]
  });
  await sleep(80);
  assert.ok(!doc.getElementById('alertBar').hidden, '横幅应出现');
  assert.ok(
    /到点/.test(doc.getElementById('alertTitle').textContent),
    '标题应提示到点'
  );
  assert.ok(
    rowById(alarmTarget.id).classList.contains('alarm'),
    '对应条目应持续高亮，不能像 pulse 那样 2 秒后自己消失'
  );
  ok('到点时出现横幅并持续高亮对应条目');

  click(doc.getElementById('alertAck'));
  await sleep(60);
  assert.ok(doc.getElementById('alertBar').hidden, '点「知道了」后横幅应收起');
  assert.ok(
    !rowById(alarmTarget.id).classList.contains('alarm'),
    '高亮应一并解除'
  );
  assert.ok(ackCount > 0, '应通知主进程停止托盘闪烁');
  ok('点「知道了」收起横幅、解除高亮并通知主进程');

  console.log(`\n全部通过：${passed} 项\n`);
  process.exit(0);
}

run().catch((e) => {
  console.error('\n失败：', e.message);
  process.exit(1);
});
