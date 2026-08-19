/**
 * @deepseek-ai/dsh-auto-open-web — dsh web profile 启动后自动打开独立应用窗口。
 *
 * 本文件为**平台无关共通核心**:配置模型、设置卡片 API、启动流程、生命周期、
 * 图标栅格化。平台相关实现(浏览器候选/Job Object/进程清理/原生对话框/
 * WebView2 宿主)全部位于平台适配器,经 ./platform.js 统一接口注入:
 *   - Windows:   lib/win32.js(全量实现)
 *   - 其他平台:  lib/posix.js(降级实现,记日志不打开)
 *
 * 行为:
 *  1. 默认打开 **WebView2 宿主窗口**(随包分发的 DshAppWindow.exe,独立进程,
 *     无标签栏/地址栏,直接加载 GUI 根地址):窗口/任务栏图标 = DSH(Form.Icon);
 *     宿主监视父进程 PID,随 DSH 退出而关闭。
 *  2. 宿主缺失/启动失败 → `--app` **专用浏览器实例**(--user-data-dir 隔离,
 *     不与正常浏览器页面共用进程);再失败则不打开任何东西(仅记录日志)。
 *
 * 配置来源:行配置(cordis.patch.yml)作为启动种子;设置页卡片(客户端 bundle,
 * settings.plugin.item 插槽)经官方 settings 域(settingsScope)读写本命名
 * 空间,持久化到官方 settings 文档(首次保存后设置值优先于行配置)。
 * 宿主保留的辅助路由:/auto-open-web/pick-browser(原生浏览对话框)、
 * /auto-open-web/test-browser(浏览器拉起测试)。
 *
 * 端口来自 webServer 服务的真实监听值(--port 自定义、--port 0 均正确)。
 * 打开窗口的子进程 detached + unref,不阻塞 DSH、不随 DSH 退出被终止
 * (WebView2 宿主例外:随 DSH 退出而关闭)。
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { dshHome, appProfileDir, testProfileDir, instanceStateFile } from './paths.js';
import * as platform from './platform.js';

/**
 * schemastery 依赖策略(与 win32.js 的 koffi 同一模式):本包零 dependencies,
 * schemastery 由 DSH 部署自带(官方核心依赖),运行时解析:
 *   常规 import(profile 已装/手动安装)优先 → Windows 全局 npm 布局的
 *   DSH 部署副本;两者都不可用时模块加载失败(插件依赖 Config,无法降级)。
 */
let z = null;
try {
  z = (await import('@deepseek-ai/schemastery')).default;
} catch {
  try {
    const globalRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : '';
    const dshEntry = join(globalRoot, '@deepseek-ai', 'dsh', 'package.json');
    if (existsSync(dshEntry)) z = createRequire(dshEntry)('@deepseek-ai/schemastery');
  } catch {
    /* 两次解析均失败 → 下方抛错 */
  }
}
if (z === null || z === undefined) {
  throw new Error(
    '[auto-open-web] schemastery not found (neither local nor DSH deployment); ' +
      'this plugin cannot build its config schema. Check the DSH deployment.',
  );
}

export const name = 'auto-open-web';

/**
 * webServer 是硬依赖:Cordis 会等 webServer 插件 Service.init() 完成
 * (HTTP socket 已绑定、port 已写入)后才激活本插件,因此 apply 时端口
 * 直接可用,无需轮询等待。settings 是硬依赖(与 proxy-router 同款):
 * 设置卡片的数据通道必须等到 settings 服务就绪后再注册命名空间,
 * 否则 writable 为 false(只读)。
 */
export const inject = ['webServer', 'settings'];

export const Config = z.object({
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

const PICK_API_PATH = '/auto-open-web/pick-browser';
const TEST_API_PATH = '/auto-open-web/test-browser';
const ICON_SIZES = [16, 32, 48, 64, 128, 256];
const SETTINGS_NS = 'auto-open-web';

// ── 启动流程工具(共通) ───────────────────────────────────────────────────

/**
 * 测试浏览器能否被成功拉起(设置卡片「测试」按钮):
 *  1. 以 --app 启动专用测试实例(独立 user-data-dir,不污染正式实例);
 *  2. 等待 2.5 秒,确认浏览器主进程仍存活(启动器立即退出即视为失败);
 *  3. 若平台 Job Object 可用则加入作业(DSH 退出时兜底清理);
 *  4. 成功后在短暂展示(8 秒)内自动结束该测试进程树(平台进程树终止,
 *     不动正式实例)。
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
      // 加入平台 Job Object(可用时;非致命,定时清理仍在)
      try {
        const job = await platform.ensureBrowserJob();
        platform.assignToBrowserJob(job, child.pid);
      } catch {
        /* ignore */
      }
      settled = true;
      resolve({ ok: true, pid: child.pid });
      // 短暂展示后自动清理测试实例(仅结束该测试进程树)
      setTimeout(() => {
        platform.killProcessTree(child.pid);
      }, 8000);
    }, 2500);
  });
}

