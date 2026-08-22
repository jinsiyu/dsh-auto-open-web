# dsh-auto-open-web

> English: [README.en.md](README.en.md)

dsh web profile 启动后自动打开独立应用窗口（或网页标签页）的常驻插件，并在
设置 → 插件配置中提供配置卡片（手动维护浏览器位置等）。

## 行为

启动时（HTTP 服务绑定完成、取得实际监听端口后），按 `windowKind` 选择窗口类型：

1. **WebView2 宿主**（`windowKind: webview2`，默认，仅 Windows）：启动随包分发的
   `DshAppWindow.exe`（WinForms + WebView2，独立进程，无标签栏/地址栏），
   **直接加载 GUI 根地址**（无 iframe、无包装页、无注入脚本）。
   **任务栏/窗口图标 = DSH 图标**（窗口由宿主进程所有，直接设置 Form.Icon，
   不受浏览器任务栏身份限制）。**随 DSH 退出**（宿主监视父进程 PID）。
   **记忆窗口大小/位置/最大化状态**（`%LOCALAPPDATA%\DeepSeekHarness\window-state.json`，
   关闭时保存、启动时恢复；显示器布局变化时回退居中）。
2. **浏览器应用窗口**（`windowKind: browser`）：`--app` **专用 Edge/Chrome 实例**
   （`--user-data-dir=~/.dsh/<browser>-app-profile`，独立进程树与存储，
   **不与正常浏览器页面共用进程/Cookie/缓存**；`--no-first-run` 跳过首启欢迎页）。
   **随 DSH 退出（含强杀）**：浏览器实例加入 **Job Object**
   （`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，koffi 驱动
   `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` 结构，实测 144 字节）；DSH 无论
   正常退出还是被强杀（`taskkill /F`、崩溃、关机等），Windows 内核随作业最后
   一个句柄关闭自动结束作业内全部进程——专用实例整个进程树随之消亡，无需
   依赖任何退出事件。另有两层兜底：DSH 正常退出时 `process 'exit'` 结束该
   专用实例的整个进程树（仅匹配我们自己的 user-data-dir，不影响正常浏览器）；
   DSH 被强杀后的残留实例由下次启动前预清理。
3. **默认浏览器打开（最后兜底）**：所选类型不可用时（宿主缺失/浏览器找不到/
   非 Windows 等）→ **降级为官方同款的默认浏览器交接**——把 URL 交给操作系统
   默认浏览器（普通标签页），保证用户至少能打开 GUI。实现与 DSH 核心
   （web-app bundle）启动时打开网页的方式一致：优先用 DSH 部署自带的
   `open` 包（win32 = PowerShell Start，darwin = `open`，linux = `xdg-open`），
   `open` 包不可用时退回平台原生拉起（win32 = `cmd /c start`，darwin = `open`，
   linux = `xdg-open`）。
   `appWindow: false` 时**与官方相同**:默认浏览器打开(普通标签页,官方
   open 方式)。
4. **`--no-open` / SSH 会话（与官方相同的不打开）**：`dsh web --no-open`
   （webStartup 服务的 `openBrowser === false`）或 SSH 会话（`SSH_CONNECTION`/
   `SSH_TTY` 环境变量，与官方 `launchedThroughSsh` 同源）时不打开任何
   窗口/页面——插件读取与官方**同一来源**（web-startup 提供的 webStartup
   服务）做同样的抑制。

端口取自 webServer 服务的真实监听值（`--port` 自定义、`--port 0` 均正确）。
**无需等待**：插件把 webServer 声明为硬依赖（`inject`），Cordis 会等
webServer 插件 `Service.init()` 完成（HTTP socket 已绑定、端口已写入）后才
激活本插件，apply 时端口直接可用。
两种模式都随 DSH 退出而关闭：webview2 宿主监视父进程；browser 专用实例由
Job Object（强杀也生效）+ 退出清理结束进程树。

> **与 DSH 核心浏览器交接的关系**：DSH 核心（web-app bundle）默认会在启动后
> 用系统默认浏览器打开 GUI（`openBrowser: true`，普通标签页/窗口，非独立窗口）。
> 安装本插件后，插件的 bundle 补丁会把 `web-runtime.openBrowser` 置为 `false`，
> 打开行为完全由本插件接管：`appWindow: true` 时打开独立应用窗口，不弹出
> 普通浏览器页面；`appWindow: false` 时插件执行**与官方核心相同的默认浏览器
> 交接**（open 包 → 平台原生拉起），行为与未安装插件时一致；`dsh web
> --no-open`（或 SSH 会话）时与官方一致不打开任何窗口/页面。卸载插件后
> 恢复官方默认行为。

### WebView2 宿主要求（仅 webview2 模式）

- Windows 10 1803+ / Windows 11 / Windows Server 2016+
  （Win7/8.1 已于 2023-01 终止支持，见微软公告）
- WebView2 Runtime（常青版，通常随 Edge 预装；本机已验证 151.x）
- **无 .NET 10 运行时要求**：宿主自 0.1.15 起目标 **.NET Framework 4.7.2**，
  由 Windows 10 1803+ / Windows 11 **操作系统自带**（Win11 为 4.8.x），
  无需安装任何 .NET Core/10/自包含运行时。构建机需 .NET SDK 与 .NET
  Framework 4.x 定位包（随 VS/SDK 安装；无定位包时给 csproj 加
  `Microsoft.NETFramework.ReferenceAssemblies` NuGet 包）。

## 配置

两种途径，等价：

1. **设置页卡片**（推荐）：设置 → 插件配置 → 「自动打开网页」卡片。可编辑
   `appWindow`（独立应用窗口）、`windowKind`（WebView2 宿主 / 浏览器应用窗口）、
   `browserPath`（浏览器可执行文件，支持「浏览」原生对话框选择；位于窗口类型
   下方，仅选择「浏览器应用窗口」时使能）、
   `exitOnWindowClose`（窗口关闭时退出 DSH，默认关闭）。
   保存后经**官方 settings 域**（客户端 settingsScope）持久化到
   settings 文档（命名空间 `auto-open-web`），首次保存后设置值优先于行配置；
   宿主仅保留「浏览」「测试」辅助路由（官方通道无法覆盖的能力）。
2. **行配置**（cordis.patch.yml）：作为启动种子，设置卡片保存前生效。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `appWindow` | `true` | 启动时自动打开独立应用窗口；false 时与官方相同——用系统默认浏览器打开 GUI（普通标签页，官方 open 方式） |
| `windowKind` | `webview2` | `webview2` = WebView2 宿主（独立进程、任务栏 DSH 图标、随 DSH 退出）；`browser` = 浏览器 `--app` 专用实例。所选类型不可用时仅记录日志、不打开 |
| `exitOnWindowClose` | `false` | **（实验性）**关闭自动打开的窗口时随之退出 DSH（默认关闭；仅 `appWindow` 开启时生效）。窗口进程**正常**退出（用户关闭窗口）时触发 `process.exit(0)`；启动失败/崩溃/被强杀（非 0 退出码）不触发，避免误退出。**设置卡片保存后当前会话即时生效**（退出监听始终注册、行为由实时标志决定），无需重启 DSH |
| `browserPath` | `''` | 手动指定的浏览器可执行文件路径（单条，如 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；仅浏览器模式使用），优先于内置候选 Edge → Chrome；路径不存在会跳过并告警。设置卡片上的「浏览」按钮弹出**原生文件对话框**：与官方工作区目录选择器同一机制（子进程 + koffi 驱动 IFileOpenDialog，对话框是子进程的第一个窗口，自动置顶；不使用 PowerShell）。「测试」按钮**真实拉起**一个 `--app` 专用测试实例（独立 user-data-dir `~/.dsh/<browser>-test-profile`，不污染正式实例）：确认浏览器主进程存活后报告成功，窗口展示数秒后自动结束该测试进程树（精确 pid，不动正式实例；Job Object 可用时测试实例也加入作业，DSH 退出时兜底）；测试使用当前输入的路径（未保存也能测），失败会显示原因 |

### browserPath 行配置示例

在 `~/.dsh/profiles/web/cordis.patch.yml` 中按 id 覆写该行的 config（覆写会整体替换 config，未列出的字段用默认值）：

```yaml
- id: auto-open-web
  config:
    browserPath: 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
