// dsh-auto-open-web — Client bundle(设置卡片,官方控件 + 官方 webServer 数据通道)
// 格式:window.__ModuleLoader__.load({ id, factory });factory(require) 的
// require 解析浏览器端冻结模块表(react、@deepseek-ai/dsh-client-ui-primitives 等)。
//
// 数据通道:设置卡片经官方 ctx.webServer JSON API 读写(第三方 settings 命名空间
// 不在客户端白名单,故走自定义 API,与 proxy-router 卡片同一机制):
//   GET  /auto-open-web/config → { ok, appWindow, windowKind,
//                                   browserPath, exitOnWindowClose, writable }
//   POST /auto-open-web/config → { ok, ... } | { ok:false, error }
//   POST /auto-open-web/pick-browser → 原生"浏览"对话框(宿主子进程 + koffi
//     IFileOpenDialog,与官方工作区选择器同机制;不使用 PowerShell),返回
//     { ok:true, path } | { ok:false, cancelled:true, error }
//   说明:网页 <input type=file> 拿不到本地完整路径,故浏览走宿主原生对话框。
//
// 注意:不做客户端 schema 校验——浏览器内置(frontend dist 冻结)的
// dsh-client-schema-form 副本对本插件 schema 执行 validateDraft 会抛
// "n is not a function"(与 npm 安装版行为不一致),导致保存按钮永远置灰;
// 保存由宿主权威校验(normalizeState + scope.update)并持久化到 settings。
//
// 官方 API 使用:
//   - 控件:Input / Button(官方 primitives,与全站设计系统一致)
//   - 草稿模型:draft 普通对象,setPath 不可变编辑
// 卡片外壳保持内置 PluginCard 同款外观(与 proxy-router 卡片同一份 CSS)。
window.__ModuleLoader__.load({
  id: 'dsh-auto-open-web',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let React = require('react')

    // ---- 内置 PluginCard.module.css(默认卡片外观,原样注入) ----
    var CARD_CSS = '.YyYd_a_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.YyYd_a_card:hover{border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}.YyYd_a_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}.YyYd_a_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.YyYd_a_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.YyYd_a_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.YyYd_a_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.YyYd_a_description{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:13px;line-height:1.5}.YyYd_a_chevron{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none;transition:transform .16s}.YyYd_a_chevronOpen{transform:rotate(180deg)}.YyYd_a_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.YyYd_a_readOnly{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:12px 0 0;font-size:12px;line-height:1.5}.YyYd_a_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.YyYd_a_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.YyYd_a_failed{min-width:0;color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary));flex:1;margin:0;font-size:12px;line-height:1.5}.YyYd_a_discard,.YyYd_a_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.YyYd_a_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.YyYd_a_save{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse,#fff);border-color:var(--dsw-alias-brand-primary)}.YyYd_a_save:hover:not(:disabled){filter:brightness(.95)}.YyYd_a_discard:disabled,.YyYd_a_save:disabled{opacity:.4;cursor:default}'
    var CARD_TAG = 'dsh-auto-open-web/PluginCard.module.css'
    // ---- 内置 ValueField 字段布局样式(label/hint 排版,原样注入) ----
    var FIELDS_CSS = '.At1oFq_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.At1oFq_field+.At1oFq_field{border-top:1px solid var(--dsw-alias-border-l2)}.At1oFq_head{align-items:center;gap:8px;display:flex}.At1oFq_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.At1oFq_badges{align-items:center;gap:8px;display:inline-flex}.At1oFq_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.At1oFq_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.At1oFq_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.At1oFq_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.At1oFq_reset:disabled{cursor:default}.At1oFq_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.At1oFq_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.At1oFq_input:disabled{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:default}.At1oFq_inputInvalid{border-color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary));}.At1oFq_invalid{color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary));margin:0;font-size:12px;line-height:1.5}.At1oFq_hint{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:0;font-size:12px;line-height:1.5}'
    var FIELDS_TAG = 'dsh-auto-open-web/Fields.module.css'
    // ---- 极少量自有布局 CSS(仅行排列/复选行,不改变观感) ----
    var EXTRA_CSS =
      '.aow-row{display:flex;gap:8px;align-items:center}' +
      '.aow-grow{flex:1;min-width:0}' +
      '.aow-check{display:flex;align-items:center;gap:8px;cursor:pointer}' +
      '.aow-check input{accent-color:var(--dsw-alias-brand-primary);width:15px;height:15px;margin:0;flex:none}' +
      '.aow-check input:disabled{cursor:default}' +
      '.aow-test-ok{color:var(--dsw-alias-state-success-primary,#3a8a4a);margin:4px 0 0;font-size:12px;line-height:1.5}' +
      '.aow-test-fail{color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary));margin:4px 0 0;font-size:12px;line-height:1.5}'
    var EXTRA_TAG = 'dsh-auto-open-web/Extra.module.css'
    function injectCss(tagId, css) {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-auto-open-web'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    injectCss(CARD_TAG, CARD_CSS)
    injectCss(FIELDS_TAG, FIELDS_CSS)
    injectCss(EXTRA_TAG, EXTRA_CSS)

    // ---- 官方共享模块(冻结表):控件 + 草稿/校验模型 ----
    // require 失败时降级而非崩溃(卡片仍然渲染,仅退回基础能力)
    var prim = null
    var form = null
    try {
      prim = require('@deepseek-ai/dsh-client-ui-primitives')
      form = require('@deepseek-ai/dsh-client-schema-form')
    } catch (e) {
      console.error('[auto-open-web] shared modules require failed:', e !== null && e !== undefined && e.message !== undefined ? e.message : String(e))
    }
    var Button = prim !== null && prim.Button !== undefined ? prim.Button : null
    var Input = prim !== null && prim.Input !== undefined ? prim.Input : null
    var ChevronIcon = prim !== null && prim.IconChevronDownOutline14 !== undefined ? prim.IconChevronDownOutline14 : null
    // 注意:不在此处使用官方 rehydrateSchema/validateDraft——浏览器内置(frontend
    // dist 冻结)副本对本插件 schema 校验会抛 "n is not a function" 异常(兼容性
    // 差异),导致 invalid 恒真、保存按钮置灰;宿主侧 normalizeState + scope.update
    // 才是权威校验,本卡片字段也无格式约束,故客户端只做草稿编辑(setPath)。
    var setPath = form !== null ? form.setPath : null

    // ---- 草稿编辑:优先官方 setPath,不可用时降级为本地实现 ----
    function applySetPath(draftObj, path, value) {
      if (setPath !== null) return setPath(draftObj, path, value)
      const next = Object.assign({}, draftObj)
      next[path[0]] = value
      return next
    }
    // 控件:优先官方 Input/Button,不可用时退回原生元素(用内置字段样式)
    function ProxyInput(props) {
      if (Input !== null) return React.createElement(Input, props)
      const rest = Object.assign({}, props)
      delete rest.className
      return React.createElement('input', Object.assign({ className: 'At1oFq_input' + (props.className !== undefined ? ' ' + props.className : '') }, rest))
    }
    function ProxyButton(props) {
      if (Button !== null) return React.createElement(Button, props)
      const rest = Object.assign({}, props)
      delete rest.className
      return React.createElement('button', Object.assign({ type: 'button', className: 'YyYd_a_discard' + (props.className !== undefined ? ' ' + props.className : '') }, rest))
    }
    function Checkbox(props) {
      return React.createElement('label', { className: 'aow-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: (event) => props.onChange(event.target.checked)
        }),
        React.createElement('span', { className: 'At1oFq_hint' }, props.children)
      )
    }
    function Radio(props) {
      return React.createElement('label', { className: 'aow-check' },
        React.createElement('input', {
          type: 'radio',
          name: 'auto-open-web-window-kind',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: () => props.onChange(props.value)
        }),
        React.createElement('span', { className: 'At1oFq_hint' }, props.children)
      )
    }

    function AutoOpenSettingsPage() {
      const [open, setOpen] = React.useState(false)
      const [config, setConfig] = React.useState(null) // { appWindow, windowKind, browserPath, exitOnWindowClose, writable } | null
      const [loadError, setLoadError] = React.useState('')
      const [reloadTick, setReloadTick] = React.useState(0)
      const [draft, setDraft] = React.useState({ appWindow: true, windowKind: 'webview2', browserPath: '', exitOnWindowClose: false })
      const [busy, setBusy] = React.useState(false)
      const [picking, setPicking] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [testResult, setTestResult] = React.useState(null) // { ok, text } | null
      const [failedText, setFailedText] = React.useState('')

      // 配置加载:官方 webServer API(GET /auto-open-web/config)
      React.useEffect(() => {
        let cancelled = false
        fetch('/auto-open-web/config')
          .then((response) => response.json())
          .then((result) => {
            if (cancelled) return
            if (result === null || result === undefined || result.ok !== true) {
              setLoadError(result !== null && result !== undefined && typeof result.error === 'string' ? result.error : '配置加载失败')
              return
            }
            setConfig({
              appWindow: result.appWindow !== false,
              windowKind: result.windowKind === 'browser' ? 'browser' : 'webview2',
              browserPath: typeof result.browserPath === 'string' ? result.browserPath : '',
              exitOnWindowClose: result.exitOnWindowClose === true,
              writable: result.writable !== false,
            })
          })
          .catch((error) => {
            if (!cancelled) setLoadError('配置加载失败: ' + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error))
          })
        return () => { cancelled = true }
      }, [reloadTick])

      const saved = config !== null
        ? { appWindow: config.appWindow, windowKind: config.windowKind, browserPath: config.browserPath, exitOnWindowClose: config.exitOnWindowClose }
        : null

      // 快照值 → 草稿(外部变化/保存后同步)
      React.useEffect(() => {
        if (saved !== null) setDraft({
          appWindow: saved.appWindow,
          windowKind: saved.windowKind,
          browserPath: saved.browserPath,
          exitOnWindowClose: saved.exitOnWindowClose,
        })
      }, [saved !== null ? JSON.stringify(saved) : 'none'])

      const loading = config === null && loadError === ''
      const writable = config !== null ? config.writable !== false : true
      // 客户端不做 schema 校验(浏览器内置 schema-form 兼容性问题,见上方注释);
      // 保存由宿主权威校验(normalizeState + scope.update)。
      const invalid = false
      const dirty = saved !== null && (
        draft.appWindow !== saved.appWindow ||
        draft.windowKind !== saved.windowKind ||
        draft.browserPath !== saved.browserPath ||
        draft.exitOnWindowClose !== saved.exitOnWindowClose
      )

      const blocked = saved === null || !dirty || invalid || busy

      const save = () => {
        if (blocked) return
        setBusy(true)
        setFailedText('')
        fetch('/auto-open-web/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            appWindow: draft.appWindow,
            windowKind: draft.windowKind,
            browserPath: draft.browserPath,
            exitOnWindowClose: draft.exitOnWindowClose,
          }),
        })
          .then((response) => response.json())
          .then((result) => {
            if (result !== null && result !== undefined && result.ok === true) {
              setConfig((prev) => prev !== null ? {
                appWindow: result.appWindow !== false,
                windowKind: result.windowKind === 'browser' ? 'browser' : 'webview2',
                browserPath: typeof result.browserPath === 'string' ? result.browserPath : '',
                exitOnWindowClose: result.exitOnWindowClose === true,
                writable: prev.writable,
              } : prev)
            } else {
              setFailedText('保存失败: ' + (result !== null && result !== undefined && typeof result.error === 'string' ? result.error : '未知错误'))
            }
          })
          .catch((error) => { setFailedText('保存失败: ' + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)) })
          .then(() => { setBusy(false) })
      }

      const discard = () => {
        if (saved !== null) setDraft({
          appWindow: saved.appWindow,
          windowKind: saved.windowKind,
          browserPath: saved.browserPath,
          exitOnWindowClose: saved.exitOnWindowClose,
        })
        setFailedText('')
      }

      const retryLoad = () => {
        setLoadError('')
        setReloadTick((tick) => tick + 1)
      }

      // 原生"浏览"对话框:宿主弹出文件选择器,选中后回填路径
      const browse = () => {
        if (!writable || picking) return
        setPicking(true)
        setFailedText('')
        fetch('/auto-open-web/pick-browser', { method: 'POST' })
          .then((response) => response.json())
          .then((result) => {
            if (result !== null && result !== undefined && result.ok === true && typeof result.path === 'string') {
              setDraft(applySetPath(draft, ['browserPath'], result.path))
            } else if (result === null || result === undefined || result.cancelled !== true) {
              setFailedText('选择失败: ' + (result !== null && result !== undefined && typeof result.error === 'string' ? result.error : '未知错误'))
            }
          })
          .catch((error) => { setFailedText('选择失败: ' + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)) })
          .then(() => { setPicking(false) })
      }

      // 测试:真正拉起 --app 专用测试实例,确认浏览器可被成功启动
      // (使用当前草稿路径,未保存也能测试;结果展示在字段下方)
      const testBrowser = () => {
        if (testing) return
        setTesting(true)
        setTestResult(null)
        setFailedText('')
        fetch('/auto-open-web/test-browser', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ browserPath: draft.browserPath }),
        })
          .then((response) => response.json())
          .then((result) => {
            if (result !== null && result !== undefined && result.ok === true) {
              setTestResult({ ok: true, text: typeof result.message === 'string' ? result.message : '浏览器拉起成功' })
            } else {
              setTestResult({ ok: false, text: '测试失败: ' + (result !== null && result !== undefined && typeof result.error === 'string' ? result.error : '未知错误') })
            }
          })
          .catch((error) => { setTestResult({ ok: false, text: '测试失败: ' + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error) }) })
          .then(() => { setTesting(false) })
      }

      const chevronCls = 'YyYd_a_chevron' + (open ? ' YyYd_a_chevronOpen' : '')

      return React.createElement('li', { className: 'YyYd_a_card' + (open ? ' YyYd_a_cardOpen' : '') },
        React.createElement('button', {
          type: 'button',
          className: 'YyYd_a_header',
          'aria-expanded': open,
          'aria-label': (open ? '折叠' : '展开') + ': 自动打开网页',
          onClick: () => setOpen(!open)
        },
          React.createElement('span', { className: 'YyYd_a_headText' },
            React.createElement('span', { className: 'YyYd_a_name' }, '自动打开网页'),
            React.createElement('span', { className: 'YyYd_a_description' }, 'DSH 启动后自动打开独立应用窗口或网页;可手动指定浏览器位置')
          ),
          dirty ? React.createElement('span', { className: 'YyYd_a_pending' }, '未保存') : null,
          ChevronIcon !== null
            ? React.createElement(ChevronIcon, { className: chevronCls })
            : React.createElement('span', { className: chevronCls }, '▾')
        ),
        open ? React.createElement('div', { className: 'YyYd_a_body' },
          !writable ? React.createElement('p', { className: 'YyYd_a_readOnly', role: 'status' }, '当前配置只读(settings 不可写)。') : null,
          loading
            ? React.createElement('p', { className: 'At1oFq_hint' }, '配置加载中…')
            : (loadError !== ''
                ? React.createElement('div', { className: 'At1oFq_field' },
                    React.createElement('p', { className: 'At1oFq_invalid' }, loadError),
                    React.createElement('div', { className: 'aow-row' },
                      React.createElement(ProxyButton, { variant: 'outline', size: 'sm', onClick: retryLoad }, '重试')
                    )
                  )
                : React.createElement(React.Fragment, null,
                    // ---- 独立应用窗口 ----
                    React.createElement('div', { className: 'At1oFq_field' },
                      React.createElement('div', { className: 'At1oFq_head' },
                        React.createElement('span', { className: 'At1oFq_label' }, '独立应用窗口')
                      ),
                      React.createElement(Checkbox, { checked: draft.appWindow, disabled: !writable, onChange: (v) => setDraft(applySetPath(draft, ['appWindow'], v)) },
                        '启动时自动打开独立应用窗口;关闭后不自动打开任何窗口'
                      )
                    ),
                    // ---- 窗口类型 ----
                    React.createElement('div', { className: 'At1oFq_field' },
                      React.createElement('div', { className: 'At1oFq_head' },
                        React.createElement('span', { className: 'At1oFq_label' }, '窗口类型')
                      ),
                      React.createElement(Radio, { checked: draft.windowKind === 'webview2', disabled: !writable, value: 'webview2', onChange: (v) => setDraft(applySetPath(draft, ['windowKind'], v)) },
                        'WebView2 宿主(独立进程,任务栏 DSH 图标,随 DSH 退出;需 Windows + WebView2 运行时)'
                      ),
                      React.createElement(Radio, { checked: draft.windowKind === 'browser', disabled: !writable, value: 'browser', onChange: (v) => setDraft(applySetPath(draft, ['windowKind'], v)) },
                        '浏览器应用窗口(--app 专用实例,不与其他浏览器页面共用进程)'
                      )
                    ),
                    // ---- 浏览器可执行文件(仅"浏览器应用窗口"模式使能) ----
                    React.createElement('div', { className: 'At1oFq_field' },
                      React.createElement('div', { className: 'At1oFq_head' },
                        React.createElement('label', { className: 'At1oFq_label', htmlFor: 'auto-open-web-browser-path' }, '浏览器可执行文件')
                      ),
                      React.createElement('div', { className: 'aow-row' },
                        React.createElement(ProxyInput, {
                          id: 'auto-open-web-browser-path',
                          className: 'aow-grow',
                          value: draft.browserPath,
                          placeholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                          disabled: !writable || draft.windowKind !== 'browser',
                          onChange: (event) => {
                            const next = applySetPath(draft, ['browserPath'], event.target.value)
                            setDraft(next)
                          }
                        }),
                        React.createElement(ProxyButton, { variant: 'outline', size: 'sm', disabled: !writable || picking || draft.windowKind !== 'browser', onClick: browse }, picking ? '选择中…' : '浏览'),
                        React.createElement(ProxyButton, { variant: 'outline', size: 'sm', disabled: testing || draft.windowKind !== 'browser', onClick: testBrowser }, testing ? '测试中…' : '测试')
                      ),
                      testResult !== null
                        ? React.createElement('p', { className: testResult.ok ? 'aow-test-ok' : 'aow-test-fail', role: 'status' },
                            (testResult.ok ? '✓ ' : '✗ ') + testResult.text
                          )
                        : null,
                      React.createElement('p', { className: 'At1oFq_hint' }, '仅"浏览器应用窗口"模式可编辑;留空使用内置候选(Edge → Chrome);路径不存在会被跳过并告警。「测试」会真实拉起一个专用测试实例验证可用性(数秒后自动关闭)')
                    ),
                    // ---- 窗口关闭时退出 DSH(实验性,默认关闭) ----
                    React.createElement('div', { className: 'At1oFq_field' },
                      React.createElement('div', { className: 'At1oFq_head' },
                        React.createElement('span', { className: 'At1oFq_label' }, '窗口关闭时退出 DSH'),
                        React.createElement('span', { className: 'At1oFq_badges' },
                          React.createElement('span', { className: 'At1oFq_badge' }, '实验性')
                        )
                      ),
                      React.createElement(Checkbox, { checked: draft.exitOnWindowClose === true, disabled: !writable, onChange: (v) => setDraft(applySetPath(draft, ['exitOnWindowClose'], v)) },
                        '关闭自动打开的窗口时,DSH 随之退出(默认关闭)'
                      )
                    ),
                    // ---- 卡片底部(与内置 PluginCard 同款按钮) ----
                    React.createElement('div', { className: 'YyYd_a_footer' },
                      failedText !== '' ? React.createElement('p', { className: 'YyYd_a_failed', role: 'status' }, failedText) : null,
                      React.createElement('button', { type: 'button', className: 'YyYd_a_discard', disabled: !dirty || busy, onClick: discard }, '放弃修改'),
                      React.createElement('button', { type: 'button', className: 'YyYd_a_save', disabled: blocked, onClick: save }, busy ? '保存中…' : '保存')
                    )
                  ))
        ) : null
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) {
        console.error('[auto-open-web] slots service unavailable')
        return
      }
      slots.inject('settings.plugin.item', () =>
        slots.register(
          { name: 'settings.plugin.item', id: 'auto-open-web', order: 40, label: '自动打开网页' },
          () => React.createElement(AutoOpenSettingsPage, null)
        )
      )
    }

    exports.apply = apply
    exports.name = 'auto-open-web'
    return module.exports
  }
})
