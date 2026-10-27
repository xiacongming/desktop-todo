'use strict';

/* =========================================================
   StickyTodo 渲染进程
   纯原生实现，无框架。状态全量渲染，200 条以内性能足够。
   ========================================================= */

const el = (id) => document.getElementById(id);

const ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.6h6l-.9 5.1 3 3H5.9l3-3L8 3.6Z"/><path d="M12 11.7V20.4"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.9V12l2.9 1.8"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15"/><path d="M9.6 7V5.3h4.8V7"/><path d="M6.5 7l.9 12.2h9.2L17.5 7"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3.8a8.2 8.2 0 1 0 0 16.4c1.2 0 1.7-.8 1.7-1.7 0-1.6 1.2-2.3 2.6-2.3h1.4c1.5 0 2.5-1 2.5-2.6C20.2 7.3 16.6 3.8 12 3.8Z"/><circle cx="8.4" cy="9.4" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="13.6" r="1" fill="currentColor" stroke="none"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6"/></svg>',
  hide:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v9"/><path d="M8 10l4 4 4-4"/><path d="M5 20h14"/></svg>'
};

const SKIN_LIST = [
  { id: 'paper', name: '纸感米白', color: '#fbf8f2', ring: '#c2603c' },
  { id: 'glass', name: '磨砂深色', color: '#1a1d23', ring: '#7aa2f7' },
  { id: 'mist', name: '淡蓝极简', color: '#f6f9fd', ring: '#3b82f6' },
  { id: 'sunshine', name: '暖黄便签', color: '#fff7da', ring: '#c8842a' },
  { id: 'noir', name: '高对比暗黑', color: '#0e1013', ring: '#3ddc97' }
];

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

let state = null;
let meta = null;
let editingId = null;
let dragId = null;
let undoStack = [];
let toastTimer = null;
let dueTargetId = null;
let doneOpen = false;
let userCollapsedDone = false; // 用户主动折叠过，就不再自动展开烦他
let saveTimer = null;

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

