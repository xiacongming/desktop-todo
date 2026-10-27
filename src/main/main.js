'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  Notification,
  shell,
  powerMonitor
} = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, SKINS } = require('./store');
const { nextOccurrence, describeRepeat } = require('./recurrence');
const { clampBounds } = require('./windowState');

const ICON_DIR = path.join(__dirname, '../../assets');
const HOTKEY = 'Control+Alt+T';

let store = null;
let win = null;
let tray = null;
let boundsTimer = null;
let reminderTimer = null;
let firstReminderPass = true;

/* ---------------- 单实例 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  const state = store.get();
  const bounds = clampBounds(state.settings.window);

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 280,
    minHeight: 260,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !!state.settings.alwaysOnTop,
    show: false,
    title: 'StickyTodo',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (state.settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
    if (process.env.STICKY_SHOTS) captureSkins(process.env.STICKY_SHOTS);
  });

  // 关闭 = 隐藏到托盘，只有托盘菜单的「退出」才真正结束进程
  win.on('close', (e) => {
    if (!app.__quitting) {
      e.preventDefault();
      win.hide();
      refreshTrayMenu();
    }
  });

  const persistBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const b = win.getBounds();
      const st = store.get();
      st.settings.window = { x: b.x, y: b.y, width: b.width, height: b.height };
      store.save(st);
    }, 400);
  };

  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
  win.on('show', refreshTrayMenu);
  win.on('hide', refreshTrayMenu);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
  refreshTrayMenu();
}

/* ---------------- 托盘 ---------------- */

function trayImage() {
  const p = path.join(ICON_DIR, 'tray.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  return nativeImage.createEmpty();
}

function trayAlertImage() {
  const p = path.join(ICON_DIR, 'tray-alert.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  return trayImage();
}

/**
 * 有提醒到点时让托盘图标闪起来。
 *
 * 为什么不用 flashFrame：窗口是 skipTaskbar，不占任务栏位置，闪任务栏按钮等于没闪。
 * 托盘图标是这个小工具唯一常驻的视觉入口，所以让它动。
 * 最多闪 40 秒就自动停——用户不在电脑前时一直闪只是耗电，通知已经进通知中心了。
 */
const ALERT_FLASH_TICKS = 56;
let alertFlashTimer = null;
let alertFlashStep = 0;

function startTrayAlert() {
  if (!tray || alertFlashTimer) return;
  alertFlashStep = 0;
  try {
    tray.setImage(trayAlertImage());
  } catch (_) {
    return;
  }
  alertFlashTimer = setInterval(() => {
    alertFlashStep += 1;
    if (alertFlashStep >= ALERT_FLASH_TICKS) {
      stopTrayAlert();
      return;
    }
    try {
      tray.setImage(alertFlashStep % 2 ? trayImage() : trayAlertImage());
    } catch (_) {
      stopTrayAlert();
    }
  }, 700);
}

function stopTrayAlert() {
  if (alertFlashTimer) {
    clearInterval(alertFlashTimer);
    alertFlashTimer = null;
  }
  alertFlashStep = 0;
  if (tray) {
    try {
      tray.setImage(trayImage());
    } catch (_) {}
  }
}

function buildTrayMenu() {
  const state = store.get();
  const visible = !!win && win.isVisible();

  return Menu.buildFromTemplate([
    {
      label: visible ? '隐藏便签' : '显示便签',
      click: () => toggleWindow()
    },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: !!(win && win.isAlwaysOnTop()),
      click: (item) => {
        setAlwaysOnTop(item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '皮肤',
      submenu: SKINS.map((s) => ({
        label: SKIN_LABELS[s] || s,
        type: 'radio',
        checked: state.settings.skin === s,
        click: () => applySkin(s)
      }))
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (item) => setAutoLaunch(item.checked)
    },
    {
      label: '数据文件夹',
      click: () => shell.openPath(app.getPath('userData'))
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.__quitting = true;
        app.quit();
      }
    }
  ]);
}

const SKIN_LABELS = {
  paper: '纸感米白',
  glass: '磨砂深色',
  mist: '淡蓝极简',
  sunshine: '暖黄便签',
  noir: '高对比暗黑'
};

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(win && win.isVisible() ? 'StickyTodo · 显示中' : 'StickyTodo');
}

function createTray() {
  tray = new Tray(trayImage());
  refreshTrayMenu();
  tray.on('click', () => toggleWindow());
}

/* ---------------- 设置 ---------------- */

function setAlwaysOnTop(on) {
  if (win) win.setAlwaysOnTop(!!on, 'floating');
  const st = store.get();
  st.settings.alwaysOnTop = !!on;
  store.save(st);
  refreshTrayMenu();
  if (win) win.webContents.send('settings:changed', st.settings);
}

function applySkin(skin) {
  if (!SKINS.includes(skin)) return;
  const st = store.get();
  st.settings.skin = skin;
  store.save(st);
  if (win) win.webContents.send('skin:set', skin);
  refreshTrayMenu();
}

function isAutoLaunchEnabled() {
  if (!app.isPackaged) {
    const st = store.get();
    return !!st.settings.autoLaunch;
  }
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    return false;
  }
}

