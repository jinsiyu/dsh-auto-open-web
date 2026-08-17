// dsh-auto-open-web — Win32 文件选择对话框子进程。
// 实现参考官方 @deepseek-ai/dsh-host-directory-picker-native 的 worker.cjs
// (koffi 驱动 IFileOpenDialog 的 COM 对话),仅两处差异:
//   1. 选项位:去掉 FOS_PICKFOLDERS,改为文件模式
//      FOS_FORCEFILESYSTEM(0x40) | FOS_PATHMUSTEXIST(0x800) | FOS_FILEMUSTEXIST(0x1000)
//      = 0x1840 = 6208;
//   2. 标题:由环境变量 DSH_DIALOG_TITLE 传入(与官方一致)。
// 子进程的第一个窗口就是对话框,Windows 会自动激活它(无需前台调用),
// 因此对话框总是出现在浏览器上方。
//
// IPC 协议(与官方一致):{kind:'showing',threadId} → {kind:'done',path|null}
// 或 {kind:'error',message}。被杀死/退出未报告 → 视为取消。
//
// COM vtable 槽位(IUnknown 0-2,IModalWindow 3,IFileDialog 4+)为 Windows Vista
// 以来冻结的 ABI,常量与官方实现逐字一致。

const SIGDN_FILESYSPATH = -2147123200;
const COINIT_APARTMENTTHREADED = 2;
const CLSCTX_INPROC_SERVER = 1;
const FILE_DIALOG_OPTIONS = 0x1840; // FORCEFILESYSTEM | PATHMUSTEXIST | FILEMUSTEXIST
const SLOT_RELEASE = 2;
const SLOT_SHOW = 3;
const SLOT_SET_OPTIONS = 9;
const SLOT_SET_TITLE = 17;
const SLOT_GET_RESULT = 20;
const SLOT_GET_DISPLAY_NAME = 5;
const DPI_AWARENESS_CONTEXTS = [-4, -3, -2];

function readUtf16(koffi, address) {
  const bytes = Buffer.from(koffi.view(address, 32768));
  let end = 0;
  while (end + 1 < bytes.length && bytes[end] !== 0) end += 2;
  return bytes.toString('utf16le', 0, end);
}

function guidBytes(text) {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(text);
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(parseInt(match[1], 16), 0);
  bytes.writeUInt16LE(parseInt(match[2], 16), 4);
  bytes.writeUInt16LE(parseInt(match[3], 16), 6);
  Buffer.from(match[4] + match[5], 'hex').copy(bytes, 8);
  return bytes;
}

const CLSID_FILE_OPEN_DIALOG = guidBytes('dc1c5a9c-e88a-4dde-a5a1-60f82a20aef7');
const IID_IFILE_OPEN_DIALOG = guidBytes('d57c7288-d4ad-4768-be02-9d969532d960');

/**
 * 解析 koffi(与 win32.js getKoffi 同一策略):常规 import → Windows 全局
 * npm 布局下的 DSH 部署副本(官方原生选择器依赖 koffi,部署必带)。
 * 本包不声明 koffi 依赖,失败即抛出(由调用方转为错误消息)。
 */
async function loadKoffi() {
  try {
    const mod = await import('koffi');
    if (mod && mod.default !== undefined) return mod.default;
    return mod;
  } catch {
    /* 常规解析失败,尝试部署副本 */
  }
  const path = require('node:path');
  const fs = require('node:fs');
  const globalRoot = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : '';
  const koffiDir = path.join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', 'koffi');
  if (fs.existsSync(path.join(koffiDir, 'package.json'))) {
    return require(koffiDir);
  }
  throw new Error('koffi not found (neither local nor DSH deployment)');
}

