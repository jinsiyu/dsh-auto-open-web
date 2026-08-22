// DshAppWindow — dsh-auto-open-web 的 WebView2 宿主窗口。
// 独立进程 + 自绘窗口:任务栏图标来自 Form.Icon(由插件生成的 DSH .ico),
// 不受浏览器任务栏身份限制。
//
// 用法:DshAppWindow.exe --url <GUI 根地址> [--icon <DSH.ico 路径>] [--parent-pid <PID>]
//
// 生命周期:
//  - 窗口直接加载 DSH GUI 根地址(无包装页、无注入脚本)。
//  - 传入 --parent-pid 时,宿主在后台线程监视父进程:父进程退出(正常退出或
//    被强杀均可感知)即关闭窗口并退出 → 拉起的窗口随 DSH 一起退出。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DshAppWindow;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        SetUpWebView2Loader();
        string url = Arg(args, "--url") ?? "http://127.0.0.1:3080/";
        string? icon = Arg(args, "--icon");
        int parentPid = int.TryParse(Arg(args, "--parent-pid"), out int pid) ? pid : 0;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm(url, icon, parentPid));
        return 0;
    }

    /// <summary>
    /// 按进程架构把 WebView2Loader.dll 的搜索路径指到 runtimes/&lt;arch&gt;/native:
    /// 包 targets 只向根目录复制 x86 loader,而 .NET Framework 进程在本机架构
    /// (x64/ARM64)上运行时需要同架构 loader,否则 WebView2 初始化失败。
    /// </summary>
    private static void SetUpWebView2Loader()
    {
        try
        {
            string arch = Environment.Is64BitProcess
                ? RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "win-arm64" : "win-x64"
                : "win-x86";
            string dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtimes", arch, "native");
            if (Directory.Exists(dir))
                SetDllDirectory(dir);
        }
        catch
        {
            /* 无碍:退回默认 DLL 搜索(根目录 x86 loader) */
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectory(string lpPathName);

    private static string? Arg(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == name)
                return args[i + 1];
        return null;
    }
}

internal sealed class MainForm : Form
{
    /// <summary>窗口状态(大小/位置/最大化)持久化结构。须为 public,JavaScriptSerializer 不支持非公开类型。</summary>
    public sealed class SavedWindowState
    {
        public int Left { get; set; }
        public int Top { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public string State { get; set; } = "Normal"; // Normal | Maximized
    }

    private static string StateFilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DeepSeekHarness",
        "window-state.json");

    public MainForm(string url, string? iconPath, int parentPid)
    {
        Text = "DeepSeek Harness";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 800);
        MinimumSize = new Size(480, 320);
        if (iconPath is not null && File.Exists(iconPath))
        {
            try
            {
                Icon = new Icon(iconPath);
            }
            catch
            {
                /* 图标缺失不致命 */
            }
        }

        RestoreWindowState();
        FormClosing += (_, _) => SaveWindowState();

        var webView = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(webView);

        Load += async (_, _) =>
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: null,
                    userDataFolder: GetUserDataFolder(),
                    options: null);
                await webView.EnsureCoreWebView2Async(env);
                webView.CoreWebView2.Settings.AreDevToolsEnabled = true; // 允许 F12 / 右键"检查"
                webView.CoreWebView2.WindowCloseRequested += (_, _) => Close();
                webView.CoreWebView2.DocumentTitleChanged += (_, _) =>
                {
                    string title = webView.CoreWebView2.DocumentTitle;
                    if (!string.IsNullOrWhiteSpace(title))
                        Text = title;
                };
                webView.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "WebView2 初始化失败: " + ex.Message,
                    "DeepSeek Harness",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Close();
            }
        };

        if (parentPid > 0)
            WatchParent(parentPid);
    }

    /// <summary>后台线程监视父进程;父进程退出(正常/强杀均可感知)即关闭窗口。PID 缺失时视为父进程已退出。</summary>
    private void WatchParent(int parentPid)
    {
        var thread = new Thread(() =>
        {
            try
            {
                using var parent = Process.GetProcessById(parentPid);
                parent.WaitForExit();
            }
            catch
            {
                // 父进程不存在(已退出或 PID 无效)→ 立即关闭
            }
            try
            {
                if (IsHandleCreated)
                    BeginInvoke((Action)(() => Close()));
                else
                    Environment.Exit(0);
            }
            catch
            {
                Environment.Exit(0);
            }
        })
        {
            IsBackground = true,
        };
        thread.Start();
    }

    /// <summary>启动时恢复上次的窗口大小/位置/最大化状态;状态文件缺失或窗口不在任何屏幕时保持默认居中。</summary>
    private void RestoreWindowState()
    {
        try
        {
            if (!File.Exists(StateFilePath)) return;
            SavedWindowState? state = new JavaScriptSerializer().Deserialize<SavedWindowState>(File.ReadAllText(StateFilePath));
            if (state is null || state.Width < MinimumSize.Width || state.Height < MinimumSize.Height) return;
            var bounds = new Rectangle(state.Left, state.Top, state.Width, state.Height);
            bool onScreen = Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds));
            if (!onScreen) return; // 显示器布局变化(如外接屏拔掉)→ 回到默认居中
            StartPosition = FormStartPosition.Manual;
            SetBounds(bounds.X, bounds.Y, bounds.Width, bounds.Height);
            if (state.State == "Maximized")
                WindowState = FormWindowState.Maximized;
        }
        catch
        {
            /* 损坏的状态文件忽略,使用默认布局 */
        }
    }

    /// <summary>关闭时保存窗口状态(最大化时保存还原后的大小)。</summary>
    private void SaveWindowState()
    {
        try
        {
            Rectangle normal = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            if (normal.Width < MinimumSize.Width || normal.Height < MinimumSize.Height) return;
            var state = new SavedWindowState
            {
                Left = normal.X,
                Top = normal.Y,
                Width = normal.Width,
                Height = normal.Height,
                State = WindowState == FormWindowState.Maximized ? "Maximized" : "Normal",
            };
            Directory.CreateDirectory(Path.GetDirectoryName(StateFilePath)!);
            File.WriteAllText(StateFilePath, new JavaScriptSerializer().Serialize(state));
        }
        catch
        {
            /* 保存失败不影响退出 */
        }
    }

    private static string GetUserDataFolder()
    {
        string root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DeepSeekHarness",
            "WebView2");
        Directory.CreateDirectory(root);
        return root;
    }
}