function setAutoLaunch(on) {
  const st = store.get();
  st.settings.autoLaunch = !!on;
  store.save(st);

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: []
    });
  }
  if (win) win.webContents.send('settings:changed', st.settings);
  refreshTrayMenu();
}

function registerHotkey(enabled) {
  globalShortcut.unregister(HOTKEY);
  if (enabled) {
    try {
      globalShortcut.register(HOTKEY, () => toggleWindow());
    } catch (_) {
      /* 快捷键被占用则忽略 */
    }
  }
}

/* ---------------- 提醒 ---------------- */

function notify(title, body) {
  // 这里原本调了 win.flashFrame(true)，但窗口是 skipTaskbar，任务栏上没有按钮可闪，
  // 属于写了也不生效的死代码。真正的「视觉兜底」交给托盘图标闪烁 + 窗口内横幅。
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    silent: false,
    icon: path.join(ICON_DIR, 'tray.png')
  });
  n.on('click', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
  n.show();
}

function checkReminders() {
  const st = store.get();
  const nowMs = Date.now();

  const due = st.todos.filter((t) => needsReminder(t, nowMs));
  if (!due.length) {
    firstReminderPass = false;
    return;
  }

  if (firstReminderPass && due.length > 1) {
    // 应用没运行期间积压的提醒，合并成一条，避免开机弹一堆
    const head = due.slice(0, 3).map((t) => t.text).join(' · ');
    notify(
      `有 ${due.length} 项待办已到期`,
      due.length > 3 ? `${head} 等` : head
    );
  } else {
    due.forEach((t) => {
      const when = formatDue(t.dueAt);
      if (t.repeat) {
        notify('提醒：' + t.text, `${describeRepeat(t.repeat, t.dueAt) || when}`);
      } else {
        notify('待办到期：' + t.text, when);
      }
    });
  }

  firstReminderPass = false;

  // 推进到下一次：重复项把 dueAt 前移到未来，单次项打 remindedAt 标记。
  // 这一步必须在 notify 之后做，否则文案里就取不到「原定触发时间」了。
  const at = new Date(nowMs).toISOString();
  const items = [];
  let skippedTotal = 0;

  due.forEach((t) => {
    t.firedAt = at;
    let skipped = 0;

    if (t.repeat) {
      const next = nextOccurrence(t.dueAt, t.repeat, new Date(nowMs));
      if (next) {
        t.dueAt = next.at;
        skipped = next.skipped;
      } else {
        // 规则算不出下一次（脏数据），退化为单次提醒，别让它变成僵尸闹钟
        t.repeat = null;
        t.remindedAt = at;
      }
    } else {
      t.remindedAt = at;
    }

    skippedTotal += skipped;
    items.push({
      id: t.id,
      dueAt: t.dueAt,
      repeat: t.repeat,
      remindedAt: t.remindedAt,
      firedAt: t.firedAt,
      skipped
    });
  });

  store.save(st);

  if (skippedTotal > 0) {
    notify('已跳过多余提醒', `应用没运行时错过了 ${skippedTotal} 次重复提醒，之后按原计划继续。`);
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('reminders:fired', { items, at });
    if (win.isVisible()) {
      win.webContents.send('reminders:pulse', { ids: due.map((t) => t.id) });
    }
  }

  // 视觉兜底：托盘图标闪起来，配合窗口内横幅，直到用户点「知道了」
  startTrayAlert();
}

/**
 * 是否需要提醒。
 * - 重复项：dueAt 触发后立刻前移，所以「dueAt <= now」本身就是幂等条件，
 *   不能再叠加 remindedAt 判断（那会让重复提醒只响一次）。
 * - 单次项：保持 v1 行为，提醒过就不再响，直到用户改了时间。
 */
function needsReminder(t, nowMs) {
  if (t.done || !t.dueAt) return false;
  const at = new Date(t.dueAt).getTime();
  if (isNaN(at) || at > nowMs) return false;
  if (t.repeat) return true;
  return !t.remindedAt;
}

