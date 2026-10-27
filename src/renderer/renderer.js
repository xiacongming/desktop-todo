'use strict';

/* =========================================================
   StickyTodo 渲染进程 v1.1
   纯原生实现，无框架。状态全量渲染，200 条以内性能足够。

   v1.1 新增：
   - 多行输入（新增 + 行内编辑），可拖动上边缘调高度
   - 长内容折叠 / 展开
   - 全局搜索（多关键词 AND + 高亮）
   - 重复提醒（每天 / 工作日 / 每周几 / 间隔）
   ========================================================= */

const el = (id) => document.getElementById(id);

const ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.6h6l-.9 5.1 3 3H5.9l3-3L8 3.6Z"/><path d="M12 11.7V20.4"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.9V12l2.9 1.8"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15"/><path d="M9.6 7V5.3h4.8V7"/><path d="M6.5 7l.9 12.2h9.2L17.5 7"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10v3Z"/><path d="M13.8 6.9l3.3 3.3"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3.8a8.2 8.2 0 1 0 0 16.4c1.2 0 1.7-.8 1.7-1.7 0-1.6 1.2-2.3 2.6-2.3h1.4c1.5 0 2.5-1 2.5-2.6C20.2 7.3 16.6 3.8 12 3.8Z"/><circle cx="8.4" cy="9.4" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="13.6" r="1" fill="currentColor" stroke="none"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6"/></svg>',
  hide:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v9"/><path d="M8 10l4 4 4-4"/><path d="M5 20h14"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.6"/><path d="M16 16l4 4"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

const SKIN_LIST = [
  { id: 'paper', name: '纸感米白', color: '#fbf8f2', ring: '#c2603c' },
  { id: 'glass', name: '磨砂深色', color: '#1a1d23', ring: '#7aa2f7' },
  { id: 'mist', name: '淡蓝极简', color: '#f6f9fd', ring: '#3b82f6' },
  { id: 'sunshine', name: '暖黄便签', color: '#fff7da', ring: '#c8842a' },
  { id: 'noir', name: '高对比暗黑', color: '#0e1013', ring: '#3ddc97' }
];

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

const TEXT_MAX = 500;
const HEURISTIC_LIMIT = 110; // ≈ 3 行中文；仅在没有真实布局时兜底（jsdom）

let state = null;
let meta = null;
let editingId = null;
let dragId = null;
let undoStack = [];
let toastTimer = null;
let dueTargetId = null;
let dueDraft = null;
let doneOpen = false;
let userCollapsedDone = false; // 用户主动折叠过，就不再自动展开烦他
let saveTimer = null;
let query = '';
let searchTimer = null;

/* 长内容展开状态：只在内存里，重渲染后仍保持展开 */
const expanded = new Set();

/* 已到点但用户还没点「知道了」的条目，持续高亮；点掉后清空 */
const alarmIds = new Set();
/* 横幅上要展示的文案，[{ id, text }] */
let alarmLines = [];

/* 溢出判定：真实布局下靠测量，无布局环境（jsdom）靠启发式 */
let layoutOk = false;
let overflowIds = new Set();

/* ---------------- 工具 ---------------- */

const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const byOrder = (a, b) => a.order - b.order;
const findTodo = (id) => state.todos.find((t) => t.id === id);

function pad(n) {
  return String(n).padStart(2, '0');
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function terms() {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function searching() {
  return terms().length > 0;
}

/**
 * 搜索高亮。
 * 关键：先按原文切区间，再对每一片单独 esc()。
 * 反过来（先 esc 再按位置切）会因为 &amp; 这类实体变长导致区间全错。
 */
function highlight(text, list) {
  if (!list.length) return esc(text);
  const lower = text.toLowerCase();

  const ranges = [];
  list.forEach((term) => {
    let from = 0;
    for (;;) {
      const p = lower.indexOf(term, from);
      if (p < 0) break;
      ranges.push([p, p + term.length]);
      from = p + term.length;
    }
  });
  if (!ranges.length) return esc(text);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  });

  let out = '';
  let pos = 0;
  merged.forEach(([s, e]) => {
    out += esc(text.slice(pos, s));
    out += '<mark>' + esc(text.slice(s, e)) + '</mark>';
    pos = e;
  });
  out += esc(text.slice(pos));
  return out;
}

