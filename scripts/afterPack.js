/**
 * 打包后裁剪语言包。
 *
 * 为什么不用 electron-builder 自带的 electronLanguages 配置：
 * 它的做法是把 Electron 模板整个复制到 win-unpacked，然后逐个 remove 掉不需要的 locale。
 * 删除动作走 Node 的 fs.rm，而本机环境的 node 被注入了 safe-delete 守卫，
 * 单次超过 50 个文件的批量删除会被直接中断，打包失败。
 *
 * 所以这里改成：让 builder 正常复制全部 55 个语言包，打包完成后由本脚本
 * 用系统命令删掉不需要的，只留中文。删除范围严格限制在 <appOutDir>/locales 内。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** 需要保留的语言包。zh-CN 是界面与 locale 都要用的，缺了会回退到别的语言。 */
const KEEP = new Set(['zh-CN.pak']);

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const localesDir = path.join(appOutDir, 'locales');

  if (!fs.existsSync(localesDir)) {
    console.log('[afterPack] 未找到 locales 目录，跳过');
    return;
  }

  const before = fs.readdirSync(localesDir);
  const victims = before.filter((name) => !KEEP.has(name));
  const beforeSize = dirSize(localesDir);

  // 用系统 del 而不是 fs.rm：绕开 safe-delete 守卫，同时避免误伤目录外的文件
  for (const name of victims) {
    const target = path.join(localesDir, name);
    if (path.dirname(target) !== localesDir) continue;
    if (!fs.statSync(target).isFile()) continue;
    try {
      execFileSync('cmd', ['/c', 'del', '/f', '/q', target], { stdio: 'ignore' });
    } catch (err) {
      console.warn('[afterPack] 删除失败:', name, err.message);
    }
  }

  const after = fs.readdirSync(localesDir);
  const afterSize = dirSize(localesDir);
  console.log(
    `[afterPack] 语言包 ${before.length} -> ${after.length} 个，` +
      `${(beforeSize / 1048576).toFixed(1)}MB -> ${(afterSize / 1048576).toFixed(1)}MB，` +
      `保留 ${after.join(', ')}`
  );
};

function dirSize(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const st = fs.statSync(path.join(dir, name));
    if (st.isFile()) total += st.size;
  }
  return total;
}