async function loadWin32DialogBindings() {
  const koffi = await loadKoffi();
  const ole32 = koffi.load('ole32.dll');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const pointerSize = koffi.sizeof('void *');
  const coInitializeEx = ole32.func('__stdcall', 'CoInitializeEx', 'int32', ['void *', 'uint32']);
  const coUninitialize = ole32.func('__stdcall', 'CoUninitialize', 'void', []);
  const coCreateInstance = ole32.func('__stdcall', 'CoCreateInstance', 'int32', [
    'void *', 'void *', 'uint32', 'void *', 'void *',
  ]);
  const coTaskMemFree = ole32.func('__stdcall', 'CoTaskMemFree', 'void', ['void *']);
  const getCurrentThreadId = kernel32.func('__stdcall', 'GetCurrentThreadId', 'uint32', []);
  const protoShow = koffi.proto('int32 __stdcall DshDialogShow(void *self, void *owner)');
  const protoSetOptions = koffi.proto('int32 __stdcall DshDialogSetOptions(void *self, uint32 options)');
  const protoSetTitle = koffi.proto('int32 __stdcall DshDialogSetTitle(void *self, str16 title)');
  const protoGetResult = koffi.proto('int32 __stdcall DshDialogGetResult(void *self, _Out_ void **item)');
  const protoGetDisplayName = koffi.proto('int32 __stdcall DshItemGetDisplayName(void *self, int32 form, _Out_ void **name)');
  const protoRelease = koffi.proto('uint32 __stdcall DshComRelease(void *self)');
  const method = (self, slot, proto) => {
    const vtable = koffi.decode(self, 'void *');
    const fn = koffi.decode(vtable, slot * pointerSize, 'void *');
    return (...args) => koffi.call(fn, proto, self, ...args);
  };
  return {
    setThreadDpiAwareness: () => {
      let setContext;
      try {
        setContext = user32.func('__stdcall', 'SetThreadDpiAwarenessContext', 'void *', ['intptr']);
      } catch {
        return;
      }
      for (const context of DPI_AWARENESS_CONTEXTS) if (setContext(context) !== null) return;
    },
    coInitializeSta: () => coInitializeEx(null, COINIT_APARTMENTTHREADED),
    coUninitialize: () => {
      coUninitialize();
    },
    currentThreadId: () => getCurrentThreadId(),
    createFileDialog: () => {
      const out = Buffer.alloc(pointerSize);
      const created = coCreateInstance(CLSID_FILE_OPEN_DIALOG, null, CLSCTX_INPROC_SERVER, IID_IFILE_OPEN_DIALOG, out);
      if (created < 0) throw new Error(`CoCreateInstance(FileOpenDialog) failed: HRESULT 0x${(created >>> 0).toString(16)}`);
      const dialog = koffi.decode(out, 'void *');
      return {
        setOptions: (options) => method(dialog, SLOT_SET_OPTIONS, protoSetOptions)(options),
        setTitle: (title) => method(dialog, SLOT_SET_TITLE, protoSetTitle)(title),
        show: () => method(dialog, SLOT_SHOW, protoShow)(null),
        resultPath: () => {
          const itemOut = [null];
          const gotItem = method(dialog, SLOT_GET_RESULT, protoGetResult)(itemOut);
          if (gotItem < 0) return { hr: gotItem };
          const item = itemOut[0];
          try {
            const nameOut = [null];
            const gotName = method(item, SLOT_GET_DISPLAY_NAME, protoGetDisplayName)(SIGDN_FILESYSPATH, nameOut);
            if (gotName < 0) return { hr: gotName };
            const path = readUtf16(koffi, nameOut[0]);
            coTaskMemFree(nameOut[0]);
            return { hr: gotName, path };
          } finally {
            method(item, SLOT_RELEASE, protoRelease)();
          }
        },
        release: () => {
          method(dialog, SLOT_RELEASE, protoRelease)();
        },
      };
    },
  };
}

function check(hr, what) {
  if (hr < 0) throw new Error(`${what} failed: HRESULT 0x${(hr >>> 0).toString(16)}`);
  return hr;
}

/** 一次模态文件选择对话:DPI 感知、STA 初始化、创建对话框、Show、取结果。 */
function runFileDialog(bindings, title, onShowing) {
  bindings.setThreadDpiAwareness();
  check(bindings.coInitializeSta(), 'CoInitializeEx');
  try {
    const dialog = bindings.createFileDialog();
    try {
      check(dialog.setOptions(FILE_DIALOG_OPTIONS), 'SetOptions');
      check(dialog.setTitle(title), 'SetTitle');
      onShowing(bindings.currentThreadId());
      const shown = dialog.show();
      if (shown === -2147023673) return null; // HRESULT_FROM_WIN32(ERROR_CANCELLED)
      check(shown, 'Show');
      const result = dialog.resultPath();
      check(result.hr, 'GetResult');
      return result.path;
    } finally {
      dialog.release();
    }
  } finally {
    bindings.coUninitialize();
  }
}

const title = process.env.DSH_DIALOG_TITLE ?? '';
if (title === '') throw new Error('dsh-auto-open-web worker: DSH_DIALOG_TITLE is required');
if (process.send === undefined) throw new Error('dsh-auto-open-web worker must run as a child process with an IPC channel');
const send = process.send.bind(process);
const post = (message) => {
  send(message, () => {
    if (process.connected) process.disconnect();
  });
};
process.on('disconnect', () => process.exit(0));
(async () => {
  try {
    post({
      kind: 'done',
      path: runFileDialog(await loadWin32DialogBindings(), title, (threadId) => {
        post({ kind: 'showing', threadId });
      }),
    });
  } catch (error) {
    post({
      kind: 'error',
      message: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
})();
