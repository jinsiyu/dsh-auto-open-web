// dsh-auto-open-web — client bundle 冒烟测试(插槽适配 + 深色配色)
// 覆盖:两条版本线的插槽注册(新版 plugins.row.config / 最新 rc 线 settings.plugin.item)、
// 视图分支(summary / page / 缺 form)、深色模式主按钮令牌对、locale 字典一致性、
// 以及"不再保留旧版回退"的兼容策略断言。
// 用法:node smoke-client-slots.mjs
import { readFileSync } from 'node:fs'

const src = readFileSync('C:/Users/User/Desktop/harness/dsh-auto-open-web/lib/client.js', 'utf8')

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '  (' + detail + ')' : ''))
  if (!ok) failed += 1
}

// ---- 极简 React 桩(createElement 立即调用函数组件,便于断言内部输出;hook 可用) ----
let openState = false // 控制 useState 返回值(用于展开/折叠态断言)
const React = {
  createElement: (type, props, ...children) => {
    const p = Object.assign({}, props === null || props === undefined ? {} : props)
    if (children.length === 1) p.children = children[0]
    else if (children.length > 1) p.children = children
    if (typeof type === 'function') return type(p)
    return { type, props: p }
  },
  useState: (init) => [typeof init === 'function' ? init() : openState, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  Fragment: 'Fragment'
}
const storeStub = { createSnapshotStore: (init) => ({ getSnapshot: () => init, subscribe: () => () => {}, set: () => {} }) }
const requireShim = (id) => {
  if (id === 'react') return React
  if (id === '@deepseek-ai/dsh-client-store') return storeStub
  throw new Error('module not found: ' + id)
}

globalThis.window = { __ModuleLoader__: { load: (def) => { globalThis.__def = def } } }
new Function('window', 'require', src)(globalThis.window, requireShim)
const mod = globalThis.__def.factory(requireShim)

check('exports.name = auto-open-web', mod.name === 'auto-open-web')
check(
  'inject 只声明两线共有服务(不含已移除的 settingsScope)',
  JSON.stringify(mod.inject) === JSON.stringify(['slots', 'locale', 'connection', 'remote']),
  JSON.stringify(mod.inject)
)

// ---- mock ctx:捕获槽注册 ----
const scopeStub = {
  getSnapshot: () => ({ status: 'ready', writable: true, value: {}, base: {}, user: {} }),
  subscribe: () => () => {},
  set: async () => true,
  unset: async () => true
}
function runApply(settingsScopeValue) {
  const registrations = []
  const ctx = {
    effect: (fn) => { fn() },
    locale: { register: () => {} },
    get: (name) => (name === 'settingsScope' ? settingsScopeValue : undefined),
    slots: {
      register: () => { throw new Error('register called outside inject callback') },
      inject: (name, cb) => {
        const entry = { name }
        registrations.push(entry)
        ctx.slots.register = (options, component) => {
          entry.options = options
          entry.component = component
          return () => {}
        }
        cb()
      }
    }
  }
  mod.apply(ctx)
  return registrations
}

// 新版(无 settingsScope):只注册 bundle 配置槽
const newest = runApply(undefined)
check('新版:注册 plugins.bundle.config', newest.some((r) => r.name === 'plugins.bundle.config'), newest.map((r) => r.name).join(', '))
check('新版:不注册 rc 线插槽(settingsScope 缺失)', !newest.some((r) => r.name === 'settings.plugin.item'))
const rowReg = newest.find((r) => r.name === 'plugins.bundle.config')
check('bundle 配置 key = 包名(与 harness-tags 同款席位)', rowReg.options.key === 'dsh-auto-open-web', String(rowReg.options.key))
check('bundle 配置不注入 hooks(数据经 configForms 自绑)', rowReg.options.inject === undefined)

// 最新 rc 线(有 settingsScope):再注册设置页卡片
const rcLine = runApply({ bind: () => scopeStub })
check('rc 线:注册 settings.plugin.item', rcLine.some((r) => r.name === 'settings.plugin.item'), rcLine.map((r) => r.name).join(', '))
const rcReg = rcLine.find((r) => r.name === 'settings.plugin.item')
check('rc 线 key = 设置命名空间', rcReg.options.key === 'auto-open-web')
check('rc 线注入 hooks + 表单动作', rcReg.options.inject !== undefined && rcReg.options.inject().hooks !== undefined)
check('两线共用 locale 命名空间', rowReg.options.locale === 'auto-open-web' && rcReg.options.locale === 'auto-open-web')

// ---- 新版行配置组件的视图分支 ----
const rowComponent = rowReg.component
const pageForm = {
  state: {
    status: 'ready',
    writable: true,
    value: { appWindow: true, windowKind: 'webview2', browserPath: '', exitOnWindowClose: false },
    base: {},
    user: undefined,
    revision: 3,
    mode: 'host'
  },
  mutate: async () => true
}
const propsBase = { t: (k) => k }
check('summary 视图返回一行文本', typeof rowComponent({ ...propsBase, view: 'summary', form: pageForm }) === 'string')
const page = rowComponent({ ...propsBase, view: 'page', form: pageForm })
check('page 视图渲染表单容器', page !== null && page !== undefined && page.type === 'div')
const pageText = JSON.stringify(page)
check('page 视图含保存按钮(primary)', pageText.includes('aow-btnPrimary'))
check('page 视图无"放弃"控件(官方约定:离开页面即丢弃)', !pageText.includes('discard'))
check('page 视图含复选/输入控件', pageText.includes('aow-check') && pageText.includes('aow-input'))
const unavailable = rowComponent({
  ...propsBase,
  view: 'page',
  form: { state: { status: 'unavailable', writable: false, value: undefined, base: undefined, user: undefined, revision: undefined, mode: 'host' }, mutate: async () => false }
})
check('命名空间不可用时给出提示', unavailable !== null && unavailable.type === 'p' && JSON.stringify(unavailable.props.children) === '"unavailable"')
const noForm = rowComponent({ ...propsBase, view: 'page', form: undefined })
check('缺 form 时不抛错并给出提示', noForm !== null && noForm.type === 'p')

// ---- rc 线卡片组件 ----
const rcComponent = rcReg.component
const rcState = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
  appWindow: { text: true, overridden: false },
  windowKind: { text: 'webview2', overridden: false },
  browserPath: { text: '', overridden: false, invalid: false },
  exitOnWindowClose: { text: false, overridden: false }
}
const rcProps = {
  t: (k) => k,
  useAutoOpenCard: (sel) => sel(rcState),
  edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {}
}
const legacy = rcComponent(rcProps)
const legacyType = legacy === null || legacy === undefined ? String(legacy) : (typeof legacy.type === 'string' ? legacy.type : (legacy.type && legacy.type.name) || typeof legacy.type)
check('rc 线渲染卡片根节点(<li>)', legacyType === 'li', legacyType)
check('rc 线折叠态含折叠头', JSON.stringify(legacy).includes('aow-cardHeader'))
openState = true
const legacyOpenText = JSON.stringify(rcComponent(rcProps))
openState = false
check('rc 线展开态含放弃/保存按钮', legacyOpenText.includes('discard') && legacyOpenText.includes('aow-btnPrimary'))