/* 与 main/recurrence.js 的 describeRepeat 保持同一套文案（测试里会比对） */
function repeatLabel(rep, iso) {
  if (!rep) return '';
  const d = iso ? new Date(iso) : null;
  const valid = d && !isNaN(d.getTime());
  const time = valid ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';

  if (rep.type === 'daily') return `每天${time}`;
  if (rep.type === 'weekdays') return `工作日${time}`;
  if (rep.type === 'weekly') {
    return `每周${WEEK_CN[rep.weekday === 7 ? 0 : rep.weekday]}${time}`;
  }
  if (rep.type === 'interval') {
    const m = rep.intervalMin;
    return `每 ${m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`}`;
  }
  return '';
}

function dueInfo(t) {
  if (!t.dueAt) return null;
  const d = new Date(t.dueAt);
  if (isNaN(d.getTime())) return null;

  // 重复项的时间由主进程向后推进，永远不会逾期，不需要算「逾期 N 分钟」
  if (t.repeat) {
    return { cls: 'rep', text: repeatLabel(t.repeat, t.dueAt) };
  }

  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const diffMs = d.getTime() - now.getTime();

  if (t.done) {
    return {
      cls: '',
      text: `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    };
  }

  if (diffMs < 0) {
    const mins = Math.round(-diffMs / 60000);
    let text;
    if (mins < 60) text = `逾期 ${mins} 分钟`;
    else if (mins < 60 * 24) text = `逾期 ${Math.round(mins / 60)} 小时`;
    else text = `逾期 ${Math.round(mins / 1440)} 天`;
    return { cls: 'over', text };
  }

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(d, now)) {
    return { cls: 'today', text: `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  if (sameDay(d, tomorrow)) {
    return { cls: '', text: `明天 ${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  return {
    cls: '',
    text: `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  };
}

function todayLabel() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/* ---------------- 持久化 ---------------- */

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.api.saveState(state);
  }, 250);
}

function pushUndo() {
  undoStack.push(JSON.stringify(state.todos));
  if (undoStack.length > 20) undoStack.shift();
}

function undo() {
  const snap = undoStack.pop();
  if (!snap) {
    toast('没有可撤销的操作');
    return;
  }
  state.todos = JSON.parse(snap);
  render();
  save();
  toast('已撤销');
}

/* ---------------- 到点横幅 ---------------- */

/**
 * 到点时把横幅亮出来，并让对应条目持续高亮，直到用户点「知道了」。
 * 系统通知可能被勿扰模式吞掉、窗口也可能正好收在托盘里，
 * 所以横幅状态只放在内存里：窗口重新显示时它还在，不会自己消失。
 */
function showAlarm(items) {
  if (!Array.isArray(items) || !items.length) return;

  const lines = [];
  items.forEach((it) => {
    const t = findTodo(it.id);
    if (!t || t.done) return;
    alarmIds.add(t.id);
    lines.push({ id: t.id, text: t.text.split('\n')[0] });
  });
  if (!lines.length) return;

  alarmLines = lines;

  const bar = el('alertBar');
  const title = el('alertTitle');
  const box = el('alertLines');
  if (!bar || !title || !box) return;

  title.textContent = lines.length === 1 ? '到点了' : `${lines.length} 项到点`;

  const head = lines.slice(0, 3);
  box.innerHTML = head
    .map((l) => `<div class="alert-line">${esc(l.text)}</div>`)
    .join('');
  if (lines.length > 3) {
    box.innerHTML += `<div class="alert-line">等 ${lines.length} 项</div>`;
  }

  bar.hidden = false;
}

function ackAlarm() {
  alarmIds.clear();
  alarmLines = [];
  const bar = el('alertBar');
  if (bar) bar.hidden = true;
  render();
  try {
    window.api.ackReminders();
  } catch (_) {
    /* 旧版主进程没有这个通道，忽略即可 */
  }
}

/* ---------------- 渲染 ---------------- */

function heuristicOverflow(text) {
  if (String(text).split('\n').length > 3) return true;
  return String(text).length > HEURISTIC_LIMIT;
}

function needShowMore(t) {
  if (expanded.has(t.id)) return true; // 展开态要显示「收起」
  if (layoutOk) return overflowIds.has(t.id);
  return heuristicOverflow(t.text);
}

function rowHTML(t) {
  const editing = editingId === t.id;
  const info = dueInfo(t);
  const isOpen = expanded.has(t.id);
  const inSearch = searching();
  const list = inSearch ? terms() : [];

  const cls = ['row'];
  if (t.done) cls.push('done');
  if (t.pinned && !t.done) cls.push('pinned');
  if (editing) cls.push('editing');
  if (!t.done && alarmIds.has(t.id)) cls.push('alarm');

  const canDrag = !t.done && !editing && !inSearch;

  const acts = [];
  acts.push(
    `<button class="mini-btn" data-act="edit" title="编辑">${ICONS.edit}</button>`
  );
  if (!t.done) {
    acts.push(
      `<button class="mini-btn ${t.pinned ? 'on' : ''}" data-act="pin" title="${
        t.pinned ? '取消置顶' : '置顶'
      }">${ICONS.pin}</button>`
    );
    acts.push(
      `<button class="mini-btn" data-act="due" title="设置提醒">${ICONS.clock}</button>`
    );
  }
  acts.push(
    `<button class="mini-btn del" data-act="del" title="删除">${ICONS.trash}</button>`
  );

  const textHTML = editing
    ? `<textarea class="edit-input" data-edit="${t.id}" rows="1" maxlength="${TEXT_MAX}" spellcheck="false">${esc(
        t.text
      )}</textarea>`
    : `<div class="text ${isOpen ? 'expanded' : ''}" title="双击编辑">${
        inSearch ? highlight(t.text, list) : esc(t.text)
      }</div>`;

  const moreHTML =
    !editing && needShowMore(t)
      ? `<button class="more" data-act="more">${isOpen ? '收起' : '展开'}</button>`
      : '';

  return `<div class="${cls.join(' ')}" data-id="${t.id}" data-pin="${
    t.pinned ? 1 : 0
  }" data-done="${t.done ? 1 : 0}" data-editing="${editing ? 1 : 0}" draggable="${
    canDrag ? 'true' : 'false'
  }">
    <button class="check" data-act="toggle" title="${
      t.done ? '标记为未完成' : '标记完成'
    }" aria-pressed="${t.done}"></button>
    <div class="body">
      ${textHTML}
      ${moreHTML}
      ${info ? `<div class="meta"><span class="chip-due ${info.cls}">${esc(info.text)}</span></div>` : ''}
    </div>
    <div class="row-actions">${acts.join('')}</div>
  </div>`;
}