```

## 打包与安装

本包是**组合包(bundle)**:一个附带配置层的 npm 包——`package.json` 的
`dsh.bundle` 声明配置层文件(`cordis.patch.yml`),profile 安装它时按包名激活
插件行。已发布到 **npm registry**(`dsh-auto-open-web@0.1.5`)与 **GitHub**
（https://github.com/jinsiyu/dsh-auto-open-web，main 分支）。

### 打包

```bash
cd dsh-auto-open-web
pnpm pack          # prepack 钩子自动先编译 WebView2 宿主(dotnet publish),产出 dsh-auto-open-web-0.1.5.tgz
```

### 安装方式(任选其一)

**方式一:源码 checkout 链接(开发期,改动即时生效)**

```bash
# 绝对路径,避免 pnpm 自链接
dsh plugin --profile web add C:\path\to\dsh-auto-open-web
```

**方式二:tarball(发布产物,推荐交付;无需构建授权)**

```bash
dsh plugin --profile web add ./dsh-auto-open-web-0.1.5.tgz
```

**方式三:npm 注册表(发布后)**

```bash
dsh plugin --profile web add dsh-auto-open-web
```

**方式四:GitHub 源码安装**

```bash
dsh plugin --profile web add github:jinsiyu/dsh-auto-open-web#main
```

### 卸载

```bash
dsh plugin --profile web remove dsh-auto-open-web   # 同时移除依赖与对应配置层
```

### 效果与层顺序

安装后:pnpm 将包加入 `profiles/web/node_modules`,`dsh` 把
`dsh-auto-open-web` 追加到 `dsh.profile.bundles`;启动时 bundle 的
`cordis.patch.yml` 插入插件行(`name: auto-open-web`,按包名解析)。
重启 `dsh web` 后设置页出现「自动打开网页」卡片(客户端 bundle 由 modules
行按 `dsh.client` 声明在启动时扫描进浏览器清单)。

生效配置按以下顺序逐层组合(后应用的层按行胜出,整行替换 config 而非深合并):
每个 bundle 的 patch(按 bundles 列表顺序)→ profile 自己的
`cordis.patch.yml` → 全局 `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。
用户可在自己 profile 的 `cordis.patch.yml` 中覆盖本包的行,无需改动包。

