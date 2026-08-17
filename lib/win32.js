// dsh-auto-open-web — Windows 平台适配器。
//
// 本文件集中全部 win32 专属实现(共通逻辑见 index.js):
//   - 浏览器可执行文件候选(ProgramFiles 布局)
//   - Job Object(koffi 驱动,DSH 强退也随进程退出)
//   - 专用实例进程树清理(pid 状态文件 + 进程身份校验 + taskkill,
//     不使用 PowerShell)
//   - 进程树终止(taskkill,供测试实例自动清理)
//   - 原生文件对话框(worker.cjs 子进程 + koffi IFileOpenDialog)
//   - WebView2 宿主可执行文件解析(host-publish/DshAppWindow.exe)
//
// 平台选择由 platform.js 完成;本文件顶层无平台副作用,非 Windows 上
// 静态 import 也安全,各函数在 process.platform !== 'win32' 时自行降级。
//
// koffi 依赖策略:本包**不声明任何 koffi 依赖**(鸿蒙等无 koffi 的环境
// 因此安装零拦截),koffi 由 DSH 部署自带(官方原生选择器
// @deepseek-ai/dsh-host-directory-picker-native 依赖 koffi),运行时经
// getKoffi() 解析:常规解析(profile 已装/手动安装)优先,其次 Windows
// 全局 npm 布局下的 DSH 部署副本;解析失败仅降级(Job Object 不可用、
// 进程校验跳过、对话框不可用),不崩溃。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instanceStateFile } from './paths.js';

export const isWindows = process.platform === 'win32';

/**
 * 解析 koffi(异步):常规 import → Windows 全局 npm 布局的 DSH 部署副本。
 * 返回 koffi 模块对象(含 .default 时返回 .default),失败返回 null。
 */
async function getKoffi() {
  try {
    const mod = await import('koffi');
    return mod && mod.default !== undefined ? mod.default : mod;
  } catch {
    /* 常规解析失败,尝试部署副本 */
  }
  try {
    const globalRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : '';
    const dshEntry = join(globalRoot, '@deepseek-ai', 'dsh', 'package.json');
    if (existsSync(dshEntry)) {
      const koffi = createRequire(dshEntry)('koffi');
      if (koffi !== null && koffi !== undefined) return koffi;
    }
  } catch {
    /* 部署解析失败 */
  }
  console.warn('[auto-open-web] koffi not found (neither local nor DSH deployment); win32 capabilities degraded');
  return null;
}