function measureOverflow() {
  const next = new Set();
  if (!layoutOk) return next;
  document.querySelectorAll('.row').forEach((row) => {
    const id = row.dataset.id;
    if (!id || expanded.has(id)) return;
    const tx = row.querySelector('.text');
    if (!tx) return;
    if (tx.scrollHeight > tx.clientHeight + 1) next.add(id);
  });
  return next;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

let rendering = false;

function render() {
  const inSearch = searching();
  const list = inSearch ? terms() : [];

  let mainRows = [];
  let doneRows = [];

  if (inSearch) {
    const hits = state.todos.filter((t) =>
      list.every((k) => t.text.toLowerCase().includes(k))
    );
    hits.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.order - b.order;
    });
    mainRows = hits;
  } else {
    const pinned = state.todos.filter((t) => !t.done && t.pinned).sort(byOrder);
    const open = state.todos.filter((t) => !t.done && !t.pinned).sort(byOrder);
    doneRows = state.todos
      .filter((t) => t.done)
      .sort((a, b) =>
        String(b.completedAt || '').localeCompare(String(a.completedAt || ''))
      );
    mainRows = [...pinned, ...open];
  }

  el('dateLabel').textContent = todayLabel();

  const activeCount = state.todos.filter((t) => !t.done).length;
  el('countBadge').textContent = String(inSearch ? mainRows.length : activeCount);
  el('countBadge').style.display = (inSearch ? mainRows.length : activeCount)
    ? ''
    : 'none';

  el('list').innerHTML = mainRows.map(rowHTML).join('');

  el('empty').hidden = inSearch || mainRows.length > 0;
  el('noResult').hidden = !inSearch || mainRows.length > 0;
  el('searchCount').textContent = inSearch ? `${mainRows.length} 条` : '';

  const block = el('doneBlock');
  block.hidden = inSearch || doneRows.length === 0;
  el('doneCount').textContent = String(doneRows.length);
  el('doneChev').innerHTML = ICONS.chevron;
  block.classList.toggle('open', doneOpen);

  el('doneList').innerHTML = doneRows.map(rowHTML).join('');
  if (doneRows.length && !inSearch) {
    const btn = document.createElement('button');
    btn.className = 'clear-done';
    btn.textContent = '清空已完成';
    btn.addEventListener('click', clearDone);
    el('doneList').appendChild(btn);
  }

  if (editingId) {
    const ta = document.querySelector(`[data-edit="${editingId}"]`);
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      growEdit(ta);
    }
  }

  updatePinBtn();

  // 布局可用时再测一次真实溢出。测量结果变了要重画一次，
  // 否则「启发式判不出来、但窄窗口下确实溢出」的条目会一直没有展开按钮。
  if (!rendering) {
    const next = measureOverflow();
    if (!sameSet(next, overflowIds)) {
      overflowIds = next;
      rendering = true;
      render();
      rendering = false;
    }
  }
}

function updatePinBtn() {
  const on = !!state.settings.alwaysOnTop;
  const btn = el('btnPin');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? '取消置顶' : '置顶显示';
}

/* ---------------- 输入区高度 ---------------- */

function composerCeil() {
  return Math.round(window.innerHeight * 0.55);
}

