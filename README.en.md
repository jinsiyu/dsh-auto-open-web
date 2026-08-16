# dsh-auto-open-web

A persistent plugin for the `dsh web` profile that automatically opens the DSH Web GUI in an app-style
window (or browser tab) on profile start, with a configuration card under Settings → Plugin
configuration (manually maintained browser path, etc.).

## Behavior

On startup (after the HTTP service binds and the actual listening port is known), the window type is
selected by `windowKind`:

1. **WebView2 host** (`windowKind: webview2`, default, Windows only): launches the bundled
   `DshAppWindow.exe` (WinForms + WebView2, own process, no tab/address bar),
   **loading the GUI root address directly** (no iframe, no wrapper page, no injected scripts).
   **Taskbar/window icon = DSH icon** (the window is owned by the host process, which sets
   `Form.Icon` directly, independent of browser taskbar identity rules).
   **Exits with DSH** (the host watches the parent process PID).
   **Remembers window size/position/maximized state**
   (`%LOCALAPPDATA%\DeepSeekHarness\window-state.json`, saved on close and restored on start;
   falls back to centering when the display layout changes).
2. **Browser app window** (`windowKind: browser`): a **dedicated Edge/Chrome instance** via `--app`
   (`--user-data-dir=~/.dsh/<browser>-app-profile`, isolated process tree and storage,
   **shares no processes/Cookies/cache with the normal browser**; `--no-first-run` skips the
   first-run welcome page).
   **Exits with DSH (including force-kill)**: the browser instance is placed into a **Job Object**
   (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, koffi-driven `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`
   structure, 144 bytes verified); whether DSH exits normally or is force-killed
   (`taskkill /F`, crash, shutdown, etc.), the Windows kernel terminates every process in the job
   when its last handle closes — the whole dedicated instance process tree dies with it, with no
   reliance on any exit event. Two extra safety nets: on normal DSH exit a `process 'exit'` handler
   kills the dedicated instance process tree (matching only our own user-data-dir, never the normal
   browser); instances left behind by a force-kill are cleaned up before the next launch.
3. If the selected type is unavailable (host missing / browser not found / non-Windows, etc.) →
   **nothing is opened** (a log entry is written), with no automatic cross-fallback.
   `appWindow: false` opens nothing automatically.

The port comes from the real listening value of the webServer service (`--port` overrides and
`--port 0` both work). Both modes close with DSH: the webview2 host watches the parent process; the
browser dedicated instance is ended by the Job Object (also effective on force-kill) plus exit
cleanup.

### WebView2 host requirements (webview2 mode only)

- Windows 10 1803+ / Windows 11 / Windows Server 2016+
  (Win7/8.1 reached end of support in 2023-01, see Microsoft announcements)
- WebView2 Runtime (evergreen, usually preinstalled with Edge; verified with 151.x locally)
- .NET 10 runtime (installed with the SDK; can be switched to a self-contained publish if needed)

## Configuration

Two equivalent ways:

1. **Settings card** (recommended): Settings → Plugin configuration → the "自动打开网页"
   (auto-open web) card. Editable fields:
   `appWindow` (independent app window), `windowKind` (WebView2 host / browser app window),
   `browserPath` (browser executable, with a native "Browse" file dialog; located below the
   window-type field and enabled only when "Browser app window" is selected),
   `exitOnWindowClose` (exit DSH when the window closes, off by default).
   After saving, values persist to the settings document (namespace `auto-open-web`); once saved,
   settings take precedence over row configuration.
2. **Row configuration** (`cordis.patch.yml`): acts as the startup seed, effective until the
   settings card is saved.

