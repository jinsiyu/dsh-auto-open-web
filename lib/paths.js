// dsh-auto-open-web — 数据目录与 profile 路径(跨平台共通,零平台依赖)。
import { join } from 'node:path';
import os from 'node:os';

/** DSH 数据目录:DSH_HOME 优先,否则 ~/.dsh。 */
export function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(os.homedir(), '.dsh');
}

/** 专用浏览器实例的 user-data-dir(按浏览器区分,不与其他页面共用进程/存储)。 */
export function appProfileDir(browser) {
  return join(dshHome(), browser === 'chrome' ? 'chrome-app-profile' : 'edge-app-profile');
}

/** 测试专用实例的 user-data-dir:独立于正式实例,测试不污染、正式预清理不误杀。 */
export function testProfileDir(browser) {
  return join(dshHome(), (browser === 'chrome' ? 'chrome' : 'edge') + '-test-profile');
}

/**
 * 专用实例 pid 状态文件:记录 {pid, exe, writtenAt},供平台清理时校验
 * (进程身份 + 创建时间,防 pid 复用误杀)。custom 浏览器与 edge 共用
 * edge-app-profile 目录,状态文件同样归入 edge。
 */
export function instanceStateFile(browser) {
  return join(dshHome(), (browser === 'chrome' ? 'chrome' : 'edge') + '-app-profile.json');
}