function growComposer() {
  const ta = el('input');
  if (!ta) return;

  const fixed = state && state.settings ? state.settings.composerHeight : null;
  if (Number.isFinite(fixed)) {
    ta.style.height = fixed + 'px';
    ta.style.overflowY = 'auto';
    return;
  }

  ta.style.height = 'auto';
  const sh = ta.scrollHeight;
  if (!sh) return; // 布局不可用（jsdom），保持 CSS 默认高度
  const max = Math.min(Math.round(window.innerHeight * 0.4), 260);
  ta.style.height = Math.max(28, Math.min(sh, max)) + 'px';
  ta.style.overflowY = sh > max ? 'auto' : 'hidden';
}

function growEdit(ta) {
  ta.style.height = 'auto';
  const sh = ta.scrollHeight;
  if (!sh) return;
  const max = 19 * 12; // 12 行封顶
  ta.style.height = Math.max(19, Math.min(sh, max)) + 'px';
  ta.style.overflowY = sh > max ? 'auto' : 'hidden';
}

function bindGrip() {
  const grip = el('grip');
  let dragging = false;
  let startY = 0;
  let startH = 0;

  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const ta = el('input');
    const r = ta.getBoundingClientRect();
    startY = e.clientY;
    startH = r.height || ta.offsetHeight || 28;
    dragging = true;
    document.body.classList.add('resizing');
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const h = clamp(startH - (e.clientY - startY), 28, composerCeil());
    state.settings.composerHeight = h;
    growComposer();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing');
    save();
  });

  // 双击手柄在「紧凑」和「大输入」之间切换。
  // 不放在输入框上：双击选中单词是输入框的必备行为，不能被抢。
  grip.addEventListener('dblclick', () => {
    state.settings.composerHeight = Number.isFinite(state.settings.composerHeight)
      ? null
      : Math.round(window.innerHeight * 0.45);
    growComposer();
    save();
  });
}

/* ---------------- 待办操作 ---------------- */

function addTodo(text) {
  const v = String(text || '').trim().slice(0, TEXT_MAX);
  if (!v) return;

  const minOrder = state.todos
    .filter((t) => !t.done)
    .reduce((m, t) => Math.min(m, t.order), 1024);

  state.todos.push({
    id: uid(),
    text: v,
    done: false,
    pinned: false,
    order: minOrder - 1024,
    dueAt: null,
    repeat: null,
    remindedAt: null,
    firedAt: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  });

  render();
  save();
  el('scroll').scrollTop = 0;
}

function toggleDone(id) {
  const t = findTodo(id);
  if (!t) return;

  const row = document.querySelector(`.row[data-id="${id}"]`);

  if (!t.done && row) {
    // 先播放下沉动画，再改状态重排，避免"瞬间跳走"
    row.classList.add('completing');
    setTimeout(() => commitToggle(id), 170);
  } else {
    commitToggle(id);
  }
}

function commitToggle(id) {
  const t = findTodo(id);
  if (!t) return;

  t.done = !t.done;
  if (t.done) {
    t.completedAt = new Date().toISOString();
    t.pinned = false;
    // 保留原 order，取消完成时能回到原来的位置
    // 折叠着就展开一下，让人看见它去哪儿了；用户自己收起的除外
    if (!doneOpen && !userCollapsedDone) doneOpen = true;
  } else {
    t.completedAt = null;
  }
  render();
  save();
}

function togglePin(id) {
  const t = findTodo(id);
  if (!t || t.done) return;

  if (!t.pinned) {
    const minPinned = state.todos
      .filter((x) => !x.done && x.pinned)
      .reduce((m, x) => Math.min(m, x.order), 1024);
    t.order = minPinned - 1024;
  }
  t.pinned = !t.pinned;
  render();
  save();
}

function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();
}

function deleteTodo(id) {
  pushUndo();
  state.todos = state.todos.filter((t) => t.id !== id);
  expanded.delete(id);
  render();
  save();
  toast('已删除 1 项', [{ label: '撤销', fn: undo }]);
}

function clearDone() {
  const n = state.todos.filter((t) => t.done).length;
  if (!n) return;

  toast(
    `清空 ${n} 项已完成？`,
    [
      {
        label: '清空',
        fn: () => {
          pushUndo();
          state.todos = state.todos.filter((t) => !t.done);
          render();
          save();
          toast('已清空', [{ label: '撤销', fn: undo }]);
        }
      },
      { label: '取消', fn: () => {} }
    ],
    6000
  );
}

function startEdit(id) {
  const t = findTodo(id);
  if (!t) return;
  // 已完成的条目也允许改错别字，只是改完仍留在已完成区
  editingId = id;
  render();
}

