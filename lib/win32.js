// dsh-auto-open-web — Windows 平台适配器。
//
// 本文件集中全部 win32 专属实现(共通逻辑见 index.js):
//   - 浏览器可执行文件候选(ProgramFiles 布局)
//   - Job Object(koffi 驱动,DSH 强退也随进程退出)
//   - 专用实例进程树清理(PowerShell CIM + taskkill)
//   - 进程树终止(taskkill,供测试实例自动清理)
//   - 原生文件对话框(worker.cjs 子进程 + koffi IFileOpenDialog)
//   - WebView2 宿主可执行文件解析(host-publish/DshAppWindow.exe)
//
// 平台选择由 platform.js 完成;本文件顶层无平台副作用,非 Windows 上
// 静态 import 也安全,各函数在 process.platform !== 'win32' 时自行降级。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appProfileDir } from './paths.js';

export const isWindows = process.platform === 'win32';

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
    const koffi = (await import('koffi')).default;
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
 * 结束指定浏览器类型的专用实例进程树(仅匹配我们自己的 user-data-dir,
 * 不影响正常浏览器页面)。同步执行,可在 process 'exit' 处理器中使用。
 * 排除执行命令自身的 PowerShell 进程($PID),避免自匹配导致清理中断。
 */
export function killDedicatedBrowserInstances(browser) {
  if (process.platform !== 'win32') return;
  const dir = appProfileDir(browser);
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*" + dir + "*' } | " +
    'ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }';
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
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
