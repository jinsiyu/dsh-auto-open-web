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
// 按平台**条件加载**适配器(ESM 顶层 await):
//   - Windows:加载 win32.js(koffi 驱动 Job Object / 进程校验 / 原生对话框)
//   - 其他平台(含鸿蒙等无 koffi 预编译的环境):加载 posix.js 降级实现,
//     完全不求值 win32.js——koffi 仅 Windows 需要(optionalDependencies),
//     posix 平台不安装、不加载、不依赖。
const impl = process.platform === 'win32' ? await import('./win32.js') : await import('./posix.js');

export const isWindows = impl.isWindows;
export const resolveBrowserExe = impl.resolveBrowserExe;
export const ensureBrowserJob = impl.ensureBrowserJob;
export const assignToBrowserJob = impl.assignToBrowserJob;
export const killDedicatedBrowserInstances = impl.killDedicatedBrowserInstances;
export const killProcessTree = impl.killProcessTree;
export const pickBrowserExe = impl.pickBrowserExe;
export const resolveHostExe = impl.resolveHostExe;