/**
 * 用 --app 打开独立应用窗口(无标签栏/地址栏,外观同应用)。
 * 使用专用 --user-data-dir:独立浏览器实例,不与正常浏览器页面共用进程/
 * Cookie/缓存;--no-first-run 避免全新 profile 的首启欢迎页。
 * 传入 job 时把子进程加入平台 Job Object(DSH 强退也随进程退出)。
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
    // 记录专用实例身份(pid/exe/写入时间),供平台清理校验(防 pid 复用误杀)
    recordInstanceState(browser ?? 'edge', child.pid, exe);
    if (job !== null && job.handle !== null) {
      platform.assignToBrowserJob(job, child.pid); // 子进程及其后代自动继承作业成员资格
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
 * 记录专用实例 pid 状态文件(平台清理时按文件校验进程身份)。
 * 写入失败不致命:清理侧无记录时跳过(Job Object 仍是主要保障)。
 */
function recordInstanceState(browser, pid, exe) {
  try {
    writeFileSync(instanceStateFile(browser), JSON.stringify({ pid, exe, writtenAt: Date.now() }), 'utf8');
  } catch (error) {
    console.error(`[auto-open-web] instance state write failed: ${error.message}`);
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

// ── 配置与历史迁移(共通) ─────────────────────────────────────────────────

/** 删除 v0.3 遗留的 state 文件(一次性清理,防孤儿数据)。 */
function removeLegacyState() {
  try {
    rmSync(join(dshHome(), 'auto-open-web.json'), { force: true });
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
    appWindow: obj.appWindow !== false,
    windowKind: obj.windowKind === 'browser' ? 'browser' : 'webview2',
    browserPath: typeof obj.browserPath === 'string' ? obj.browserPath.trim() : legacyBrowser,
    exitOnWindowClose: obj.exitOnWindowClose === true,
  };
}

// ── 图标栅格化(WebView2 宿主窗口图标需要 .ico;共通) ─────────────────────
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
    const out = join(dshHome(), 'auto-open-web-icon.ico');
    writeFileSync(out, ico);
    return out;
  } catch (error) {
    console.error(`[auto-open-web] icon file generation failed: ${error.message}`);
    return null;
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
  resolveBrowserExe: platform.resolveBrowserExe,
  openAppWindow,
  testBrowserLaunch,
  normalizeState,
  getIcons,
  buildIco,
  resolveHostExe: platform.resolveHostExe,
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
    platform.killDedicatedBrowserInstances('edge');
    platform.killDedicatedBrowserInstances('chrome');
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

  // ---- 卡片辅助 API(浏览/测试;设置读写走官方 settings 域) ----
  // 设置卡片经客户端 settingsScope(settings 域)读写本命名空间,不再自建
  // config 路由;这里只保留官方通道无法覆盖的能力。
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
    // 原生"浏览"对话框:选择浏览器可执行文件(平台能力;非 Windows 提示手动输入)。
    server.register({
      kind: 'exact',
      path: PICK_API_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }
        if (!platform.isWindows) {
          sendJson(res, 200, { ok: false, error: '原生浏览对话框仅支持 Windows;请手动输入路径' });
          return;
        }
        const picked = await platform.pickBrowserExe();
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
        const resolved = platform.resolveBrowserExe(draftPath !== '' ? draftPath : state.browserPath);
        if (resolved === null) {
          sendJson(res, 200, { ok: false, error: '未找到可用的浏览器可执行文件(内置候选 Edge/Chrome 均不可用);可先用「浏览」选择路径' });
          return;
        }
        // inject 保证 apply 时端口已可用(inject 依赖 init 完成 = socket 已绑定)
        if (server.port === undefined) {
          sendJson(res, 200, { ok: false, error: 'webServer 端口不可用,请稍后重试' });
          return;
        }
        const url = `http://127.0.0.1:${String(server.port)}`;
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

  const attempt = async () => {
    // inject 保证 apply 时 webServer 已初始化完成(HTTP socket 已绑定、
    // port 已写入),直接取端口,无需等待。
    if (server.port === undefined) {
      console.error('[auto-open-web] webServer port unavailable; not opening anything');
      return;
    }
    const url = `http://127.0.0.1:${String(server.port)}`;

    // 独立应用窗口:按 windowKind 显式选择(webview2 | browser),直接加载 GUI 根地址。
    // 所选类型不可用时仅记录日志,不打开任何东西,不自动交叉兜底。
    if (state.appWindow) {
      if (state.windowKind === 'browser') {
        const resolved = platform.resolveBrowserExe(state.browserPath);
        if (resolved !== null) {
          // 预清理:上次 DSH 被强杀时残留的专用实例(避免旧窗口堆积)。
          platform.killDedicatedBrowserInstances(resolved.browser);
          // Job Object:DSH 无论正常退出还是被强杀,专用实例随进程一起结束。
          const job = await platform.ensureBrowserJob();
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
      if (!platform.isWindows) {
        console.log('[auto-open-web] webview2 mode requires Windows; not opening anything');
        return;
      }
      const hostExe = platform.resolveHostExe();
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