// ---- 深色模式适配:主按钮必须用「随主题反转」的令牌对 ----
const primaryRule = src.match(/\.aow-btnPrimary\{[^}]*\}/)
check('主按钮 CSS 存在', primaryRule !== null)
check(
  '主按钮配色为 label-primary 底 + bg-layer-3 字(深浅色自动反转)',
  primaryRule !== null && primaryRule[0].includes('background:var(--dsw-alias-label-primary)') && primaryRule[0].includes('color:var(--dsw-alias-bg-layer-3'),
  primaryRule === null ? '' : primaryRule[0]
)
const cssSection = src.slice(src.indexOf('var CARD_CSS'), src.indexOf('var CARD_TAG'))
check('CSS 不引用不存在的令牌 label-inverse', !cssSection.includes('var(--dsw-alias-label-inverse'))
check('CSS 不引用不存在的令牌 alias-label-error', !cssSection.includes('var(--dsw-alias-label-error'))

// ---- 兼容策略:不再保留旧版回退 ----
check('不再 require rc.8 时代的 dsh-client-runtime', !src.includes("require('@deepseek-ai/dsh-client-runtime')"))
check('不再注册行席位 plugins.row.config(与 harness-tags 统一为 bundle 席位)', !src.includes("'plugins.row.config'"))

// ---- locale 字典一致性 ----
const dicts = {}
for (const name of ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ru']) {
  const m = src.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n    \\}'))
  if (!m) { dicts[name] = null; continue }
  const keys = new Set()
  for (const seg of m[1].split(',')) { const k = seg.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/); if (k) keys.add(k[1]) }
  dicts[name] = keys
}
const ref = dicts.zh
check('7 语言字典键集一致', Object.values(dicts).every((d) => d !== null && d.size === ref.size && [...d].every((k) => ref.has(k))), 'keys=' + ref.size)
check('字典含 unavailable 键', Object.values(dicts).every((d) => d.has('unavailable')))

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' FAILED')
process.exit(failed === 0 ? 0 : 1)
