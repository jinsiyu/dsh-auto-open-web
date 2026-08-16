import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import z from '@deepseek-ai/schemastery';

/**
 * @deepseek-ai/dsh-auto-open-web — dsh web profile 启动后自动打开独立应用窗口。
 *
 * 行为:
 *  1. 默认打开 **WebView2 宿主窗口**(随包分发的 DshAppWindow.exe,独立进程,
 *     无标签栏/地址栏,直接加载 GUI 根地址):窗口/任务栏图标 = DSH(Form.Icon);
 *     宿主监视父进程 PID,随 DSH 退出而关闭。
 *  2. 宿主缺失/启动失败 → `--app` **专用浏览器实例**(--user-data-dir 隔离,
 *     不与正常浏览器页面共用进程);再失败则不打开任何东西(仅记录日志)。
 *
 * 配置来源:行配置(cordis.patch.yml)作为启动种子;设置页卡片(客户端 bundle,
 * settings.plugin.item 插槽)经 /auto-open-web/config API 读写,持久化到官方
 * settings 命名空间 `auto-open-web`(首次保存后设置值优先于行配置)。
 *
 * 端口来自 webServer 服务的真实监听值(--port 自定义、--port 0 均正确)。
 * 打开窗口的子进程 detached + unref,不阻塞 DSH、不随 DSH 退出被终止
 * (WebView2 宿主例外:随 DSH 退出而关闭)。
 */

export const name = 'auto-open-web';

/**
 * webServer 是硬依赖:服务出现即代表 HTTP 服务已绑定;监听端口随后公布。
 * settings 是硬依赖(与 proxy-router 同款):设置卡片的数据通道必须等到
 * settings 服务就绪后再注册命名空间,否则 writable 为 false(只读)。
 */
export const inject = ['webServer', 'settings'];

export const Config = z.object({
  /** 等待监听端口公布的最大毫秒数。 */
  timeout: z.natural().default(10000),
  /** 启动时自动打开独立应用窗口;false 时不打开。 */
  appWindow: z.boolean().default(true),
  /** 窗口类型:webview2 = WebView2 宿主(独立进程,任务栏 DSH 图标,随 DSH 退出);
   *  browser = 浏览器 --app 专用实例(--user-data-dir 隔离)。所选类型不可用时
   *  不打开任何东西(仅记录日志),不自动交叉兜底。 */
  windowKind: z.union([z.const('webview2'), z.const('browser')]).default('webview2'),
  /** 手动维护的浏览器可执行文件路径(单条;优先于内置候选 Edge → Chrome;仅 browser 模式使用)。 */
  browserPath: z.string().default(''),
  /** 关闭自动打开的窗口时随之退出 DSH(默认关闭;仅 appWindow 开启时生效)。 */
  exitOnWindowClose: z.boolean().default(false),
});

const CONFIG_API_PATH = '/auto-open-web/config';
const PICK_API_PATH = '/auto-open-web/pick-browser';
const TEST_API_PATH = '/auto-open-web/test-browser';
const ICON_SIZES = [16, 32, 48, 64, 128, 256];
const SETTINGS_NS = 'auto-open-web';

// ── 独立应用窗口(--app) ─────────────────────────────────────────────────

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
function resolveBrowserExe(browserPath) {
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

/** 专用浏览器实例的 user-data-dir(按浏览器区分,不与其他页面共用进程/存储)。 */
function appProfileDir(browser) {
  const home =
    process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(os.homedir(), '.dsh');
  return join(home, browser === 'chrome' ? 'chrome-app-profile' : 'edge-app-profile');
}

/** 测试专用实例的 user-data-dir:独立于正式实例,测试不污染、正式预清理不误杀。 */
function testProfileDir(browser) {
  const home =
    process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(os.homedir(), '.dsh');
  return join(home, (browser === 'chrome' ? 'chrome' : 'edge') + '-test-profile');
}

/** 轮询等待 webServer 监听端口公布;超时返回 null。 */
function waitForPort(server, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = () => {
      const port = server.port;
      if (port !== undefined) {
        resolve(`http://127.0.0.1:${String(port)}`);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

/**
 * 测试浏览器能否被成功拉起(设置卡片「测试」按钮):
 *  1. 以 --app 启动专用测试实例(独立 user-data-dir,不污染正式实例);
 *  2. 等待 2.5 秒,确认浏览器主进程仍存活(启动器立即退出即视为失败);
 *  3. 若 Job Object 可用则加入作业(DSH 退出时兜底清理);
 *  4. 成功后在短暂展示(8 秒)内自动结束该测试进程树(精确 pid,
 *     taskkill /T /F,不动正式实例)。
 * 返回 { ok:true, pid } | { ok:false, error }。
 */
async function testBrowserLaunch(exe, browser, url) {
  const args = [
    '--app=' + url,
    '--user-data-dir=' + testProfileDir(browser),
    '--no-first-run',
    '--no-default-browser-check',
  ];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    } catch (error) {
      resolve({ ok: false, error: `启动失败: ${error.message}` });
      return;
    }
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error });
      }
    };
    child.on('error', (error) => fail(`浏览器进程启动失败: ${error.message}`));
    setTimeout(async () => {
      if (settled) return;
      let alive = true;
      try {
        process.kill(child.pid, 0);
      } catch {
        alive = false;
      }
      if (!alive) {
        settled = true;
        resolve({ ok: false, error: '浏览器进程启动后立即退出' });
        return;
      }
      if (browserJob !== null && browserJob.handle !== null) {
        try {
          assignToBrowserJob(browserJob, child.pid);
        } catch {
          /* 非致命:8 秒后精确清理仍在 */
        }
      }
      settled = true;
      resolve({ ok: true, pid: child.pid });
      // 短暂展示后自动清理测试实例(仅结束该测试进程树)
      setTimeout(() => {
        try {
          spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 15000,
          });
        } catch {
          /* ignore */
        }
      }, 8000);
    }, 2500);
  });
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

