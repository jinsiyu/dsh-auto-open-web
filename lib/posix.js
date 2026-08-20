// dsh-auto-open-web — 非 Windows 平台适配器(降级/尽力而为实现)。
//
// 与 win32.js 保持同一接口(platform.js 按 process.platform 选择):
//   - 浏览器候选:无(返回 null,调用方记日志不打开)
//   - Job Object:不可用({handle:null} 降级,退出/预清理兜底)
//   - 专用实例清理:无操作(Unix 下浏览器实例由 Job-less 方式管理,暂无实现)
//   - 进程树终止:尽力而为(SIGKILL 单进程,后代进程不保证)
//   - 原生文件对话框:不支持(返回 null,卡片提示手动输入)
//   - WebView2 宿主:无(返回 null,webview2 模式降级到最后兜底)
//   - 默认浏览器打开:原生拉起(darwin: open;linux: xdg-open)
import { spawn } from 'node:child_process';

export const isWindows = false;

export function resolveBrowserExe() {
  return null;
}

export async function ensureBrowserJob() {
  return { handle: null };
}

export function assignToBrowserJob() {
  return false;
}

export function killDedicatedBrowserInstances() {
  /* 无操作:Unix 暂无专用实例清理实现 */
}

export function killProcessTree(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
}

export function pickBrowserExe() {
  return Promise.resolve(null);
}

export function resolveHostExe() {
  return null;
}

/**
 * 原生默认浏览器打开(最后兜底,open 包不可用时):darwin 用 open,其余
 * 平台用 xdg-open。detached + stdio ignore,不阻塞 DSH;启动失败返回 false。
 */
export function openDefaultBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
    child.unref();
  });
}