### 注意事项

- **本包零 dependencies**:所有运行时依赖均由 **DSH 部署提供**,以 optional
  peer 声明(安装无警告):
  - `@deepseek-ai/dsh`(宿主,声明兼容范围 `>=0.1.0-rc.8 <0.2.0`:
    自 rc.8 起客户端冻结表移除 `dsh-client-schema-form`、引入
    `dsh-client-runtime`,本插件的设置卡片与打开行为均依赖该版本;
    不做运行时版本检测)
  - `@deepseek-ai/schemastery`(配置 schema 校验器;运行时解析:常规 import
    优先,其次 Windows 全局 npm 布局下的 DSH 部署副本)
  - `koffi`(仅 Windows 的 Job Object / 进程校验 / 原生对话框;同样运行时
    解析部署副本,失败仅降级)
  因此任何平台安装都无构建拦截——鸿蒙等无 koffi 预编译的环境开箱即装;
  posix 平台走 posix 降级适配器(browser 模式可用;webview2 / 原生对话框
  不可用),且平台适配器按平台条件加载,posix 上完全不求值 win32.js。
- **设置卡片 UI 完全自绘**(自 0.1.10 起):不依赖官方任何组件/CSS 模板
  (不 require `dsh-client-ui-primitives`,不复刻官方样式表),卡片外壳、
  字段、按钮、输入框、图标全部手写;观感经官方设计令牌变量
  (`--dsw-alias-*` / `--dsw-static-*`)对齐,浅/深色自动跟随主题。
  仅使用官方公开的数据/机制接口:`settingsScope`(settings 域)、`slots`
  (插槽)、`locale`(文案)、`dsh-client-runtime`(快照 store)。
- **npm 包已含 WebView2 宿主编译产物**(prepack 编译后发布);**GitHub
  main 分支与源码 checkout 方式不含** `host-publish/`(构建产物被
  .gitignore 忽略):webview2 模式需先在 `node_modules/dsh-auto-open-web`
  下执行 `pnpm run build:host` 生成(需 .NET SDK);browser 模式无需构建。
- 若手动编辑 `package.json` 安装(不经 dsh plugin 命令),需同时追加
  `dependencies` 与 `dsh.profile.bundles` 两项;使用本地 `file:` 依赖时
  `dsh web` 启动会把 `file:` 规范化成 `^0.1.10`,运行时不受影响。

## 图标

- GUI 页面图标：GUI 自带 `/favicon.svg`（与 index.html 一致）。
- **任务栏/窗口图标（WebView2 宿主）**：宿主进程直接设置 `Form.Icon` = 插件生成的
  DSH .ico（`~/.dsh/auto-open-web-icon.ico`），与浏览器任务栏身份机制无关。
  .ico 来源：抓取本机 `favicon.svg`，用 **sharp**（部署自带，运行时向上解析，
  未声明为依赖）栅格化为 16/32/48/64/128/256 PNG 后组装。
- **图标固定策略（自 0.1.14）**：生成的 .ico 一经写盘即**缓存固定**——后续启动
  检测到缓存存在且非空就直接复用，不再抓取 favicon/栅格化（图标不会因某次
  favicon 或 sharp 瞬时失败而消失，启动也更快）；仅缓存缺失时生成一次。
  另有**兜底**：`host/icon.ico`（与缓存同源）已通过 `<ApplicationIcon>`
  嵌入宿主 exe，即使缓存文件缺失，窗口/任务栏也显示 DSH 图标而非默认图标。

## 平台支持

- Windows：`windowKind: webview2`（默认，任务栏图标 DSH）或 `windowKind: browser`（--app 专用实例）；所选类型不可用时降级为默认浏览器打开（官方同款，普通标签页）
- macOS/Linux：`webview2` 模式不可用（降级为默认浏览器打开）；`browser` 模式未测试（--app 专用实例）

## 边界情况

- 正常重启：webview2 模式下旧宿主窗口随旧 DSH 进程退出；新 DSH 打开新宿主窗口
- `browser` 模式：重启后旧窗口保持原样（需手动刷新；可与新窗口短暂并存）；
  DSH 被强杀（`taskkill /F`、崩溃）时专用实例由 Job Object 一并结束，不残留
- 插件被移除：无注入、无残留路由，零残留影响
