'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULT_STATE = () => ({
  version: 1,
  settings: {
    alwaysOnTop: true,
    skin: 'paper',
    autoLaunch: false,
    globalHotkey: true,
    collapseDone: true,
    window: { x: null, y: null, width: 340, height: 470 }
  },
  todos: []
});

const SKINS = ['paper', 'glass', 'mist', 'sunshine', 'noir'];

function uid() {
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  );
}

function normalizeTodo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!text.trim()) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    text: text.slice(0, 500),
    done: !!raw.done,
    pinned: !!raw.pinned && !raw.done,
    order: Number.isFinite(raw.order) ? raw.order : 1024,
    dueAt: typeof raw.dueAt === 'string' ? raw.dueAt : null,
    remindedAt: typeof raw.remindedAt === 'string' ? raw.remindedAt : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null
  };
}

function normalizeState(raw) {
  const base = DEFAULT_STATE();
  if (!raw || typeof raw !== 'object') return base;

  const settings = Object.assign({}, base.settings, raw.settings || {});
  settings.alwaysOnTop = !!settings.alwaysOnTop;
  settings.autoLaunch = !!settings.autoLaunch;
  settings.globalHotkey = settings.globalHotkey !== false;
  settings.collapseDone = settings.collapseDone !== false;
  if (!SKINS.includes(settings.skin)) settings.skin = 'paper';

  const w = settings.window || {};
  settings.window = {
    x: Number.isFinite(w.x) ? w.x : null,
    y: Number.isFinite(w.y) ? w.y : null,
    width: Number.isFinite(w.width) ? Math.max(280, Math.min(900, w.width)) : 340,
    height: Number.isFinite(w.height) ? Math.max(260, Math.min(1200, w.height)) : 470
  };

  const todos = Array.isArray(raw.todos)
    ? raw.todos.map(normalizeTodo).filter(Boolean)
    : [];

  return { version: 1, settings, todos };
}

class Store {
  /**
   * @param {string} dir 数据目录
   */
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'todos.json');
    this.bak = path.join(dir, 'todos.bak.json');
    this.state = DEFAULT_STATE();
    this.loadError = null;
    this._queue = Promise.resolve();
  }

  /** 同步读取，启动阶段调用，失败要能降级 */
  load() {
    const tryRead = (p) => {
      const text = fs.readFileSync(p, 'utf8');
      return normalizeState(JSON.parse(text));
    };

    try {
      this.state = tryRead(this.file);
      this.loadError = null;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        this.state = DEFAULT_STATE();
        this.loadError = null;
      } else {
        try {
          this.state = tryRead(this.bak);
          this.loadError = '主数据文件损坏，已从备份恢复。';
        } catch (err2) {
          this.state = DEFAULT_STATE();
          this.loadError = '数据文件与备份均无法读取，已从空白开始（原文件未删除）。';
        }
      }
    }
    return this.state;
  }

  get() {
    return this.state;
  }

  /**
   * 原子写入：tmp + fsync + rename，写入前留一份备份。
   * 串行化，避免并发写互相覆盖。
   */
  save(next) {
    const normalized = normalizeState(next);
    this.state = normalized;
    this._queue = this._queue.then(() => this._writeAtomic(normalized)).catch(() => {});
    return this._queue;
  }

  async _writeAtomic(state) {
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    const data = JSON.stringify(state, null, 2);

    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }

    try {
      await fsp.copyFile(this.file, this.bak);
    } catch (_) {
      /* 首次写入没有旧文件，忽略 */
    }

    await fsp.rename(tmp, this.file);
  }
}

module.exports = { Store, normalizeState, normalizeTodo, DEFAULT_STATE, SKINS, uid };
