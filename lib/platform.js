// dsh-auto-open-web — 平台适配器选择。
//
// 共通逻辑(index.js)只依赖本模块暴露的统一接口,不直接触碰平台差异:
//   isWindows                    平台标识
//   resolveBrowserExe(path)      → {browser, exe} | null
//   ensureBrowserJob()           → job | {handle:null}(降级标记)
//   assignToBrowserJob(job, pid) → boolean
//   killDedicatedBrowserInstances(browser)
//   killProcessTree(pid)
//   pickBrowserExe()             → Promise<string | null>
//   resolveHostExe()             → string | null
//
// Windows 用 win32.js 全量实现;其余平台用 posix.js 降级实现。
// 静态 import 两个实现是安全的:两者顶层均无平台副作用。
import * as win32 from './win32.js';
import * as posix from './posix.js';

const impl = process.platform === 'win32' ? win32 : posix;

export const isWindows = impl.isWindows;
export const resolveBrowserExe = impl.resolveBrowserExe;
export const ensureBrowserJob = impl.ensureBrowserJob;
export const assignToBrowserJob = impl.assignToBrowserJob;
export const killDedicatedBrowserInstances = impl.killDedicatedBrowserInstances;
export const killProcessTree = impl.killProcessTree;
export const pickBrowserExe = impl.pickBrowserExe;
export const resolveHostExe = impl.resolveHostExe;
