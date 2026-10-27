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
  shell
} = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, SKINS } = require('./store');
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
  win.on('focus', () => {
    try {
      win.flashFrame(false);
    } catch (_) {}
  });
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
  // 开发模式下 Windows 通知常因缺少已注册的 AUMID 而不弹，
  // 所以同时闪一下窗口边框兜底，保证提醒一定被看见。
  if (win && win.isVisible()) {
    try {
      win.flashFrame(true);
    } catch (_) {}
  }

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

function markReminded(ids) {
  const st = store.get();
  const now = new Date().toISOString();
  let changed = false;
  st.todos.forEach((t) => {
    if (ids.includes(t.id)) {
      t.remindedAt = now;
      changed = true;
    }
  });
  if (changed) {
    store.save(st);
    if (win) win.webContents.send('reminders:marked', { ids, at: now });
  }
}

function checkReminders() {
  const st = store.get();
  const now = Date.now();

  const due = st.todos.filter(
    (t) => !t.done && t.dueAt && !t.remindedAt && new Date(t.dueAt).getTime() <= now
  );
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
      notify('待办到期：' + t.text, t.dueAt ? formatDue(t.dueAt) : '');
    });
  }

  firstReminderPass = false;
  markReminded(due.map((t) => t.id));

  if (win && win.isVisible()) {
    win.webContents.send('reminders:pulse', { ids: due.map((t) => t.id) });
  }
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
    dataDir: app.getPath('userData')
  }));

  ipcMain.on('state:save', (_e, next) => {
    // 窗口位置只有主进程说了算：渲染进程发来的 settings.window 可能是拖动前的旧值，
    // 直接用它会把手动拖好的位置覆盖回去。
    const prev = store.get();
    if (next && next.settings && prev.settings) {
      next.settings.window = prev.settings.window;
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
  try {
    fs.mkdirSync(dir, { recursive: true });
    await new Promise((r) => setTimeout(r, 1200));
    for (const skin of list) {
      win.webContents.send('skin:set', skin);
      await new Promise((r) => setTimeout(r, 520));
      const img = await win.capturePage();
      fs.writeFileSync(path.join(dir, `skin-${skin}.png`), img.toPNG());
      console.log('shot', skin, img.getSize());
    }
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
});
