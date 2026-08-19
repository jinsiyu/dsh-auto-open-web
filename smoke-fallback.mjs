// 冒烟测试:最后的兜底(官方同款默认浏览器打开)。
// 只验证解析与函数契约,不真正拉起浏览器/不弹窗。
// 用法:node smoke-fallback.mjs
import { spawn } from 'node:child_process';
const mod = await import('./lib/index.js');
const platform = await import('./lib/platform.js');

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
  if (!ok) failed += 1;
};

check('index.js exports apply/name', typeof mod.apply === 'function' && mod.name === 'auto-open-web');
check('internals expose getOpenPackage/openDefaultBrowser',
  typeof mod.internals.getOpenPackage === 'function' && typeof mod.internals.openDefaultBrowser === 'function');

// 1. open 包解析(官方同款):应解析到 DSH 部署的 open@11 默认导出函数
const openPkg = await mod.internals.getOpenPackage();
check('open package resolved', typeof openPkg === 'function', typeof openPkg);
if (typeof openPkg === 'function') {
  // open@11 默认导出签名:open(target, options?) → Promise<ChildProcess>
  const probe = openPkg.toString().slice(0, 120).replace(/\s+/g, ' ');
  check('open package looks like open@11 (baseOpen/target)', /baseOpen|target/.test(probe), probe);
}

// 2. 平台原生兜底函数契约
check('platform.openDefaultBrowser is a function', typeof platform.openDefaultBrowser === 'function');
check('win32 native impl is a function', typeof (await import('./lib/win32.js')).openDefaultBrowser === 'function');
check('posix native impl is a function', typeof (await import('./lib/posix.js')).openDefaultBrowser === 'function');

// 3. spawn 管道验证(win32 原生兜底同款模式,无副作用):
//    detached + stdio ignore + windowsHide,exit 码可观测。
if (process.platform === 'win32') {
  const code = await new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/d', '/c', 'exit', '0'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => resolve(-1));
    child.on('exit', (c) => resolve(c));
    // 测试进程事件循环为空,不能 unref(真实 DSH 宿主常驻,无此限制)
  });
  check('spawn plumbing (cmd detached/ignore) exit code 0', code === 0, String(code));
}

process.exit(failed === 0 ? 0 : 1);