| Field | Default | Description |
| --- | --- | --- |
| `timeout` | `10000` | Max milliseconds to wait for the listening port to be published |
| `appWindow` | `true` | Automatically open the independent app window on start; `false` opens nothing |
| `windowKind` | `webview2` | `webview2` = WebView2 host (own process, DSH taskbar icon, exits with DSH); `browser` = dedicated `--app` browser instance. If the selected type is unavailable, only a log entry is written and nothing opens |
| `exitOnWindowClose` | `false` | **（Experimental）** Exit DSH when the auto-opened window closes (off by default; only effective while `appWindow` is on). Triggered only when the window process exits **normally** (user closes the window) → `process.exit(0)`; startup failures/crashes/force-kills (non-zero exit code) do not trigger, preventing accidental exits. **Takes effect immediately in the current session after saving** (the exit listener is always registered; behavior is driven by a live flag), no restart needed |
| `browserPath` | `''` | Manual browser executable path (single entry, e.g. `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; used only in browser mode), preferred over the built-in candidates Edge → Chrome; a non-existent path is skipped with a warning. The "Browse" button on the card opens a **native file dialog**: same mechanism as the official workspace directory picker (child process + koffi-driven `IFileOpenDialog`; the dialog is the child's first window and is automatically brought to front; no PowerShell). The "Test" button **actually launches** a dedicated `--app` test instance (separate user-data-dir `~/.dsh/<browser>-test-profile`, never pollutes the real instance): after confirming the browser main process stays alive it reports success, then automatically ends that test process tree after a few seconds of display (exact pid, never touches the real instance; the test instance is also placed in the Job Object when available as an exit safety net); the test uses the currently typed path (works even when unsaved), and failures show the reason |

### `browserPath` row configuration example

Override the row's config by id in `~/.dsh/profiles/web/cordis.patch.yml` (the override replaces the
whole config; fields not listed fall back to defaults):

```yaml
- id: auto-open-web
  config:
    browserPath: 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
```

## Packaging and installation

This package is a **bundle**: an npm package carrying a configuration layer — `dsh.bundle` in
`package.json` declares the patch file (`cordis.patch.yml`), and a profile activates the plugin row
by package name when installed. Published to the **npm registry** (`dsh-auto-open-web@0.1.2`) and
**GitHub** (https://github.com/jinsiyu/dsh-auto-open-web, `main` branch).

### Packaging

```bash
cd dsh-auto-open-web
pnpm pack          # the prepack hook compiles the WebView2 host first (dotnet publish), producing dsh-auto-open-web-0.1.2.tgz
```

### Installation (pick one)

**Option 1: source checkout link (development; changes take effect immediately)**

```bash
# absolute path to avoid pnpm self-linking
dsh plugin --profile web add C:\path\to\dsh-auto-open-web
```

**Option 2: tarball (published artifact, recommended for delivery; no build permission needed)**

```bash
dsh plugin --profile web add ./dsh-auto-open-web-0.1.2.tgz
```

**Option 3: npm registry (after publishing)**

```bash
dsh plugin --profile web add dsh-auto-open-web
```

**Option 4: GitHub source**

```bash
dsh plugin --profile web add github:jinsiyu/dsh-auto-open-web#main
```

### Uninstall

```bash
dsh plugin --profile web remove dsh-auto-open-web   # removes the dependency and its configuration layer together
```

### Effect and layer order

After installation: pnpm adds the package to `profiles/web/node_modules`, and `dsh` appends
`dsh-auto-open-web` to `dsh.profile.bundles`; at startup the bundle's `cordis.patch.yml` inserts the
plugin row (`name: auto-open-web`, resolved by package name). After restarting `dsh web`, the
"自动打开网页" card appears in the settings page (the client bundle is scanned into the browser
manifest at startup via the modules line, per the `dsh.client` declaration).

The effective configuration is composed layer by layer in this order (later layers win per row,
replacing the whole row's config rather than deep-merging): each bundle's patch (in bundles list
order) → the profile's own `cordis.patch.yml` → the global `$DSH_HOME/cordis.patch.yml` → the
`--patch` overlay. Users can override this package's row in their own profile's `cordis.patch.yml`
without touching the package.

### Notes

- **The npm package already contains the compiled WebView2 host** (built by the prepack hook before
  publishing); the **GitHub `main` branch and source-checkout installs do not** include
  `host-publish/` (build artifacts are .gitignore'd): for webview2 mode, run
  `pnpm run build:host` inside `node_modules/dsh-auto-open-web` first (requires the .NET SDK);
  browser mode needs no build.
- `@deepseek-ai/cordis` is a peer dependency provided by the DSH deployment; pnpm's peer warnings
  during installation can be ignored.
- If installing by editing `package.json` manually (not via the `dsh plugin` command), you must add
  both the `dependencies` entry and `dsh.profile.bundles`; when using a local `file:` dependency,
  `dsh web` normalizes `file:` to `^0.1.2` at startup, which does not affect runtime.

## Icons

- GUI page icon: the GUI ships its own `/favicon.svg` (same as index.html).
- **Taskbar/window icon (WebView2 host)**: the host process sets `Form.Icon` directly to the
  plugin-generated DSH .ico (`~/.dsh/auto-open-web-icon.ico`), independent of browser taskbar
  identity rules. The .ico is built by fetching the local `favicon.svg` and rasterizing it with
  **sharp** (bundled with the deployment, resolved upward at runtime, not declared as a dependency)
  into 16/32/48/64/128/256 PNGs; when sharp is unavailable the host falls back to the default window
  icon.

## Platform support

- Windows: `windowKind: webview2` (default, DSH taskbar icon) or `windowKind: browser` (dedicated
  `--app` instance); nothing opens if the selected type is unavailable
- macOS/Linux: `webview2` mode is unavailable (logs and opens nothing); `browser` mode is untested
  (dedicated `--app` instance)

## Edge cases

- Normal restart: in webview2 mode the old host window exits with the old DSH process; the new DSH
  opens a new host window
- `browser` mode: after a restart the old window stays as-is (needs a manual refresh; may briefly
  coexist with the new window); when DSH is force-killed (`taskkill /F`, crash), the dedicated
  instance is ended by the Job Object without leftovers
- Plugin removed: no injected code, no leftover routes, zero residual impact