function formatDue(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- IPC ---------------- */

function setupIpc() {
  ipcMain.handle('app:load', () => ({
    state: store.get(),
    loadError: store.loadError,
    autostart: isAutoLaunchEnabled(),
    hotkey: HOTKEY,
    packaged: app.isPackaged,
    version: app.getVersion(),
    dataDir: app.getPath('userData')
  }));

  ipcMain.on('state:save', (_e, next) => {
    // 窗口位置只有主进程说了算：渲染进程发来的 settings.window 可能是拖动前的旧值，
    // 直接用它会把手动拖好的位置覆盖回去。
    const prev = store.get();
    if (next && next.settings && prev.settings) {
      next.settings.window = prev.settings.window;
    }

    // 重复提醒的 dueAt 由主进程单方面向前推进。渲染进程手里可能还握着推进前的旧值，
    // 若直接落盘会把提醒拨回过去，下一轮轮询就会重复弹同一条通知。
    if (next && Array.isArray(next.todos)) {
      const prevMap = new Map(prev.todos.map((t) => [t.id, t]));
      next.todos.forEach((t) => {
        const p = prevMap.get(t.id);
        if (!p || !p.repeat || !p.dueAt || !t.dueAt) return;
        if (new Date(t.dueAt).getTime() < new Date(p.dueAt).getTime()) {
          t.dueAt = p.dueAt;
          if (!t.repeat) t.repeat = p.repeat;
        }
      });
    }

    store.save(next);
    // 新增/修改截止时间后尽早检查一次，不必等下一个轮询周期
    setTimeout(checkReminders, 300);
  });

  ipcMain.handle('win:always-on-top', (_e, on) => {
    setAlwaysOnTop(on);
    return !!(win && win.isAlwaysOnTop());
  });

  ipcMain.on('win:hide', () => {
    if (win) win.hide();
    refreshTrayMenu();
  });

  ipcMain.on('app:quit', () => {
    app.__quitting = true;
    app.quit();
  });

  // 用户在窗口里点掉横幅后，停止托盘闪烁
  ipcMain.on('reminders:ack', () => {
    stopTrayAlert();
  });

  ipcMain.handle('app:autostart', (_e, on) => {
    setAutoLaunch(on);
    return isAutoLaunchEnabled();
  });

  ipcMain.handle('app:hotkey', (_e, on) => {
    const st = store.get();
    st.settings.globalHotkey = !!on;
    store.save(st);
    registerHotkey(!!on);
    return !!on;
  });

  ipcMain.handle('app:skin', (_e, skin) => {
    applySkin(skin);
    return skin;
  });

  ipcMain.handle('app:open-data-dir', () => {
    shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle('notify', (_e, payload) => {
    if (payload && payload.title) notify(payload.title, payload.body || '');
  });
}

/* ---------------- 设计预览（仅开发用） ---------------- */

/**
 * STICKY_SHOTS=<目录> 启动时，依次切换 5 套皮肤并导出真实窗口截图。
 * 用完即退出，不影响正常使用。
 */
async function captureSkins(dir) {
  const { SKINS: list } = require('./store');
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 520));
    const img = await win.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    await new Promise((r) => setTimeout(r, 1200));
    for (const skin of list) {
      win.webContents.send('skin:set', skin);
      await shot(`skin-${skin}`);
    }

    // 交互态：搜索条、重复提醒浮层。这两块只有真的打开才看得到问题。
    win.webContents.send('skin:set', 'paper');
    await new Promise((r) => setTimeout(r, 400));

    await win.webContents.executeJavaScript(`
      (() => {
        document.getElementById('btnSearch').click();
        const i = document.getElementById('searchInput');
        i.value = '账号';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })();
    `);
    await shot('state-search');

    await win.webContents.executeJavaScript(`
      (() => {
        closeSearch();
        const btn = document.querySelector('.row [data-act="due"]');
        if (btn) btn.click();
        const wk = document.querySelector('[data-repeat="weekly"]');
        if (wk) wk.click();
      })();
    `);
    await shot('state-repeat');

    // 到点横幅：直接调渲染层的 showAlarm，和真实触发走同一条路径
    await win.webContents.executeJavaScript(`
      (() => {
        // 关掉提醒浮层
        if (typeof closePops === 'function') closePops();
        const list = (typeof state !== 'undefined' && state.todos) || [];
        const t = list.find((x) => !x.done);
        if (t && typeof showAlarm === 'function') {
          showAlarm([{ id: t.id, dueAt: new Date().toISOString() }]);
        }
        render();
      })();
    `);
    await shot('state-alarm');

    // 深色皮肤下再验一次横幅对比度
    win.webContents.send('skin:set', 'noir');
    await new Promise((r) => setTimeout(r, 520));
    await shot('state-alarm-dark');
  } catch (err) {
    console.error('capture failed:', err.message);
  }
  app.__quitting = true;
  app.quit();
}

/* ---------------- 生命周期 ---------------- */

app.whenReady().then(() => {
  app.setAppUserModelId('com.qijian.stickytodo');

  store = new Store(app.getPath('userData'));
  store.load();

  setupIpc();
  createWindow();
  createTray();

  const st = store.get();
  if (app.isPackaged) setAutoLaunch(!!st.settings.autoLaunch);
  registerHotkey(st.settings.globalHotkey !== false);

  // 启动后补发错过/刚到期的提醒
  setTimeout(checkReminders, 2500);
  reminderTimer = setInterval(checkReminders, 20000);

  // 睡眠期间 setInterval 不累计，唤醒后立刻补一轮，不必等下一个 20 秒
  powerMonitor.on('resume', () => {
    setTimeout(checkReminders, 1200);
  });

  app.on('activate', () => {
    if (!win) createWindow();
    else {
      win.show();
      win.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // 常驻托盘，不随窗口关闭退出
});

app.on('before-quit', () => {
  app.__quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (reminderTimer) clearInterval(reminderTimer);
  if (alertFlashTimer) clearInterval(alertFlashTimer);
});
