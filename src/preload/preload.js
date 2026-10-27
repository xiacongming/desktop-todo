'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染进程唯一可用的能力集合。
 * 只暴露白名单方法，不把 ipcRenderer 本身交出去。
 */
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('app:load'),

  saveState: (state) => ipcRenderer.send('state:save', state),

  setAlwaysOnTop: (on) => ipcRenderer.invoke('win:always-on-top', on),

  hide: () => ipcRenderer.send('win:hide'),

  quit: () => ipcRenderer.send('app:quit'),

  setAutoLaunch: (on) => ipcRenderer.invoke('app:autostart', on),

  setHotkey: (on) => ipcRenderer.invoke('app:hotkey', on),

  setSkin: (skin) => ipcRenderer.invoke('app:skin', skin),

  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),

  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  onSkinChanged: (cb) => {
    ipcRenderer.on('skin:set', (_e, skin) => cb(skin));
  },

  onSettingsChanged: (cb) => {
    ipcRenderer.on('settings:changed', (_e, settings) => cb(settings));
  },

  onRemindersMarked: (cb) => {
    ipcRenderer.on('reminders:marked', (_e, payload) => cb(payload));
  },

  onRemindersPulse: (cb) => {
    ipcRenderer.on('reminders:pulse', (_e, payload) => cb(payload));
  }
});