function finishEdit(id, value, cancelled) {
  const t = findTodo(id);
  editingId = null;

  if (!t) {
    render();
    return;
  }

  if (!cancelled) {
    const v = String(value || '').trim().slice(0, TEXT_MAX);
    if (v && v !== t.text) {
      t.text = v;
      save();
    } else if (!v) {
      // 编辑成空 = 删除这项，给一次撤销机会
      pushUndo();
      state.todos = state.todos.filter((x) => x.id !== id);
      expanded.delete(id);
      save();
      render();
      toast('内容清空，已删除该项', [{ label: '撤销', fn: undo }]);
      return;
    }
  }
  render();
}

/* ---------------- 搜索 ---------------- */

function openSearch() {
  const bar = el('searchBar');
  if (!bar.hidden) {
    el('searchInput').focus();
    el('searchInput').select();
    return;
  }
  bar.hidden = false;
  el('btnSearch').classList.add('on');
  el('searchInput').value = query;
  render();
  el('searchInput').focus();
}

function closeSearch() {
  query = '';
  clearTimeout(searchTimer);
  el('searchInput').value = '';
  el('searchBar').hidden = true;
  el('btnSearch').classList.remove('on');
  render();
}

function onSearchInput(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = value;
    render();
  }, 100);
}

/* ---------------- Toast ---------------- */

function toast(text, actions, duration = 5000) {
  const box = el('toast');
  box.innerHTML =
    `<span>${esc(text)}</span>` +
    (actions || [])
      .map((a, i) => `<button class="toast-act" data-i="${i}">${esc(a.label)}</button>`)
      .join('');

  box.querySelectorAll('.toast-act').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = actions[Number(btn.dataset.i)];
      hideToast();
      if (a && a.fn) a.fn();
    });
  });

  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  el('toast').hidden = true;
  clearTimeout(toastTimer);
}

/* ---------------- 浮层 ---------------- */

let openPop = null;

function positionPopover(pop, anchor) {
  pop.hidden = false;
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor ? anchor.getBoundingClientRect().right - pr.width : 12;
  let top = anchor ? anchor.getBoundingClientRect().bottom + 6 : 46;

  left = Math.max(10, Math.min(left, vw - pr.width - 10));
  if (top + pr.height > vh - 12) {
    top = Math.max(10, (anchor ? anchor.getBoundingClientRect().top : 200) - pr.height - 6);
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function closePops() {
  ['skinPop', 'setPop', 'duePop'].forEach((id) => {
    el(id).hidden = true;
  });
  openPop = null;
}

function togglePop(id, anchor, builder) {
  const pop = el(id);
  if (!pop.hidden) {
    closePops();
    return;
  }
  closePops();
  if (builder) builder(pop);
  positionPopover(pop, anchor);
  openPop = pop;
}

function buildSkinPop(pop) {
  pop.innerHTML =
    `<div class="pop-title">皮肤</div>` +
    SKIN_LIST.map(
      (s) =>
        `<button class="skin-item ${state.settings.skin === s.id ? 'active' : ''}" data-skin="${
          s.id
        }">
           <span class="sw" style="background:${s.color};box-shadow:inset 0 0 0 3px ${s.ring}22"></span>
           <span>${s.name}</span>
         </button>`
    ).join('');

  pop.querySelectorAll('.skin-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      applySkin(btn.dataset.skin);
      closePops();
    });
  });
}

function applySkin(skin) {
  if (!SKIN_LIST.some((s) => s.id === skin)) return;
  document.body.dataset.skin = skin;
  state.settings.skin = skin;
  save();
}

function syncSettingsUI() {
  const s = state.settings;
  el('swTop').classList.toggle('on', !!s.alwaysOnTop);
  el('swAuto').classList.toggle('on', !!(meta && meta.autostart));
  el('swHot').classList.toggle('on', s.globalHotkey !== false);
  updatePinBtn();
  el('verFoot').textContent = `StickyTodo v${(meta && meta.version) || '1.1.0'} · ${
    meta && meta.packaged ? '正式版' : '开发模式'
  }`;
}

/* ---------------- 提醒（截止时间 + 重复） ---------------- */

function openDuePop(id, anchor) {
  const t = findTodo(id);
  if (!t) return;
  dueTargetId = id;
  dueDraft = {
    repeat: t.repeat ? Object.assign({}, t.repeat) : null
  };
  closePops();
  el('dueInput').value = toLocalInput(t.dueAt);
  syncDueUI();
  positionPopover(el('duePop'), anchor);
  openPop = el('duePop');
  el('dueInput').focus();
}