function dueInfo(t) {
  if (!t.dueAt) return null;
  const d = new Date(t.dueAt);
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const diffMs = d.getTime() - now.getTime();

  if (t.done) {
    return { cls: '', text: `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` };
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

/* ---------------- 渲染 ---------------- */

function rowHTML(t) {
  const editing = editingId === t.id;
  const info = dueInfo(t);
  const cls = ['row'];
  if (t.done) cls.push('done');
  if (t.pinned && !t.done) cls.push('pinned');

  const actions = t.done
    ? ''
    : `<div class="row-actions">
         <button class="mini-btn ${t.pinned ? 'on' : ''}" data-act="pin" title="${
        t.pinned ? '取消置顶' : '置顶'
      }">${ICONS.pin}</button>
         <button class="mini-btn" data-act="due" title="设置截止时间">${ICONS.clock}</button>
         <button class="mini-btn del" data-act="del" title="删除">${ICONS.trash}</button>
       </div>`;

  const textHTML = editing
    ? `<input class="edit-input" data-edit="${t.id}" value="${esc(t.text)}" maxlength="500" />`
    : `<div class="text">${esc(t.text)}</div>`;

  return `<div class="${cls.join(' ')}" data-id="${t.id}" data-pin="${
    t.pinned ? 1 : 0
  }" data-done="${t.done ? 1 : 0}" draggable="${t.done ? 'false' : 'true'}">
    <button class="check" data-act="toggle" title="${
      t.done ? '标记为未完成' : '标记完成'
    }" aria-pressed="${t.done}"></button>
    <div class="body">
      ${textHTML}
      ${info ? `<div class="meta"><span class="chip-due ${info.cls}">${esc(info.text)}</span></div>` : ''}
    </div>
    ${actions}
  </div>`;
}

function render() {
  const todos = state.todos;
  const pinned = todos.filter((t) => !t.done && t.pinned).sort(byOrder);
  const open = todos.filter((t) => !t.done && !t.pinned).sort(byOrder);
  const done = todos
    .filter((t) => t.done)
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));

  el('dateLabel').textContent = todayLabel();
  el('countBadge').textContent = String(pinned.length + open.length);
  el('countBadge').style.display = pinned.length + open.length ? '' : 'none';

  el('list').innerHTML = [...pinned, ...open].map(rowHTML).join('');

  const empty = pinned.length + open.length === 0;
  el('empty').hidden = !empty;

  const block = el('doneBlock');
  block.hidden = done.length === 0;
  el('doneCount').textContent = String(done.length);
  el('doneChev').innerHTML = ICONS.chevron;
  block.classList.toggle('open', doneOpen);

  el('doneList').innerHTML = done.map(rowHTML).join('');
  if (done.length) {
    const btn = document.createElement('button');
    btn.className = 'clear-done';
    btn.textContent = '清空已完成';
    btn.addEventListener('click', clearDone);
    el('doneList').appendChild(btn);
  }

  if (editingId) {
    const input = document.querySelector(`[data-edit="${editingId}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  updatePinBtn();
}

function updatePinBtn() {
  const on = !!state.settings.alwaysOnTop;
  const btn = el('btnPin');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? '取消置顶' : '置顶显示';
}

/* ---------------- 待办操作 ---------------- */

function addTodo(text) {
  const v = String(text || '').trim().slice(0, 500);
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
    remindedAt: null,
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

function deleteTodo(id) {
  pushUndo();
  state.todos = state.todos.filter((t) => t.id !== id);
  render();
  save();
  toast('已删除 1 项', [{ label: '撤销', fn: undo }]);
}

function clearDone() {
  const n = state.todos.filter((t) => t.done).length;
  if (!n) return;

  toast(`清空 ${n} 项已完成？`, [
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
  ], 6000);
}

function startEdit(id) {
  const t = findTodo(id);
  if (!t || t.done) return;
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
    const v = String(value || '').trim().slice(0, 500);
    if (v && v !== t.text) {
      t.text = v;
      save();
    } else if (!v) {
      // 编辑成空 = 删除这项
      state.todos = state.todos.filter((x) => x.id !== id);
      save();
    }
  }
  render();
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
  el('verFoot').textContent = `StickyTodo v1.0.0 · ${
    meta && meta.packaged ? '正式版' : '开发模式'
  }`;
}

/* ---------------- 截止时间 ---------------- */

function openDuePop(id, anchor) {
  const t = findTodo(id);
  if (!t) return;
  dueTargetId = id;
  closePops();
  const pop = el('duePop');
  el('dueInput').value = toLocalInput(t.dueAt);
  positionPopover(pop, anchor);
  openPop = pop;
  el('dueInput').focus();
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
  if (!t) return closePops();

  if (clear) {
    t.dueAt = null;
    t.remindedAt = null;
  } else {
    const v = el('dueInput').value;
    if (!v) {
      t.dueAt = null;
      t.remindedAt = null;
    } else {
      const d = new Date(v);
      if (isNaN(d.getTime())) return;
      t.dueAt = d.toISOString();
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
  el('btnPin').innerHTML = ICONS.pin;
  el('btnSkin').innerHTML = ICONS.palette;
  el('btnSettings').innerHTML = ICONS.gear;
  el('btnHide').innerHTML = ICONS.hide;

  // 新增
  const input = el('input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      addTodo(v);
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

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
    }
  });

  scroll.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (e.target.closest('.text')) startEdit(row.dataset.id);
  });

  // 行内编辑
  scroll.addEventListener('keydown', (e) => {
    if (!e.target.classList || !e.target.classList.contains('edit-input')) return;
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      finishEdit(e.target.dataset.edit, e.target.value, false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(e.target.dataset.edit, e.target.value, true);
    }
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
    if (!row || row.dataset.done === '1') {
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

  // 截止时间浮层
  el('dueSave').addEventListener('click', () => saveDue(false));
  el('dueClear').addEventListener('click', () => saveDue(true));
  el('dueInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDue(false);
  });
  el('duePop').querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => quickDate(btn.dataset.quick));
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
    if (e.key === 'Escape') {
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

  // 来自主进程的事件
  window.api.onSkinChanged((skin) => {
    applySkin(skin);
    render();
  });

  window.api.onSettingsChanged((settings) => {
    Object.assign(state.settings, settings);
    syncSettingsUI();
  });

  window.api.onRemindersMarked(({ ids, at }) => {
    state.todos.forEach((t) => {
      if (ids.includes(t.id)) t.remindedAt = at;
    });
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

  bindEvents();
  render();
  syncSettingsUI();

  el('input').focus();

  // 每分钟刷新一次日期与逾期状态，避免窗口常驻时信息过期
  setInterval(() => {
    if (!editingId) render();
  }, 60000);
}

boot();