// koffi 在模块求值时预载(ESM 顶层 await):后续所有函数——包括
// process 'exit' 处理器——都能同步使用,无需异步 import。
// 加载失败不致命:进程身份校验降级为保守跳过(见 verifyInstancePid)。
let koffiLib = null;
let procApi = null;
try {
  koffiLib = await getKoffi();
  if (koffiLib !== null) {
    const kernel32 = koffiLib.load('kernel32.dll');
    const psapi = koffiLib.load('psapi.dll');
    procApi = {
      openProcess: kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']),
      getImageName: psapi.func('__stdcall', 'GetProcessImageFileNameW', 'uint32', ['void *', 'void *', 'uint32']),
      getProcessTimes: kernel32.func('__stdcall', 'GetProcessTimes', 'int', ['void *', 'void *', 'void *', 'void *', 'void *']),
      closeHandle: kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']),
      fileTime: koffiLib.struct('DshFileTime', { dwLowDateTime: 'uint32', dwHighDateTime: 'uint32' }),
    };
  }
} catch {
  procApi = null;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const FILE_TIME_MS = 10000; // 100ns 单位 → 毫秒
const FILETIME_UNIX_EPOCH_MS = 11644473600000; // 1601-01-01 → 1970-01-01 的毫秒差

// ── 浏览器可执行文件候选(仅 Windows 的安装布局) ──────────────────────────

const BROWSER_EXE_CANDIDATES = [
  {
    browser: 'edge',
    candidates: [
      join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(process.env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
  },
  {
    browser: 'chrome',
    candidates: [
      join(process.env.ProgramFiles ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['ProgramFiles(x86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  },
];

/**
 * 解析浏览器可执行文件(仅 Windows):手动路径(browserPath)优先,
 * 其次内置候选(Edge → Chrome)。手动路径不存在时记录并跳过。
 */
export function resolveBrowserExe(browserPath) {
  if (process.platform !== 'win32') return null;
  const p = typeof browserPath === 'string' ? browserPath.trim() : '';
  if (p !== '') {
    if (existsSync(p)) return { browser: 'custom', exe: p };
    console.warn(`[auto-open-web] configured browser path not found, skipping: ${p}`);
  }
  for (const entry of BROWSER_EXE_CANDIDATES) {
    const exe = entry.candidates.find((p) => p !== '' && existsSync(p));
    if (exe !== undefined) return { browser: entry.browser, exe };
  }
  return null;
}

// ── browser 专用实例的 Job Object(DSH 强退也随进程退出) ──────────────────
//
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE:当作业的最后一个句柄关闭(即持有它的
// DSH 进程退出——无论正常退出还是被强杀)时,Windows 内核自动结束作业内
// 所有进程。子进程自动继承作业成员资格,因此只需把启动的 msedge 进程加入
// 作业,其整个实例进程树就随 DSH 一起消亡,不依赖 exit 事件。
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;

/** { handle, openProc, closeHandle, assign } | { handle: null }(创建失败时的降级标记)。 */
let browserJob = null;

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION(x64) 的 koffi 结构定义。koffi 的 struct
// 名是全局注册的,重复定义同名 struct 会报错,因此只建一次。
// 布局(实测 sizeof = 144 字节):LimitFlags 位于偏移 16(BasicLimitInformation
// 内),即本结构第 3 个字段。flat 字段顺序与 Windows 定义一致时偏移自然对齐。
let jobExtType = null;

export async function ensureBrowserJob() {
  if (browserJob !== null) return browserJob;
  try {
    const koffi = await getKoffi();
    if (koffi === null) throw new Error('koffi unavailable');
    const kernel32 = koffi.load('kernel32.dll');
    const createJob = kernel32.func('__stdcall', 'CreateJobObjectW', 'void *', ['void *', 'void *']);
    const setInfo = kernel32.func('__stdcall', 'SetInformationJobObject', 'int', ['void *', 'uint32', 'void *', 'uint32']);
    const assign = kernel32.func('__stdcall', 'AssignProcessToJobObject', 'int', ['void *', 'void *']);
    const openProc = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
    const closeHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']);
    const job = createJob(null, null);
    if (job === null || job === 0) throw new Error('CreateJobObjectW failed');
    if (jobExtType === null) {
      jobExtType = koffi.struct('JobObjectExtendedLimitInformation', {
        PerProcessUserTimeLimit: 'int64',
        PerJobUserTimeLimit: 'int64',
        LimitFlags: 'uint32',
        MinimumWorkingSetSize: 'int64',
        MaximumWorkingSetSize: 'int64',
        ActiveProcessLimit: 'uint32',
        Affinity: 'int64',
        PriorityClass: 'uint32',
        SchedulingClass: 'uint32',
        IoReadOperationCount: 'int64',
        IoWriteOperationCount: 'int64',
        IoOtherOperationCount: 'int64',
        IoReadTransferCount: 'int64',
        IoWriteTransferCount: 'int64',
        IoOtherTransferCount: 'int64',
        ProcessMemoryLimit: 'int64',
        JobMemoryLimit: 'int64',
        PeakProcessMemoryUsed: 'int64',
        PeakJobMemoryUsed: 'int64',
      });
    }
    // koffi.decode 对结构体是值拷贝:必须用 koffi.encode 写入内存。
    // 只设置 LimitFlags 一个字段,其余保持零值(不施加其他作业限制)。
    const mem = koffi.alloc(jobExtType, koffi.sizeof(jobExtType));
    koffi.encode(mem, jobExtType, { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE });
    if (setInfo(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, mem, koffi.sizeof(jobExtType)) === 0) {
      closeHandle(job);
      throw new Error('SetInformationJobObject failed');
    }
    browserJob = { handle: job, openProc, closeHandle, assign };
    console.log('[auto-open-web] browser job object ready (KILL_ON_JOB_CLOSE)');
    return browserJob;
  } catch (error) {
    console.error(`[auto-open-web] job object unavailable: ${error.message}; falling back to exit/pre-launch cleanup`);
    browserJob = { handle: null };
    return browserJob;
  }
}

/** 把 pid 加入浏览器作业;失败返回 false(不致命,exit/预清理仍兜底)。 */
export function assignToBrowserJob(job, pid) {
  if (job === null || job.handle === null) return false;
  try {
    const h = job.openProc(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
    if (h === null || h === 0) return false;
    try {
      return job.assign(job.handle, h) !== 0;
    } finally {
      job.closeHandle(h);
    }
  } catch {
    return false;
  }
}

// ── 专用实例清理与进程树终止 ─────────────────────────────────────────────

/**
 * 校验 pid 状态文件指向的进程是否仍是我们的专用实例(防 pid 复用误杀):
 *   - 进程必须存在(不存在 → 'gone');
 *   - 镜像文件名必须与记录一致(被复用为其他进程 → 'mismatch');
 *   - 进程创建时间必须早于状态文件写入时间(被复用的新进程必然更晚
 *     → 'mismatch')。
 * 返回 'match' | 'gone' | 'mismatch'。koffi 不可用时保守返回 'mismatch'
 * (不杀,安全优先)。
 */
function verifyInstancePid(pid, state) {
  if (procApi === null) {
    console.warn('[auto-open-web] process verification unavailable; skipping instance cleanup');
    return 'mismatch';
  }
  const h = procApi.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (h === null || h === 0) return 'gone';
  try {
    const buf = koffiLib.alloc('uint16', 1024);
    const len = procApi.getImageName(h, buf, 1024);
    if (len === 0) return 'gone';
    const image = koffiLib.decode(buf, 'char16', len);
    const expected = typeof state.exe === 'string' && state.exe !== '' ? basename(state.exe).toLowerCase() : '';
    if (expected !== '' && basename(image).toLowerCase() !== expected) return 'mismatch';
    // 创建时间(100ns FILETIME)→ 毫秒;须早于状态文件写入时间(容差 5 秒)。
    // 注意:koffi 3.x 无 koffi.offset,用 4 个独立分配的结构指针(alloc 的
    // count 是元素数,1 = 单个 FILETIME)。
    const creationFt = koffiLib.alloc(procApi.fileTime, 1);
    const exitFt = koffiLib.alloc(procApi.fileTime, 1);
    const kernelFt = koffiLib.alloc(procApi.fileTime, 1);
    const userFt = koffiLib.alloc(procApi.fileTime, 1);
    if (procApi.getProcessTimes(h, creationFt, exitFt, kernelFt, userFt) === 0) return 'mismatch';
    const creation = koffiLib.decode(creationFt, procApi.fileTime);
    const createdMs =
      (Number(creation.dwHighDateTime) * 4294967296 + Number(creation.dwLowDateTime)) / FILE_TIME_MS -
      FILETIME_UNIX_EPOCH_MS;
    if (typeof state.writtenAt === 'number' && createdMs > state.writtenAt + 5000) return 'mismatch';
    return 'match';
  } catch {
    return 'mismatch';
  } finally {
    procApi.closeHandle(h);
  }
}

/**
 * 结束指定浏览器类型的专用实例进程树(仅我们自己的专用实例,不影响正常
 * 浏览器页面)。基于 pid 状态文件 + 进程身份校验(见 verifyInstancePid),
 * 不使用 PowerShell。同步执行,可在 process 'exit' 处理器中使用。
 * 进程已不存在时顺带删除状态文件(下次不再处理)。
 */
export function killDedicatedBrowserInstances(browser) {
  if (process.platform !== 'win32') return;
  const statePath = instanceStateFile(browser);
  let state = null;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return; // 无状态文件/损坏 → 无记录可清理
  }
  const pid = state !== null && typeof state === 'object' ? state.pid : 0;
  if (!Number.isInteger(pid) || pid <= 0) return;
  const verdict = verifyInstancePid(pid, state);
  if (verdict === 'gone') {
    try {
      rmSync(statePath, { force: true });
    } catch {
      /* ignore */
    }
    return;
  }
  if (verdict !== 'match') return; // 校验不过:pid 已被复用或无法确认,不误杀
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15000,
    });
  } catch (error) {
    console.error(`[auto-open-web] dedicated instance cleanup failed: ${error.message}`);
  }
}

/** 结束 pid 的整个进程树(同步,可在定时清理中使用)。 */
export function killProcessTree(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15000,
    });
  } catch {
    /* ignore */
  }
}

// ── 原生文件对话框(仅 Windows) ───────────────────────────────────────────

/**
 * 弹出原生"打开文件"对话框选择浏览器可执行文件(仅 Windows)。
 * 实现参考官方工作区目录选择器(@deepseek-ai/dsh-host-directory-picker-native):
 * 生成子进程(worker.cjs)用 koffi 驱动 IFileOpenDialog(文件模式),
 * 对话框是子进程的第一个窗口,Windows 自动激活 → 总是出现在浏览器上方。
 * IPC 协议:{showing} → {done,path|null} | {error,message}。
 * 返回选中路径,取消/失败返回 null;10 分钟无结果则终止子进程。
 */
export function pickBrowserExe() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    const workerPath = fileURLToPath(new URL('./worker.cjs', import.meta.url));
    let child;
    try {
      child = spawn(process.execPath, [workerPath], {
        env: { ...process.env, DSH_DIALOG_TITLE: '选择浏览器可执行文件' },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
      });
    } catch (error) {
      console.error(`[auto-open-web] native picker spawn failed: ${error.message}`);
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, 10 * 60 * 1000);
    child.on('message', (message) => {
      if (message === null || typeof message !== 'object') return;
      if (message.kind === 'done') {
        clearTimeout(timer);
        finish(typeof message.path === 'string' && message.path !== '' ? message.path : null);
      } else if (message.kind === 'error') {
        clearTimeout(timer);
        console.error('[auto-open-web] native picker failed: ' + String(message.message ?? 'unknown error'));
        finish(null);
      }
      /* 'showing' 仅用于中止通道,本实现超时即杀子进程,无需跟踪 */
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      console.error(`[auto-open-web] native picker process error: ${error.message}`);
      finish(null);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}

// ── WebView2 宿主可执行文件(仅 Windows) ──────────────────────────────────

/** 解析随包分发的宿主可执行文件(仅 Windows)。 */
export function resolveHostExe() {
  if (process.platform !== 'win32') return null;
  const exe = fileURLToPath(new URL('../host-publish/DshAppWindow.exe', import.meta.url));
  return existsSync(exe) ? exe : null;
}