function syncDueUI() {
  const rep = dueDraft ? dueDraft.repeat : null;
  const kind = !rep ? 'none' : rep.type;

  el('duePop').querySelectorAll('[data-repeat]').forEach((b) => {
    b.classList.toggle('on', b.dataset.repeat === kind);
  });

  el('weekChips').hidden = kind !== 'weekly';
  el('duePop').querySelectorAll('[data-weekday]').forEach((b) => {
    b.classList.toggle(
      'on',
      !!rep && rep.type === 'weekly' && Number(b.dataset.weekday) === rep.weekday
    );
  });

  el('intervalChips').hidden = kind !== 'interval';
  el('duePop').querySelectorAll('[data-interval]').forEach((b) => {
    b.classList.toggle(
      'on',
      !!rep && rep.type === 'interval' && Number(b.dataset.interval) === rep.intervalMin
    );
  });
}

function ensureDraftTime() {
  if (!dueDraft || !dueDraft.repeat) return;
  if (el('dueInput').value) return;
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes() + 5,
    0,
    0
  );
  el('dueInput').value = toLocalInput(d.toISOString());
}

function setDraftRepeat(kind) {
  if (!dueDraft) return;
  if (kind === 'none') {
    dueDraft.repeat = null;
  } else if (kind === 'daily' || kind === 'weekdays') {
    dueDraft.repeat = { type: kind };
  } else if (kind === 'weekly') {
    const base = dueDraft.repeat;
    const fallbackDay = new Date().getDay();
    dueDraft.repeat = {
      type: 'weekly',
      weekday: (base && base.weekday) || (fallbackDay === 0 ? 7 : fallbackDay)
    };
  } else if (kind === 'interval') {
    const base = dueDraft.repeat;
    dueDraft.repeat = {
      type: 'interval',
      intervalMin: (base && base.intervalMin) || 30
    };
  }
  ensureDraftTime();
  syncDueUI();
}

function quickDate(kind) {
  const now = new Date();
  let d;
  if (kind === 'today') {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
    if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
  } else if (kind === 'tomorrow') {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  } else {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    const add = (8 - d.getDay()) % 7 || 7; // 下周一
    d.setDate(d.getDate() + add);
  }
  el('dueInput').value = toLocalInput(d.toISOString());
}

function saveDue(clear) {
  const t = findTodo(dueTargetId);
  if (!t) {
    closePops();
    return;
  }

  if (clear) {
    t.dueAt = null;
    t.repeat = null;
    t.remindedAt = null;
    t.firedAt = null;
  } else {
    const v = el('dueInput').value;
    if (!v) {
      t.dueAt = null;
      t.repeat = null;
      t.remindedAt = null;
    } else {
      const d = new Date(v);
      if (isNaN(d.getTime())) return;
      t.dueAt = d.toISOString();
      t.repeat = dueDraft && dueDraft.repeat ? Object.assign({}, dueDraft.repeat) : null;
      t.remindedAt = null;
    }
  }

  closePops();
  render();
  save();
}

/* ---------------- 拖拽排序 ---------------- */

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((n) => {
    n.classList.remove('drop-before', 'drop-after');
  });
}