async function ensureBrowserJob() {
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
function assignToBrowserJob(job, pid) {
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

/**
 * 用 --app 打开独立应用窗口(无标签栏/地址栏,外观同应用)。
 * 使用专用 --user-data-dir:独立浏览器实例,不与正常浏览器页面共用进程/
 * Cookie/缓存;--no-first-run 避免全新 profile 的首启欢迎页。
 * 传入 job 时把子进程加入 Job Object(DSH 强退也随进程退出)。
 * 始终注册 exit 监听:窗口进程正常退出(退出码 0,即用户关闭窗口)时,
 * 是否随 DSH 退出由当前配置标志 exitWatcherEnabled 决定(设置卡片保存后
 * 即时生效,当前会话无需重启;启动失败/崩溃/强杀的非 0 退出码不触发)。
 */
function openAppWindow(exe, url, browser, job) {
  const args = [
    '--app=' + url,
    '--user-data-dir=' + appProfileDir(browser ?? 'edge'),
    '--no-first-run',
    '--no-default-browser-check',
  ];
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    if (job !== null && job.handle !== null) {
      assignToBrowserJob(job, child.pid); // 子进程及其后代自动继承作业成员资格
    }
    child.on('error', (error) => {
      console.error(`[auto-open-web] app window spawn failed: ${error.message}`);
    });
    child.on('exit', (code) => {
      if (code === 0 && exitWatcherEnabled) {
        console.log('[auto-open-web] app window closed; exiting DSH (exitOnWindowClose)');
        process.exit(0);
      }
    });
    child.unref();
    return true;
  } catch (error) {
    console.error(`[auto-open-web] app window spawn threw: ${error.message}`);
    return false;
  }
}

/**
 * 结束指定浏览器类型的专用实例进程树(仅匹配我们自己的 user-data-dir,
 * 不影响正常浏览器页面)。同步执行,可在 process 'exit' 处理器中使用。
 * 排除执行命令自身的 PowerShell 进程($PID),避免自匹配导致清理中断。
 */
function killDedicatedBrowserInstances(browser) {
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

/**
 * 弹出原生"打开文件"对话框选择浏览器可执行文件(仅 Windows)。
 * 实现参考官方工作区目录选择器(@deepseek-ai/dsh-host-directory-picker-native):
 * 生成子进程(worker.cjs)用 koffi 驱动 IFileOpenDialog(文件模式),
 * 对话框是子进程的第一个窗口,Windows 自动激活 → 总是出现在浏览器上方。
 * IPC 协议:{showing} → {done,path|null} | {error,message}。
 * 返回选中路径,取消/失败返回 null;10 分钟无结果则终止子进程。
 */
function pickBrowserExe() {
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

/** 删除 v0.3 遗留的 state 文件(一次性清理,防孤儿数据)。 */
function removeLegacyState() {
  const home =
    process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(os.homedir(), '.dsh');
  try {
    rmSync(join(home, 'auto-open-web.json'), { force: true });
  } catch {
    /* ignore */
  }
}

/** 把任意输入规范化为完整配置(类型收紧 + 默认值;兼容旧 browsers 列表迁移)。 */
function normalizeState(next) {
  const obj = next !== null && typeof next === 'object' ? next : {};
  const legacyBrowser =
    Array.isArray(obj.browsers) && obj.browsers.length > 0 && typeof obj.browsers[0] === 'string'
      ? obj.browsers[0].trim()
      : '';
  return {
    timeout: Number.isInteger(obj.timeout) && obj.timeout >= 0 ? obj.timeout : 10000,
    appWindow: obj.appWindow !== false,
    windowKind: obj.windowKind === 'browser' ? 'browser' : 'webview2',
    browserPath: typeof obj.browserPath === 'string' ? obj.browserPath.trim() : legacyBrowser,
    exitOnWindowClose: obj.exitOnWindowClose === true,
  };
}

// ── 图标栅格化(WebView2 宿主窗口图标需要 .ico) ───────────────────────────
//
// GUI 自带的 manifest 只有 SVG 图标(favicon.svg)。这里抓取本机 favicon.svg,
// 用 sharp(部署自带,运行时向上解析,未声明为依赖)栅格化为多尺寸 PNG 并缓存,
// 再组装成 .ico 供宿主窗口的 Form.Icon 使用;失败仅告警(宿主退回默认图标)。
let iconCache = null;
let iconFetching = null;

async function getIcons(server) {
  if (iconCache !== null) return iconCache;
  if (iconFetching !== null) return iconFetching;
  iconFetching = (async () => {
    try {
      const port = server.port;
      if (port === undefined) throw new Error('webServer port not settled');
      const response = await fetch(`http://127.0.0.1:${String(port)}/favicon.svg`);
      if (!response.ok) throw new Error(`favicon fetch failed: ${response.status}`);
      const svg = Buffer.from(await response.arrayBuffer());
      let sharp = null;
      try {
        sharp = (await import('sharp')).default;
      } catch (error) {
        throw new Error('sharp unavailable: ' + String(error && error.message !== undefined ? error.message : error));
      }
      const pngs = new Map();
      for (const size of ICON_SIZES) {
        pngs.set(size, await sharp(svg).resize(size, size).png().toBuffer());
      }
      iconCache = { pngs };
      return iconCache;
    } catch (error) {
      console.error(`[auto-open-web] icon rasterization failed: ${String(error && error.message !== undefined ? error.message : error)}`);
      return null;
    } finally {
      iconFetching = null;
    }
  })();
  return iconFetching;
}

// ── WebView2 宿主窗口(任务栏图标由宿主窗口自身提供) ──────────────────────
//
// DshAppWindow.exe(host-publish/,随包分发)是独立进程的 WinForms + WebView2
// 窗口:Form.Icon = DSH 图标 → 任务栏按钮显示 DSH 图标(不受浏览器任务栏身份
// 限制);WindowCloseRequested → 关窗;监视父进程 PID,随 DSH 退出而关闭。
// 本机要求:Windows + WebView2 Runtime(常青版,通常随 Edge 预装)+ .NET 10 运行时。

/** 解析随包分发的宿主可执行文件(仅 Windows)。 */
function resolveHostExe() {
  if (process.platform !== 'win32') return null;
  const exe = fileURLToPath(new URL('../host-publish/DshAppWindow.exe', import.meta.url));
  return existsSync(exe) ? exe : null;
}

/** 把多尺寸 PNG 组装成 ICO 容器(Vista+ 支持 PNG 压缩条目)。 */
function buildIco(pngs) {
  const sizes = [...pngs.keys()].sort((a, b) => a - b);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  for (const size of sizes) {
    const png = pngs.get(size);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...sizes.map((s) => pngs.get(s))]);
}

/** 生成宿主窗口用的 DSH .ico(缓存于 ~/.dsh/auto-open-web-icon.ico),失败返回 null。 */
async function ensureIconFile(server) {
  try {
    const icons = await getIcons(server);
    if (icons === null) return null;
    const ico = buildIco(icons.pngs);
    const home =
      process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(os.homedir(), '.dsh');
    const out = join(home, 'auto-open-web-icon.ico');
    writeFileSync(out, ico);
    return out;
  } catch (error) {
    console.error(`[auto-open-web] icon file generation failed: ${error.message}`);
    return null;
  }
}

/**
 * 启动 WebView2 宿主窗口(独立进程,detached 不共享控制台)。
 * 传入 --parent-pid:宿主在后台线程监视 DSH 进程,DSH 退出(正常或强杀)
 * 即关闭窗口 → 拉起的窗口随 DSH 一起退出,不留孤儿。
 * 始终注册 exit 监听:宿主进程正常退出(退出码 0,即窗口被关闭)时,
 * 是否随 DSH 退出由当前配置标志 exitWatcherEnabled 决定(保存后即时
 * 生效;启动失败的非 0 退出码不触发)。
 */
function spawnHostWindow(exe, url, iconPath) {
  const args = ['--url', url, '--parent-pid', String(process.pid)];
  if (iconPath !== null && iconPath !== '') args.push('--icon', iconPath);
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.on('error', (error) => {
      console.error(`[auto-open-web] host window spawn failed: ${error.message}`);
    });
    child.on('exit', (code) => {
      if (code === 0 && exitWatcherEnabled) {
        console.log('[auto-open-web] host window closed; exiting DSH (exitOnWindowClose)');
        process.exit(0);
      }
    });
    child.unref();
    return true;
  } catch (error) {
    console.error(`[auto-open-web] host window spawn threw: ${error.message}`);
    return false;
  }
}

// ── 插件主体 ─────────────────────────────────────────────────────────────

/**
 * 窗口退出监听共享标志:"窗口关闭时退出 DSH"当前是否生效。
 * 监听始终注册(见 openAppWindow/spawnHostWindow),行为由本标志实时决定:
 * 设置卡片保存配置后立即同步,当前会话无需重启即生效。
 */
let exitWatcherEnabled = false;

/** 测试钩子:纯函数导出,生产代码不依赖。 */
export const internals = {
  resolveBrowserExe,
  openAppWindow,
  testBrowserLaunch,
  normalizeState,
  getIcons,
  buildIco,
  resolveHostExe,
  spawnHostWindow,
  /** 测试钩子:同步"窗口关闭时退出 DSH"生效标志(模拟设置保存)。 */
  setExitWatcherEnabled(value) {
    exitWatcherEnabled = value === true;
  },
};

export function apply(ctx, config) {
  removeLegacyState();

  // browser 模式的专用实例随 DSH 退出:正常退出时结束其实例进程树
  // (被强杀时由下次启动前的预清理兜底)。
  process.on('exit', () => {
    killDedicatedBrowserInstances('edge');
    killDedicatedBrowserInstances('chrome');
  });

  const server = ctx.get('webServer');
  if (server === undefined) {
    console.error('[auto-open-web] webServer service unavailable; not opening anything');
    return;
  }

  // ---- 配置状态:行配置为种子;settings 命名空间持久化(设置卡片写入) ----
  const settingsSvc = ctx.get('settings');
  let scope = null;
  let writable = false;
  let state = normalizeState(config);
  /** 同步"窗口关闭时退出 DSH"生效标志:监听始终注册,保存配置后即时生效。 */
  const syncExitWatcher = () => {
    exitWatcherEnabled = state.exitOnWindowClose === true;
  };
  if (settingsSvc !== undefined && typeof settingsSvc.register === 'function') {
    try {
      scope = settingsSvc.register(SETTINGS_NS, Config);
      writable = settingsSvc.writable !== false;
      const rawDoc = settingsSvc.get(SETTINGS_NS);
      if (rawDoc !== undefined && rawDoc !== null) {
        state = normalizeState(scope.get());
      }
      scope.watch((next) => {
        state = normalizeState(next);
        syncExitWatcher();
      });
    } catch (error) {
      console.error(`[auto-open-web] settings unavailable; using row config only: ${error.message}`);
      scope = null;
      writable = false;
    }
  }
  syncExitWatcher(); // 启动时的最终生效值(settings 已合并或行配置)

  // ---- 设置卡片 API(读写与测试,配置由宿主权威校验) ----
  function sendJson(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  async function readBody(req) {
    let body = '';
    for await (const chunk of req) body += chunk.toString('utf8');
    return body;
  }
  if (typeof server.register === 'function') {
    server.register({
      kind: 'exact',
      path: CONFIG_API_PATH,
      handler: async (req, res) => {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, ...state, writable });
          return;
        }
        if (req.method === 'POST') {
          if (!writable) {
            sendJson(res, 200, { ok: false, error: '当前配置只读(settings 不可写)' });
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(await readBody(req));
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
            return;
          }
          try {
            const next = normalizeState(parsed);
            if (scope !== null) await scope.update(next);
            state = next;
            syncExitWatcher(); // 保存后即时生效,当前会话无需重启
            sendJson(res, 200, { ok: true, ...state });
          } catch (error) {
            sendJson(res, 200, {
              ok: false,
              error: String(error && error.message !== undefined ? error.message : error),
            });
          }
          return;
        }
        res.writeHead(405);
        res.end();
      },
    });
    // 原生"浏览"对话框:选择浏览器可执行文件(仅 Windows)。
    server.register({
      kind: 'exact',
      path: PICK_API_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }
        if (process.platform !== 'win32') {
          sendJson(res, 200, { ok: false, error: '原生浏览对话框仅支持 Windows;请手动输入路径' });
          return;
        }
        const picked = await pickBrowserExe();
        if (picked !== null) {
          sendJson(res, 200, { ok: true, path: picked });
        } else {
          sendJson(res, 200, { ok: false, cancelled: true, error: '未选择文件' });
        }
      },
    });
    // 测试按钮:真正拉起 --app 专用测试实例,确认浏览器可被成功启动。
    server.register({
      kind: 'exact',
      path: TEST_API_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }
        // 优先使用请求携带的草稿 browserPath(未保存也能测当前输入)
        let draftPath = '';
        try {
          const parsed = JSON.parse(await readBody(req));
          if (typeof parsed.browserPath === 'string') draftPath = parsed.browserPath.trim();
        } catch {
          /* 空 body 用已保存路径 */
        }
        const resolved = resolveBrowserExe(draftPath !== '' ? draftPath : state.browserPath);
        if (resolved === null) {
          sendJson(res, 200, { ok: false, error: '未找到可用的浏览器可执行文件(内置候选 Edge/Chrome 均不可用);可先用「浏览」选择路径' });
          return;
        }
        const url = await waitForPort(server, state.timeout);
        if (url === null) {
          sendJson(res, 200, { ok: false, error: 'webServer 端口尚未公布,请稍后重试' });
          return;
        }
        const result = await testBrowserLaunch(resolved.exe, resolved.browser, url);
        if (result.ok !== true) {
          sendJson(res, 200, { ok: false, error: result.error });
          return;
        }
        const label = resolved.browser === 'edge' ? 'Edge' : resolved.browser === 'chrome' ? 'Chrome' : '浏览器';
        sendJson(res, 200, {
          ok: true,
          browser: resolved.browser,
          pid: result.pid,
          message: `已成功拉起 ${label} 测试实例(pid ${result.pid}),窗口将在数秒后自动关闭`,
        });
      },
    });
  }

  const startedAt = Date.now();
  const attempt = async () => {
    // 监听端口在服务公布后的一两个事件循环才写入,轮询等待其公布。
    const port = server.port;
    if (port === undefined) {
      if (Date.now() - startedAt < state.timeout) {
        setTimeout(() => {
          void attempt();
        }, 200);
        return;
      }
      console.error('[auto-open-web] webServer port never settled; not opening anything');
      return;
    }
    const url = `http://127.0.0.1:${String(port)}`;

    // 独立应用窗口:按 windowKind 显式选择(webview2 | browser),直接加载 GUI 根地址。
    // 所选类型不可用时仅记录日志,不打开任何东西,不自动交叉兜底。
    if (state.appWindow) {
      if (state.windowKind === 'browser') {
        const resolved = resolveBrowserExe(state.browserPath);
        if (resolved !== null) {
          // 预清理:上次 DSH 被强杀时残留的专用实例(避免旧窗口堆积)。
          killDedicatedBrowserInstances(resolved.browser);
          // Job Object:DSH 无论正常退出还是被强杀,专用实例随进程一起结束。
          const job = await ensureBrowserJob();
          const ok = openAppWindow(resolved.exe, url, resolved.browser, job);
          if (ok) {
            console.log(`[auto-open-web] opened browser app window (${resolved.browser} --app) at ${url}`);
            return;
          }
          console.log('[auto-open-web] browser app window launch failed; not opening anything');
        } else {
          console.log('[auto-open-web] no Edge/Chrome executable found; not opening anything');
        }
        return;
      }

      // webview2 模式
      if (process.platform !== 'win32') {
        console.log('[auto-open-web] webview2 mode requires Windows; not opening anything');
        return;
      }
      const hostExe = resolveHostExe();
      if (hostExe === null) {
        console.log('[auto-open-web] host exe not found; not opening anything');
        return;
      }
      const iconPath = await ensureIconFile(server);
      const ok = spawnHostWindow(hostExe, url, iconPath);
      if (ok) {
        console.log(`[auto-open-web] opened host window (DshAppWindow) at ${url}`);
        return;
      }
      console.log('[auto-open-web] host window launch failed; not opening anything');
      return;
    }

    // appWindow 关闭:不自动打开任何窗口。
    console.log('[auto-open-web] appWindow disabled; not opening anything');
  };
  void attempt();
}
