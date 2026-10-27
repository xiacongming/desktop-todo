'use strict';

const { screen } = require('electron');

const MIN_W = 280;
const MIN_H = 260;

/**
 * 校验窗口位置是否还落在某块屏幕的可见范围内。
 * 副屏被拔掉、分辨率变化后，窗口不能跑到屏幕外。
 */
function clampBounds(saved) {
  const primary = screen.getPrimaryDisplay();
  const pw = primary.workArea;

  let width = saved && Number.isFinite(saved.width) ? saved.width : 340;
  let height = saved && Number.isFinite(saved.height) ? saved.height : 470;
  width = Math.max(MIN_W, Math.min(width, pw.width));
  height = Math.max(MIN_H, Math.min(height, pw.height));

  const hasPos = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  if (!hasPos) {
    return {
      width,
      height,
      x: Math.round(pw.x + pw.width - width - 40),
      y: Math.round(pw.y + 60)
    };
  }

  // 是否有足够面积落在某块屏幕内
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const overlapX = Math.min(saved.x + width, a.x + a.width) - Math.max(saved.x, a.x);
    const overlapY = Math.min(saved.y + height, a.y + a.height) - Math.max(saved.y, a.y);
    return overlapX > 80 && overlapY > 60;
  });

  if (!visible) {
    return {
      width,
      height,
      x: Math.round(pw.x + pw.width - width - 40),
      y: Math.round(pw.y + 60)
    };
  }

  return { width, height, x: Math.round(saved.x), y: Math.round(saved.y) };
}

module.exports = { clampBounds, MIN_W, MIN_H };