function handleDrop(targetRow, after) {
  if (!dragId || !targetRow) return;
  const targetId = targetRow.dataset.id;
  if (targetId === dragId) return;

  const dragging = findTodo(dragId);
  const target = findTodo(targetId);
  if (!dragging || !target) return;

  // 置顶区与普通区之间不允许互相拖入
  if (!!dragging.pinned !== !!target.pinned) return;
  if (dragging.done || target.done) return;

  const group = state.todos
    .filter((t) => !t.done && !!t.pinned === !!dragging.pinned)
    .sort(byOrder);

  const from = group.findIndex((t) => t.id === dragId);
  if (from < 0) return;
  group.splice(from, 1);

  let to = group.findIndex((t) => t.id === targetId);
  if (to < 0) to = group.length - 1;
  group.splice(after ? to + 1 : to, 0, dragging);

  group.forEach((t, i) => {
    t.order = (i + 1) * 1024;
  });

  render();
  save();
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  el('btnSearch').innerHTML = ICONS.search;
  el('btnPin').innerHTML = ICONS.pin;
  el('btnSkin').innerHTML = ICONS.palette;
  el('btnSettings').innerHTML = ICONS.gear;
  el('btnHide').innerHTML = ICONS.hide;
  el('searchIco').innerHTML = ICONS.search;
  el('searchClose').innerHTML = ICONS.close;

  // 新增：Enter 提交，Shift+Enter 换行，中文输入法回车不误提交
  const input = el('input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      growComposer();
      addTodo(v);
    } else if (e.key === 'Escape') {
      input.value = '';
      growComposer();
      input.blur();
    }
  });
  input.addEventListener('input', growComposer);

  // 行内交互（事件委托，任何一次重渲染都不用重新绑定）
  const scroll = el('scroll');

  scroll.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-act]');
    const row = e.target.closest('.row');
    if (!actBtn || !row) return;
    const id = row.dataset.id;

    switch (actBtn.dataset.act) {
      case 'toggle':
        e.stopPropagation();
        toggleDone(id);
        break;
      case 'pin':
        e.stopPropagation();
        togglePin(id);
        break;
      case 'del':
        e.stopPropagation();
        deleteTodo(id);
        break;
      case 'due':
        e.stopPropagation();
        openDuePop(id, actBtn);
        break;
      case 'edit':
        e.stopPropagation();
        startEdit(id);
        break;
      case 'more':
        e.stopPropagation();
        toggleExpand(id);
        break;
    }
  });

  // 双击正文进入编辑（已完成的也允许改）
  scroll.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('[data-act]')) return;
    if (e.target.closest('.text') || e.target.closest('.meta')) startEdit(row.dataset.id);
  });

  // 行内编辑：Enter 保存、Shift+Enter 换行、Esc 取消
  scroll.addEventListener('keydown', (e) => {
    if (!e.target.classList || !e.target.classList.contains('edit-input')) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      finishEdit(e.target.dataset.edit, e.target.value, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(e.target.dataset.edit, e.target.value, true);
      e.target.blur();
    }
  });

  scroll.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('edit-input')) growEdit(e.target);
  });

  scroll.addEventListener(
    'blur',
    (e) => {
      if (e.target.classList && e.target.classList.contains('edit-input')) {
        finishEdit(e.target.dataset.edit, e.target.value, false);
      }
    },
    true
  );

  // 拖拽
  scroll.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row');
    // 编辑态 / 搜索态 / 已完成项都不允许拖，否则选字会变成拖拽
    if (!row || row.dataset.done === '1' || row.dataset.editing === '1' || searching()) {
      e.preventDefault();
      return;
    }
    dragId = row.dataset.id;
    row.classList.add('dragging');
    document.body.classList.add('dragging-active');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  scroll.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const row = e.target.closest('.row');
    if (!row || row.dataset.done === '1') return;

    const dragging = findTodo(dragId);
    if (!dragging || !!dragging.pinned !== (row.dataset.pin === '1')) return;
    if (row.dataset.id === dragId) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });

  scroll.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.row');
    if (row) row.classList.remove('drop-before', 'drop-after');
  });

  scroll.addEventListener('drop', (e) => {
    const row = e.target.closest('.row');
    if (!row || !dragId) return;
    e.preventDefault();
    const after = row.classList.contains('drop-after');
    handleDrop(row, after);
    clearDropMarks();
  });

  scroll.addEventListener('dragend', () => {
    dragId = null;
    document.body.classList.remove('dragging-active');
    clearDropMarks();
    document.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
  });

  // 已完成折叠
  el('doneHead').addEventListener('click', () => {
    doneOpen = !doneOpen;
    userCollapsedDone = !doneOpen;
    render();
  });

  // 搜索
  el('btnSearch').addEventListener('click', (e) => {
    e.stopPropagation();
    openSearch();
  });
  el('searchClose').addEventListener('click', closeSearch);
  el('searchInput').addEventListener('input', (e) => onSearchInput(e.target.value));
  el('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
    }
  });

  // 顶部按钮
  el('btnPin').addEventListener('click', async () => {
    const want = !state.settings.alwaysOnTop;
    const actual = await window.api.setAlwaysOnTop(want);
    state.settings.alwaysOnTop = actual;
    updatePinBtn();
  });

  el('btnSkin').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePop('skinPop', el('btnSkin'), buildSkinPop);
  });

  el('btnSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePop('setPop', el('btnSettings'), syncSettingsUI);
  });

  el('btnHide').addEventListener('click', () => window.api.hide());

  // 设置项
  el('swTop').addEventListener('click', async () => {
    const want = !state.settings.alwaysOnTop;
    const actual = await window.api.setAlwaysOnTop(want);
    state.settings.alwaysOnTop = actual;
    syncSettingsUI();
  });

  el('swAuto').addEventListener('click', async () => {
    const want = !(meta && meta.autostart);
    const actual = await window.api.setAutoLaunch(want);
    if (meta) meta.autostart = actual;
    state.settings.autoLaunch = !!actual;
    save();
    syncSettingsUI();
  });

  el('swHot').addEventListener('click', async () => {
    const want = state.settings.globalHotkey === false;
    const actual = await window.api.setHotkey(want);
    state.settings.globalHotkey = !!actual;
    syncSettingsUI();
  });

  el('btnDataDir').addEventListener('click', () => window.api.openDataDir());

  // 提醒浮层
  el('dueSave').addEventListener('click', () => saveDue(false));
  el('dueClear').addEventListener('click', () => saveDue(true));
  el('dueInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDue(false);
  });
  el('dueInput').addEventListener('input', () => {
    // 手动改时间时，如果已选重复规则就保持，不再自动补时间
  });

  el('duePop').querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => quickDate(btn.dataset.quick));
  });
  el('duePop').querySelectorAll('[data-repeat]').forEach((btn) => {
    btn.addEventListener('click', () => setDraftRepeat(btn.dataset.repeat));
  });
  el('duePop').querySelectorAll('[data-weekday]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!dueDraft.repeat || dueDraft.repeat.type !== 'weekly') {
        dueDraft.repeat = { type: 'weekly', weekday: Number(btn.dataset.weekday) };
      } else {
        dueDraft.repeat.weekday = Number(btn.dataset.weekday);
      }
      ensureDraftTime();
      syncDueUI();
    });
  });
  el('duePop').querySelectorAll('[data-interval]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!dueDraft.repeat || dueDraft.repeat.type !== 'interval') {
        dueDraft.repeat = { type: 'interval', intervalMin: Number(btn.dataset.interval) };
      } else {
        dueDraft.repeat.intervalMin = Number(btn.dataset.interval);
      }
      ensureDraftTime();
      syncDueUI();
    });
  });

  // 点击空白关闭浮层
  document.addEventListener('mousedown', (e) => {
    if (!openPop) return;
    if (openPop.contains(e.target)) return;
    if (e.target.closest('#btnSkin') || e.target.closest('#btnSettings')) return;
    if (e.target.closest('[data-act="due"]')) return;
    closePops();
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    const inSearchInput = document.activeElement === el('searchInput');

    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
      return;
    }

    if (e.key === 'Escape') {
      if (inSearchInput && searching()) {
        closeSearch();
        return;
      }
      closePops();
      return;
    }

    const inInput =
      document.activeElement === el('input') ||
      (document.activeElement && document.activeElement.classList.contains('edit-input'));

    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z' && !inInput) {
      e.preventDefault();
      undo();
    }
  });

  // 窗口尺寸变化后重算溢出（窄窗口下长文本的换行行数会变）
  window.addEventListener('resize', () => {
    clearTimeout(window.__resizeTimer);
    window.__resizeTimer = setTimeout(() => {
      if (!layoutOk) return;
      const next = measureOverflow();
      if (!sameSet(next, overflowIds)) {
        overflowIds = next;
        render();
      }
      if (!Number.isFinite(state.settings.composerHeight)) growComposer();
    }, 200);
  });

  // 来自主进程的事件
  window.api.onSkinChanged((skin) => {
    applySkin(skin);
    render();
  });

  window.api.onSettingsChanged((settings) => {
    Object.assign(state.settings, settings);
    syncSettingsUI();
  });

  // 主进程提醒后把推进过的 dueAt 同步回来，否则界面还显示上一轮的旧时间
  el('alertAck').addEventListener('click', ackAlarm);

  window.api.onRemindersFired(({ items }) => {
    if (!Array.isArray(items)) return;
    items.forEach((it) => {
      const t = findTodo(it.id);
      if (!t) return;
      t.dueAt = it.dueAt;
      t.repeat = it.repeat;
      t.remindedAt = it.remindedAt;
      t.firedAt = it.firedAt;
    });
    showAlarm(items);
    render();
  });

  window.api.onRemindersPulse(({ ids }) => {
    ids.forEach((id) => {
      const row = document.querySelector(`.row[data-id="${id}"]`);
      if (row) {
        row.classList.add('pulse');
        setTimeout(() => row.classList.remove('pulse'), 2400);
      }
    });
  });

  // 数据异常提示
  if (meta && meta.loadError) {
    el('bannerText').textContent = meta.loadError;
    el('banner').hidden = false;
    el('bannerBtn').addEventListener('click', () => window.api.openDataDir());
  }
}

/* ---------------- 启动 ---------------- */

function detectLayout() {
  // jsdom 不做布局计算，所有 clientHeight 都是 0。
  // 探一次真实布局能力，没有就走启发式判定，别让「展开」按钮在测试里永远不出现。
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;left:0;width:40px;height:20px;';
  document.body.appendChild(probe);
  layoutOk = probe.clientHeight > 0;
  probe.remove();
}

async function boot() {
  if (!window.api) {
    document.body.innerHTML =
      '<div style="padding:24px;font:13px/1.6 sans-serif;color:#b0741f">预加载脚本未生效，请重启程序。</div>';
    return;
  }

  const res = await window.api.load();
  state = res.state;
  meta = res;

  document.body.dataset.skin = state.settings.skin || 'paper';
  doneOpen = false;

  detectLayout();
  bindEvents();
  bindGrip();
  render();
  syncSettingsUI();
  growComposer();

  el('input').focus();

  // 每分钟刷新一次日期与逾期状态，避免窗口常驻时信息过期
  setInterval(() => {
    if (!editingId) render();
  }, 60000);
}

boot();
