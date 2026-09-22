// dsh-auto-open-web — Client bundle(设置表单;UI 完全自绘,不依赖官方组件/CSS 模板)
// 格式:window.__ModuleLoader__.load({ id, factory });factory(require) 的
// require 解析浏览器端冻结模块表(react、@deepseek-ai/dsh-client-store 等)。
// **不** require @deepseek-ai/dsh-client-ui-primitives 等官方 UI 包。
//
// 依赖边界(与官方数据的对接面,均为公开接口):
//   支持两条版本线(0.1.26 起;更早的 alpha/rc 不再保证):
//     · 最新版(dsh ≥0.1.6-alpha,含 0.1.7-alpha.1):插件设置位于「插件管理」页,
//       配置注册在 **bundle 详情页** —— 槽 `plugins.bundle.config`,key = bundle
//       包名(`dsh-auto-open-web`),与 dsh-harness-tags 同款席位。页面只传
//       `{ view:'page' }`,没有 form,故组件自己经客户端服务 `configForms` 绑命名
//       空间(条目 id `auto-open-web`);宿主只在 Config 字段标了 `.volatile()`
//       时才投影该命名空间。
//     · 最新 rc 线(0.1.5-rc.x):设置页插件配置卡片 —— 槽 `settings.plugin.item`
//       (按设置命名空间 keyed),数据走宿主 `settings.register` + 客户端
//       `settingsScope`。
//   两条线的客户端服务互不存在(settingsScope ↔ configForms),因此:
//     - `exports.inject` 只声明两线共有的服务(slots/locale/connection/remote);
//     - settingsScope / configForms 都用 `ctx.get` **惰性读取**;
//     - 两个槽都用 slots.inject 挂载,不存在的插槽只保持 pending(不报错)。
//   - locale:文案注册(zh/en/ja/ko/fr/de/ru,跟随界面语言)
//   - store:createSnapshotStore 快照 store(dsh-client-store,缺失时内置最小实现)
//     —— rc.8 时代的 dsh-client-runtime 回退已按兼容策略移除(0.1.2-alpha.2 起
//     统一为 dsh-client-store)。
//
// 视觉(全部自产):
//   - 卡片外壳、字段、按钮、输入框、复选/单选、徽章、图标均为手写实现;
//   - 观感通过官方设计令牌变量(--dsw-alias-* / --dsw-static-*)对齐,浅/深色
//     自动跟随主题,不复刻官方任何样式表或组件代码;
//   - CSS 经标准注入约定(<style data-plugin / data-plugin-css> 去重)挂载。
//
// 宿主保留的辅助路由(官方通道无法覆盖):
//   POST /auto-open-web/pick-browser → 原生"浏览"对话框
//   POST /auto-open-web/test-browser → 浏览器拉起测试
window.__ModuleLoader__.load({
  id: 'dsh-auto-open-web',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let React = require('react')

    // ── 自绘样式(观感对齐官方设计令牌;类名全部自有 aow-*) ────────────────
    // 卡片外壳:圆角 12、l2 边框、layer-3 底;悬停/展开态换层,折叠箭头旋转。
    var CARD_CSS =
      '.aow-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}' +
      '.aow-card:hover{border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}' +
      '.aow-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}' +
      '.aow-cardHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}' +
      '.aow-cardHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}' +
      '.aow-cardHeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}' +
      '.aow-cardName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}' +
      '.aow-cardDescription{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:13px;line-height:1.5}' +
      '.aow-cardChevron{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none;transition:transform .16s;display:inline-flex}' +
      '.aow-cardChevronOpen{transform:rotate(180deg)}' +
      '.aow-cardBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}' +
      '.aow-cardReadOnly{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:12px 0 0;font-size:12px;line-height:1.5}' +
      '.aow-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}' +
      '.aow-cardFooter{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}' +
      '.aow-cardFailed{min-width:0;color:var(--dsw-alias-state-error-primary);flex:1;margin:0;font-size:12px;line-height:1.5}' +
      // 按钮:描边(outline)与主色(save)两种,禁用半透明。
      '.aow-btn{appearance:none;font:inherit;cursor:pointer;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5;border:1px solid transparent}' +
      '.aow-btn:disabled{opacity:.55;cursor:default}' +
      '.aow-btnOutline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}' +
      '.aow-btnOutline:hover:not(:disabled){color:var(--dsw-alias-label-primary)}' +
      // 主按钮(保存):与官方 PluginConfigForm 的 save 同款配色 ——
      // 底色 label-primary、文字 bg-layer-3,深色模式下这对令牌自动反转
      // (浅色=近黑底白字,深色=近白底深字);不再引用并不存在的 label-inverse
      // (深色下它会退化成 #fff,造成白字白底、保存按钮看不见)。
      '.aow-btnPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3,#fff);font-weight:600}' +
      '.aow-btnPrimary:hover:not(:disabled){filter:brightness(.95)}'
    // 字段区:label 行 + 控件 + hint;相邻字段以 l2 分隔;徽章/恢复默认同观感。
    var FIELDS_CSS =
      '.aow-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}' +
      '.aow-field+.aow-field{border-top:1px solid var(--dsw-alias-border-l2)}' +
      '.aow-fieldHead{align-items:center;gap:8px;display:flex}' +
      '.aow-fieldLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}' +
      '.aow-badges{align-items:center;gap:8px;display:inline-flex}' +
      '.aow-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}' +
      '.aow-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}' +
      '.aow-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}' +
      '.aow-reset:disabled{cursor:default}' +
      '.aow-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}' +
      '.aow-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}' +
      '.aow-input:disabled{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:default}' +
      '.aow-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}' +
      '.aow-invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}' +
      '.aow-hint{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:0;font-size:12px;line-height:1.5}'
    // 布局与杂项:行排列、复选/单选、测试结果状态。
    var CONTROLS_CSS =
      '.aow-row{display:flex;gap:8px;align-items:center}' +
      '.aow-check{display:flex;align-items:center;gap:8px;cursor:pointer}' +
      '.aow-check input{accent-color:var(--dsw-alias-brand-primary);width:15px;height:15px;margin:0;flex:none}' +
      '.aow-check input:disabled{cursor:default}' +
      '.aow-test-ok{color:var(--dsw-alias-state-success-primary);margin:4px 0 0;font-size:12px;line-height:1.5}' +
      '.aow-test-fail{color:var(--dsw-alias-state-error-primary);margin:4px 0 0;font-size:12px;line-height:1.5}'
    var CARD_TAG = 'dsh-auto-open-web/Card.module.css'
    var FIELDS_TAG = 'dsh-auto-open-web/Fields.module.css'
    var CONTROLS_TAG = 'dsh-auto-open-web/Controls.module.css'
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
    injectCss(CONTROLS_TAG, CONTROLS_CSS)

    // ── 共享模块 ─────────────────────────────────────────────────────────
    // 快照 store:@deepseek-ai/dsh-client-store(壳层静态模块,自 dsh 0.1.2-alpha.2
    // 起提供;最新 rc 线与最新版都包含它)。rc.8 时代的 dsh-client-runtime 回退
    // 已按兼容策略移除;若该模块缺失(异常部署)退化为内置最小实现,绝不抛错。
    var createSnapshotStore = null
    try {
      createSnapshotStore = require('@deepseek-ai/dsh-client-store').createSnapshotStore
    } catch (e) {
      console.error('[auto-open-web] dsh-client-store require failed:', e !== null && e !== undefined && e.message !== undefined ? e.message : String(e))
    }
    if (createSnapshotStore === undefined || createSnapshotStore === null) {
      createSnapshotStore = fallbackSnapshotStore
    }
    function fallbackSnapshotStore(init) {
      let value = init
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set: (next) => {
          value = next
          for (const listener of [...listeners]) listener(value)
        }
      }
    }

    // ── 自绘基础控件 ─────────────────────────────────────────────────────
    /** 14px 折叠箭头(手绘 SVG,currentColor 跟随令牌)。 */
    function IconChevronDown(props) {
      return React.createElement('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        fill: 'none',
        'aria-hidden': true,
        className: props.className
      },
        React.createElement('path', {
          d: 'M3.5 5.25L7 8.75L10.5 5.25',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        })
      )
    }
    /** 按钮:variant = outline | primary。 */
    function Btn(props) {
      const cls = 'aow-btn ' + (props.variant === 'primary' ? 'aow-btnPrimary' : 'aow-btnOutline')
      return React.createElement('button', {
        type: 'button',
        className: cls,
        disabled: props.disabled === true,
        onClick: props.onClick
      }, props.children)
    }
    /** 文本输入框。 */
    function TextInput(props) {
      return React.createElement('input', {
        id: props.id,
        className: 'aow-input' + (props.invalid === true ? ' aow-inputInvalid' : ''),
        type: 'text',
        value: props.value,
        placeholder: props.placeholder !== undefined ? props.placeholder : '',
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value)
      })
    }
    /** 复选行(label + 说明文字)。 */
    function Checkbox(props) {
      return React.createElement('label', { className: 'aow-check' },
        React.createElement('input', {
          type: 'checkbox',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: (event) => props.onChange(event.target.checked)
        }),
        React.createElement('span', { className: 'aow-hint' }, props.children)
      )
    }
    /** 单选行。 */
    function Radio(props) {
      return React.createElement('label', { className: 'aow-check' },
        React.createElement('input', {
          type: 'radio',
          name: 'auto-open-web-window-kind',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: () => props.onChange(props.value)
        }),
        React.createElement('span', { className: 'aow-hint' }, props.children)
      )
    }
    /** 字段头部徽章组:"已覆盖" + "恢复默认"(或仅静态徽章)。 */
    function FieldBadges(props) {
      const children = []
      if (props.static !== undefined && props.static !== null) {
        children.push(React.createElement('span', { className: 'aow-badge' }, props.static))
      }
      if (props.overridden === true) {
        children.push(
          React.createElement('span', { className: 'aow-badge' }, props.overriddenLabel),
          React.createElement('button', { type: 'button', className: 'aow-reset', disabled: props.disabled === true, onClick: props.onReset }, props.resetLabel)
        )
      }
      if (children.length === 0) return null
      return React.createElement('span', { className: 'aow-badges' }, ...children)
    }

    // ── 自绘卡片外壳(观感对齐官方设置卡片) ─────────────────────────────
    // 折叠为卡片本地状态;展开时显示只读提示、控件、页脚(放弃/保存)。
    // 命名空间不可用时整卡不渲染(部署未组合本插件时不留痕迹)。
    function Card(props) {
      const [open, setOpen] = React.useState(false)
      const { state } = props
      if (!state.available) return null
      const title = props.t(props.titleKey)
      const blocked = !state.dirty || state.invalid || state.saving
      return React.createElement('li', { className: 'aow-card' + (open ? ' aow-cardOpen' : '') },
        React.createElement('button', {
          type: 'button',
          className: 'aow-cardHeader',
          'aria-expanded': open,
          'aria-label': (open ? props.t('collapse') : props.t('expand')) + ': ' + title,
          onClick: () => setOpen(!open)
        },
          React.createElement('span', { className: 'aow-cardHeadText' },
            React.createElement('span', { className: 'aow-cardName' }, title),
            React.createElement('span', { className: 'aow-cardDescription' }, props.t(props.descriptionKey))
          ),
          state.dirty ? React.createElement('span', { className: 'aow-pending' }, props.t('unsaved')) : null,
          React.createElement(IconChevronDown, { className: 'aow-cardChevron' + (open ? ' aow-cardChevronOpen' : '') })
        ),
        open ? React.createElement('div', { className: 'aow-cardBody' },
          !state.writable ? React.createElement('p', { className: 'aow-cardReadOnly', role: 'status' }, props.t('readOnly')) : null,
          props.children,
          React.createElement('div', { className: 'aow-cardFooter' },
            state.failed ? React.createElement('p', { className: 'aow-cardFailed', role: 'status' }, props.t('saveFailed')) : null,
            React.createElement(Btn, { disabled: !state.dirty || state.saving, onClick: props.onDiscard }, props.t('discard')),
            React.createElement(Btn, { variant: 'primary', disabled: blocked, onClick: props.onSave }, state.saving ? props.t('saving') : props.t('save'))
          )
        ) : null
      )
    }

    // ── 自绘字段布局(label 行 + 控件 + hint + 可选页脚) ──────────────────
    function Field(props) {
      const hintText = props.invalid === true ? props.invalidLabel : props.hint
      return React.createElement('div', { className: 'aow-field' },
        React.createElement('div', { className: 'aow-fieldHead' },
          React.createElement('span', { className: 'aow-fieldLabel' }, props.label),
          props.badges !== undefined && props.badges !== null ? props.badges : null
        ),
        props.control,
        // hint 为空时不渲染段落(提示文字已内联在控件里,如复选框行)
        hintText !== undefined && hintText !== null && hintText !== ''
          ? React.createElement('p', { className: props.invalid === true ? 'aow-invalid' : 'aow-hint' }, hintText)
          : null,
        props.footer !== undefined && props.footer !== null ? props.footer : null
      )
    }

    // ── 表单模型(字段规格 + staged 草稿 + 保存计划 + 落地校验) ───────────
    // 与官方数据契约一致:scope 提供 { getSnapshot() → { status, writable,
    // value, base, user }, set/unset };写后以 user 层落地为准。
    /** 自由文本字段:空草稿 = 清除(恢复默认)。 */
    function textField(field) {
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => {
          const trimmed = String(text).trim()
          return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
        }
      }
    }
    /** 布尔字段(checkbox):值直接作为草稿。 */
    function boolField(field) {
      return {
        field,
        format: (value) => value === true,
        parse: (value) => ({ kind: 'set', value: value === true })
      }
    }
    /** 窗口类型字段(radio):仅两个合法值。 */
    function windowKindField(field) {
      return {
        field,
        format: (value) => (value === 'browser' ? 'browser' : 'webview2'),
        parse: (value) => (value === 'browser' || value === 'webview2' ? { kind: 'set', value } : undefined)
      }
    }
    /** 表单:staged 草稿 → 保存计划;写后以 user 层落地为准。 */
    function FormModel(scope, specs) {
      this.scope = scope
      this.specs = new Map(specs.map((spec) => [spec.field, spec]))
      this.staged = new Map()
      this.listeners = new Set()
      this.saving = false
      this.failed = false
      scope.subscribe(() => {
        this.publish()
      })
    }
    FormModel.prototype.bind = function (project) {
      const store = createSnapshotStore(project())
      this.listeners.add(() => {
        store.set(project())
      })
      return store
    }
    FormModel.prototype.shell = function () {
      const snapshot = this.scope.getSnapshot()
      const plan = this.plan()
      return {
        available: snapshot.status === 'ready',
        writable: snapshot.writable,
        dirty: plan.length > 0,
        invalid: plan.some((item) => item.run === undefined),
        saving: this.saving,
        failed: this.failed
      }
    }
    FormModel.prototype.field = function (field) {
      const staged = this.staged.get(field)
      const spec = this.specs.get(field)
      if (spec === undefined) throw new Error('plugin card has no field ' + field)
      if (staged === undefined) return {
        text: spec.format(this.sectionValue(field)),
        overridden: this.stored(field),
        invalid: false
      }
      const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
      return {
        text: staged.text,
        overridden: write !== undefined && write.kind === 'set',
        invalid: write === undefined
      }
    }
    FormModel.prototype.actions = function () {
      return {
        edit: (field, text) => {
          this.stage(field, { text, clear: false })
        },
        resetField: (field) => {
          this.stage(field, { text: this.specs.get(field).format(this.baseValue(field)), clear: true })
        },
        save: () => {
          this.save()
        },
        discard: () => {
          if (this.staged.size === 0 && !this.failed) return
          this.staged.clear()
          this.failed = false
          this.publish()
        }
      }
    }
    FormModel.prototype.save = function () {
      const plan = this.plan()
      const writes = plan.flatMap((item) => item.run === undefined ? [] : [item.run])
      if (plan.length === 0 || this.saving || writes.length !== plan.length) return
      this.saving = true
      this.failed = false
      this.publish()
      const run = async () => {
        let landed = true
        for (const write of writes) landed = (await write()) && landed
        if (landed) this.staged.clear()
        this.saving = false
        this.failed = !landed
        this.publish()
      }
      run().catch(() => {
        this.saving = false
        this.failed = true
        this.publish()
      })
    }
    FormModel.prototype.plan = function () {
      const plan = []
      for (const [field, staged] of this.staged) {
        const spec = this.specs.get(field)
        if (staged.clear) {
          if (this.stored(field)) plan.push({ field, run: () => this.clear(field) })
          continue
        }
        if (staged.text === spec.format(this.sectionValue(field))) continue
        const write = spec.parse(staged.text)
        if (write === undefined) plan.push({ field, run: undefined })
        else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) })
        else plan.push({ field, run: () => this.store(field, write.value) })
      }
      return plan
    }
    FormModel.prototype.stage = function (field, edit) {
      this.staged.set(field, edit)
      this.failed = false
      this.publish()
    }
    FormModel.prototype.clear = async function (field) {
      await this.scope.unset(field)
      return !this.stored(field)
    }
    FormModel.prototype.store = async function (field, value) {
      await this.scope.set(field, value)
      const user = this.userLayer()
      return user !== undefined && user !== null && user[field] === value
    }
    FormModel.prototype.snapshotOf = function () {
      return this.scope.getSnapshot()
    }
    FormModel.prototype.sectionValue = function (field) {
      const snapshot = this.snapshotOf()
      return snapshot.value !== undefined && snapshot.value !== null ? snapshot.value[field] : undefined
    }
    FormModel.prototype.baseValue = function (field) {
      const snapshot = this.snapshotOf()
      return snapshot.base !== undefined && snapshot.base !== null ? snapshot.base[field] : undefined
    }
    FormModel.prototype.userLayer = function () {
      return this.snapshotOf().user
    }
    FormModel.prototype.stored = function (field) {
      const user = this.userLayer()
      return user !== undefined && user !== null && Object.prototype.hasOwnProperty.call(user, field)
    }
    FormModel.prototype.publish = function () {
      for (const listener of this.listeners) listener()
    }

    // ── 卡片控制器:scope → FormModel → 投影 store + 动作面 ───────────────
    function AutoOpenCardController(scope) {
      this.form = new FormModel(scope, [boolField('appWindow'), windowKindField('windowKind'), textField('browserPath'), boolField('exitOnWindowClose')])
      this.store = this.form.bind(() => this.projection())
    }
    AutoOpenCardController.prototype.projection = function () {
      return {
        ...this.form.shell(),
        appWindow: this.form.field('appWindow'),
        windowKind: this.form.field('windowKind'),
        browserPath: this.form.field('browserPath'),
        exitOnWindowClose: this.form.field('exitOnWindowClose')
      }
    }
    AutoOpenCardController.prototype.inject = function () {
      return {
        hooks: { autoOpenCard: this.store },
        ...this.form.actions()
      }
    }

    // ── 两代插槽共用的字段构件 ───────────────────────────────────────────
    /** 字段规格(两代共用:schema 字段名 → 文本格式化/解析规则)。 */
    function fieldSpecs() {
      return [
        boolField('appWindow'),
        windowKindField('windowKind'),
        textField('browserPath'),
        boolField('exitOnWindowClose')
      ]
    }
    /** 字段头部"已覆盖 + 恢复默认"徽章(静态徽章可选)。 */
    function badgesFor(t, state, field, resetField, staticLabel) {
      return React.createElement(FieldBadges, {
        static: staticLabel,
        overridden: state[field].overridden,
        disabled: !state.writable,
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        onReset: () => resetField(field)
      })
    }
    /**
     * 四个字段的节点(两代插槽共用同一份 UI 与文案)。
     * @param t - 文案
     * @param state - 每字段 { text, overridden, invalid } + writable
     * @param edit - (field, value) 暂存编辑
     * @param resetField - (field) 恢复默认(清除用户层)
     * @param ui - useBrowserTools 的返回值(浏览/测试按钮与结果)
     */
    function buildFieldNodes(t, state, edit, resetField, ui) {
      return [
        React.createElement(Field, {
          key: 'appWindow',
          label: t('appWindow'),
          badges: badgesFor(t, state, 'appWindow', resetField),
          control: React.createElement(Checkbox, { checked: state.appWindow.text === true, disabled: !state.writable, onChange: (v) => edit('appWindow', v) }, t('appWindowHint'))
        }),
        React.createElement(Field, {
          key: 'windowKind',
          label: t('windowKind'),
          badges: badgesFor(t, state, 'windowKind', resetField),
          control: React.createElement(React.Fragment, null,
            React.createElement(Radio, { checked: state.windowKind.text === 'webview2', disabled: !state.writable, value: 'webview2', onChange: (v) => edit('windowKind', v) }, t('windowKindWebview2')),
            React.createElement(Radio, { checked: state.windowKind.text === 'browser', disabled: !state.writable, value: 'browser', onChange: (v) => edit('windowKind', v) }, t('windowKindBrowser'))
          )
        }),
        React.createElement(Field, {
          key: 'browserPath',
          label: t('browserPath'),
          badges: badgesFor(t, state, 'browserPath', resetField),
          hint: t('browserPathHint'),
          invalid: state.browserPath.invalid,
          invalidLabel: t('browserPathInvalid'),
          control: React.createElement('div', { className: 'aow-row' },
            React.createElement(TextInput, {
              id: 'auto-open-web-browser-path',
              value: state.browserPath.text,
              placeholder: t('browserPathPlaceholder'),
              disabled: ui.browserDisabled,
              invalid: state.browserPath.invalid,
              onChange: (text) => edit('browserPath', text)
            }),
            React.createElement(Btn, { disabled: !state.writable || ui.picking, onClick: ui.browse }, ui.picking ? t('browsePicking') : t('browse')),
            React.createElement(Btn, { disabled: ui.testing || state.windowKind.text !== 'browser', onClick: ui.testBrowser }, ui.testing ? t('testRunning') : t('test'))
          ),
          footer: ui.testResult !== null
            ? React.createElement('p', { className: ui.testResult.ok ? 'aow-test-ok' : 'aow-test-fail', role: 'status' },
                (ui.testResult.ok ? '✓ ' : '✗ ') + ui.testResult.text
              )
            : null
        }),
        React.createElement(Field, {
          key: 'exitOnWindowClose',
          label: t('exitOnWindowClose'),
          badges: badgesFor(t, state, 'exitOnWindowClose', resetField, t('experimental')),
          control: React.createElement(Checkbox, { checked: state.exitOnWindowClose.text === true, disabled: !state.writable, onChange: (v) => edit('exitOnWindowClose', v) }, t('exitOnWindowCloseHint'))
        })
      ]
    }
    /** 宿主辅助路由(原生浏览对话框 / 拉起测试):两代插槽共用。 */
    function useBrowserTools(t, state, edit) {
      const [picking, setPicking] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [testResult, setTestResult] = React.useState(null) // { ok, text } | null
      const browse = () => {
        if (!state.writable || picking) return
        setPicking(true)
        fetch('/auto-open-web/pick-browser', { method: 'POST' })
          .then((response) => response.json())
          .then((result) => {
            if (result !== null && result !== undefined && result.ok === true && typeof result.path === 'string') {
              edit('browserPath', result.path)
            }
          })
          .catch(() => { /* 选择失败静默;用户可重试 */ })
          .then(() => { setPicking(false) })
      }
      const testBrowser = () => {
        if (testing) return
        setTesting(true)
        setTestResult(null)
        fetch('/auto-open-web/test-browser', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ browserPath: state.browserPath.text })
        })
          .then((response) => response.json())
          .then((result) => {
            if (result !== null && result !== undefined && result.ok === true) {
              setTestResult({ ok: true, text: typeof result.message === 'string' ? result.message : t('testOk') })
            } else {
              setTestResult({ ok: false, text: t('testFail') + ': ' + (result !== null && result !== undefined && typeof result.error === 'string' ? result.error : 'unknown') })
            }
          })
          .catch((error) => { setTestResult({ ok: false, text: t('testFail') + ': ' + String(error !== null && error !== undefined && error.message !== undefined ? error.message : error) }) })
          .then(() => { setTesting(false) })
      }
      return {
        picking,
        testing,
        testResult,
        browse,
        testBrowser,
        browserDisabled: !state.writable || state.windowKind.text !== 'browser'
      }
    }

    // ── 新版(dsh ≥ 0.1.6-alpha):插件管理页 → 行配置页 ───────────────────
    // 页面下发 `form = { state, mutate }`:state 是宿主投影的行 Config 快照
    // (value/base/user/status/writable/revision),mutate(ops, revision) 原子写入。
    // 与官方同一约定:只有保存会写入,离开页面即丢弃暂存(暂存只在本组件 state)。
    function rowFieldStored(snapshot, field) {
      const user = snapshot.user
      return user !== undefined && user !== null && Object.prototype.hasOwnProperty.call(user, field)
    }
    /** 单字段视图(staged 优先,否则取快照值);与 FormModel.field 同语义。 */
    function rowFieldView(snapshot, staged, spec) {
      const edit = staged.get(spec.field)
      const value = snapshot.value !== undefined && snapshot.value !== null ? snapshot.value[spec.field] : undefined
      if (edit === undefined) {
        return { text: spec.format(value), overridden: rowFieldStored(snapshot, spec.field), invalid: false }
      }
      const write = edit.clear ? { kind: 'clear' } : spec.parse(edit.text)
      return { text: edit.text, overridden: write !== undefined && write.kind === 'set', invalid: write === undefined }
    }
    /** 暂存草稿 → 写入计划(与 FormModel.plan 同语义,产物是 path op)。 */
    function rowPlan(snapshot, staged, specs) {
      const plan = []
      for (const [field, edit] of staged) {
        const spec = specs.find((item) => item.field === field)
        const value = snapshot.value !== undefined && snapshot.value !== null ? snapshot.value[field] : undefined
        if (edit.clear) {
          if (rowFieldStored(snapshot, field)) plan.push({ field, op: { op: 'unset', path: [field] } })
          continue
        }
        if (edit.text === spec.format(value)) continue
        const write = spec.parse(edit.text)
        if (write === undefined) plan.push({ field, op: undefined })
        else if (write.kind === 'clear') plan.push({ field, op: { op: 'unset', path: [field] } })
        else plan.push({ field, op: { op: 'set', path: [field], value: write.value } })
      }
      return plan
    }
    /**
     * bundle 配置页的数据源解析(按优先级):
     *   1. 页面下发的 `props.form`(官方路径:页面把宿主投影的 Config 作为
     *      `{ state, mutate }` 传入——`plugins.item`/`plugins.row.config` 会这样传);
     *   2. 页面**只传 view**(0.1.7-alpha.1 的 `plugins.bundle.config` 正是如此)时,
     *      自行经客户端服务 `configForms` 按命名空间(= 本条目 id)解析,拿到
     *      ConfigForm(getSnapshot/subscribe/set/unset,与本插件 FormModel 的 scope
     *      接口一致);候选顺序:行 id → 包名。
     * 两者都没有才返回 null(组件显示"该命名空间未提供"——通常意味着 Config
     * 字段没标 `.volatile()`,宿主压根没投影出命名空间)。
     * @param props - 插槽 owner props(可能带 form)
     * @param forms - configForms 服务(惰性读取,rc 线上为 undefined)
     * @returns {{ state, mutate, subscribe }} 或 null
     */
    function resolveRowForm(props, forms) {
      const supplied = props.form
      if (supplied !== undefined && supplied !== null && supplied.state !== undefined && supplied.state !== null) {
        return {
          state: supplied.state,
          mutate: (ops, revision) => supplied.mutate(ops, revision),
          subscribe: null
        }
      }
      if (forms === undefined || forms === null || typeof forms.get !== 'function') return null
      for (const ns of ROW_FORM_NS_CANDIDATES) {
        let bound = null
        try {
          bound = forms.get(ns)
        } catch (e) {
          bound = null
        }
        if (bound === undefined || bound === null || typeof bound.getSnapshot !== 'function') continue
        const snapshot = bound.getSnapshot()
        if (snapshot === undefined || snapshot === null || snapshot.status !== 'ready') continue
        return {
          state: snapshot,
          mutate: (ops, revision) => bound.mutate(ops, revision),
          subscribe: typeof bound.subscribe === 'function' ? (listener) => bound.subscribe(listener) : null
        }
      }
      return null
    }
    function AutoOpenRowForm(props) {
      const { t } = props
      const form = resolveRowForm(props, props.configForms)
      const [, forceTick] = React.useState(0)
      const subscribe = form !== null ? form.subscribe : null
      // 命名空间后续才就绪 / 值被外部改动时跟新(revision 变化即重渲染)。
      React.useEffect(() => {
        if (subscribe === null || subscribe === undefined) return undefined
        return subscribe(() => forceTick((n) => n + 1))
      }, [subscribe])
      const snapshot = form !== null && form.state !== undefined && form.state !== null ? form.state : null
      const [staged, setStaged] = React.useState(() => new Map())
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const stagedRef = React.useRef(staged)
      stagedRef.current = staged
      const specs = React.useMemo(() => fieldSpecs(), [])
      const available = snapshot !== null && snapshot.status === 'ready'
      const writable = snapshot !== null && snapshot.writable === true
      const plan = available ? rowPlan(snapshot, staged, specs) : []
      const invalid = plan.some((item) => item.op === undefined)
      const dirty = plan.length > 0
      const state = {
        available,
        writable,
        dirty,
        invalid,
        saving,
        failed,
        appWindow: { text: true, overridden: false, invalid: false },
        windowKind: { text: 'webview2', overridden: false, invalid: false },
        browserPath: { text: '', overridden: false, invalid: false },
        exitOnWindowClose: { text: false, overridden: false, invalid: false }
      }
      if (snapshot !== null) {
        for (const spec of specs) state[spec.field] = rowFieldView(snapshot, staged, spec)
      }
      const edit = (field, text) => {
        const next = new Map(stagedRef.current)
        next.set(field, { text, clear: false })
        setStaged(next)
        setFailed(false)
      }
      const resetField = (field) => {
        const spec = specs.find((item) => item.field === field)
        const base = snapshot !== null && snapshot.base !== undefined && snapshot.base !== null ? snapshot.base[field] : undefined
        const next = new Map(stagedRef.current)
        next.set(field, { text: spec.format(base), clear: true })
        setStaged(next)
        setFailed(false)
      }
      const save = () => {
        if (!available || saving) return
        const ops = plan.filter((item) => item.op !== undefined).map((item) => item.op)
        if (plan.length === 0 || ops.length !== plan.length) return
        setSaving(true)
        setFailed(false)
        Promise.resolve(form.mutate(ops, snapshot.revision))
          .then((accepted) => {
            if (accepted === true) setStaged(new Map())
            setFailed(accepted !== true)
          })
          .catch(() => { setFailed(true) })
          .then(() => { setSaving(false) })
      }
      const ui = useBrowserTools(t, state, edit)
      // 行缺描述时页面取一行摘要。
      if (props.view === 'summary') return t('description')
      if (!available) return React.createElement('p', { className: 'aow-hint', role: 'status' }, t('unavailable'))
      return React.createElement('div', null,
        !writable ? React.createElement('p', { className: 'aow-cardReadOnly', role: 'status' }, t('readOnly')) : null,
        ...buildFieldNodes(t, state, edit, resetField, ui),
        React.createElement('div', { className: 'aow-cardFooter' },
          failed ? React.createElement('p', { className: 'aow-cardFailed', role: 'status' }, t('saveFailed')) : null,
          React.createElement(Btn, { variant: 'primary', disabled: !dirty || invalid || saving, onClick: save }, saving ? t('saving') : t('save'))
        )
      )
    }

    // ── 最新 rc 线(0.1.5-rc.x):设置页 → 插件配置卡片 ─────────────────────
    // 宿主用 settings.register(ns, schema) 注册命名空间,客户端经 settingsScope
    // 读写(该服务在新版已被 configForms 取代,故在 apply 里惰性读取)。
    function AutoOpenSettingsPage(props) {
      const { t } = props
      const state = props.useAutoOpenCard((snapshot) => snapshot)
      const ui = useBrowserTools(t, state, props.edit)
      if (props.view === 'summary') return t('description')
      const fields = buildFieldNodes(t, state, props.edit, props.resetField, ui)
      return React.createElement(Card, {
        t,
        titleKey: 'title',
        descriptionKey: 'description',
        state,
        onSave: props.save,
        onDiscard: props.discard
      }, ...fields)
    }

    // ---- 文案(locale 机制,zh/en/ja/ko/fr/de/ru) ----
    const NS = 'auto-open-web'
    /** bundle 包名(manifest 名,与安装名一致)。 */
    const BUNDLE_NAME = 'dsh-auto-open-web'
    /** 本插件在 cordis.patch.yml 里声明的行 id;新版 settings 命名空间 = 本条目 id。 */
    const ROW_ID = 'auto-open-web'
    /** rc 线的设置命名空间(设置页卡片按它派发)。 */
    const SETTINGS_NS = 'auto-open-web'
    /** 自行解析 ConfigForm 时的命名空间候选(条目 id 通常是行 id,兜底包名)。 */
    const ROW_FORM_NS_CANDIDATES = [ROW_ID, BUNDLE_NAME]
    const en = {
      title: 'Auto-open web',
      description: 'Open the DSH Web GUI in an app-style window on profile start; the browser path can be configured manually.',
      save: 'Save', saving: 'Saving…', discard: 'Discard', unsaved: 'Unsaved',
      readOnly: 'This deployment stores settings read-only.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      unavailable: 'This deployment does not serve these settings, so nothing can be configured here.',
      expand: 'Show settings', collapse: 'Hide settings',
      overridden: 'Overridden', reset: 'Reset to default',
      appWindow: 'Independent app window',
      appWindowHint: 'Automatically open an independent app window on start; off behaves like the official core — the GUI opens in the default browser instead',
      windowKind: 'Window kind',
      windowKindWebview2: 'WebView2 host (own process, DSH taskbar icon, exits with DSH; needs Windows + WebView2 runtime)',
      windowKindBrowser: 'Browser app window (dedicated --app instance, isolated from the normal browser)',
      browserPath: 'Browser executable',
      browserPathHint: 'Editable only in "Browser app window" mode; leave blank for built-in candidates (Edge → Chrome); a missing path is skipped with a warning. "Test" launches a dedicated test instance (auto-closes after a few seconds).',
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: 'Invalid path',
      browse: 'Browse', browsePicking: 'Choosing…', test: 'Test', testRunning: 'Testing…',
      testOk: 'Browser launched successfully', testFail: 'Test failed',
      exitOnWindowClose: 'Exit DSH on window close',
      exitOnWindowCloseHint: 'Exit DSH when the auto-opened window closes (off by default)',
      experimental: 'Experimental',
    }
    const zh = {
      title: '自动打开网页',
      description: 'DSH 启动后自动打开独立应用窗口或网页;可手动指定浏览器位置',
      save: '保存', saving: '保存中…', discard: '放弃修改', unsaved: '未保存',
      readOnly: '本部署的设置为只读。',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      unavailable: '本部署未提供该设置命名空间，暂时无法在此配置。',
      expand: '展开设置', collapse: '收起设置',
      overridden: '已覆盖', reset: '恢复默认',
      appWindow: '独立应用窗口',
      appWindowHint: '启动时自动打开独立应用窗口;关闭后与官方相同:改用系统默认浏览器打开 GUI',
      windowKind: '窗口类型',
      windowKindWebview2: 'WebView2 宿主(独立进程,任务栏 DSH 图标,随 DSH 退出;需 Windows + WebView2 运行时)',
      windowKindBrowser: '浏览器应用窗口(--app 专用实例,不与其他浏览器页面共用进程)',
      browserPath: '浏览器可执行文件',
      browserPathHint: '仅"浏览器应用窗口"模式可编辑;留空使用内置候选(Edge → Chrome);路径不存在会被跳过并告警。「测试」会真实拉起一个专用测试实例验证可用性(数秒后自动关闭)',
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: '路径无效',
      browse: '浏览', browsePicking: '选择中…', test: '测试', testRunning: '测试中…',
      testOk: '浏览器拉起成功', testFail: '测试失败',
      exitOnWindowClose: '窗口关闭时退出 DSH',
      exitOnWindowCloseHint: '关闭自动打开的窗口时,DSH 随之退出(默认关闭)',
      experimental: '实验性',
    }
    const ja = {
      title: 'ウェブを自動で開く',
      description: 'DSH 起動時に独立アプリウィンドウまたはウェブページを自動で開きます。ブラウザの場所は手動で指定できます',
      save: '保存', saving: '保存中…', discard: '変更を破棄', unsaved: '未保存',
      readOnly: 'このデプロイメントの設定は読み取り専用です。',
      saveFailed: 'デプロイメントがこの値を受け入れませんでした。修正用に保持されています。',
      unavailable: 'このデプロイメントはこの設定を提供していないため、ここでは構成できません。',
      expand: '設定を表示', collapse: '設定を隠す',
      overridden: '上書き済み', reset: 'デフォルトに戻す',
      appWindow: '独立アプリウィンドウ',
      appWindowHint: '起動時に独立アプリウィンドウを自動的に開く;オフの場合は公式と同じく既定ブラウザで GUI を開く',
      windowKind: 'ウィンドウの種類',
      windowKindWebview2: 'WebView2 ホスト(独立プロセス、タスクバーは DSH アイコン、DSH とともに終了;Windows + WebView2 ランタイムが必要)',
      windowKindBrowser: 'ブラウザアプリウィンドウ(専用 --app インスタンス、通常のブラウザとプロセスを共有しない)',
      browserPath: 'ブラウザ実行ファイル',
      browserPathHint: '「ブラウザアプリウィンドウ」モードのみ編集可能;空欄で組み込み候補(Edge → Chrome)を使用;存在しないパスは警告とともにスキップ。「テスト」は専用テストインスタンスを起動します(数秒後に自動終了)',
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: 'パスが無効です',
      browse: '参照', browsePicking: '選択中…', test: 'テスト', testRunning: 'テスト中…',
      testOk: 'ブラウザの起動に成功しました', testFail: 'テスト失敗',
      exitOnWindowClose: 'ウィンドウを閉じたら DSH を終了',
      exitOnWindowCloseHint: '自動で開いたウィンドウを閉じたときに DSH を終了します(デフォルト:オフ)',
      experimental: '実験的',
    }
    const ko = {
      title: '웹 자동 열기',
      description: 'DSH 시작 시 독립 앱 창 또는 웹 페이지를 자동으로 엽니다. 브라우저 경로는 수동으로 지정할 수 있습니다',
      save: '저장', saving: '저장 중…', discard: '변경 취소', unsaved: '저장 안 됨',
      readOnly: '이 배포의 설정은 읽기 전용입니다.',
      saveFailed: '배포가 이 값을 수락하지 않았습니다. 수정할 수 있도록 유지됩니다.',
      unavailable: '이 배포는 이 설정을 제공하지 않아 여기에서 구성할 수 없습니다.',
      expand: '설정 표시', collapse: '설정 숨기기',
      overridden: '재정의됨', reset: '기본값으로 재설정',
      appWindow: '독립 앱 창',
      appWindowHint: '시작 시 독립 앱 창을 자동으로 엽니다. 끄면 공식과 동일하게 기본 브라우저로 GUI를 엽니다',
      windowKind: '창 종류',
      windowKindWebview2: 'WebView2 호스트(독립 프로세스, 작업 표시줄 DSH 아이콘, DSH와 함께 종료; Windows + WebView2 런타임 필요)',
      windowKindBrowser: '브라우저 앱 창(전용 --app 인스턴스, 일반 브라우저와 프로세스 공유 안 함)',
      browserPath: '브라우저 실행 파일',
      browserPathHint: "'브라우저 앱 창' 모드에서만 편집 가능; 비워 두면 내장 후보(Edge → Chrome) 사용; 없는 경로는 건너뛰고 경고. '테스트'는 전용 테스트 인스턴스를 실행합니다(몇 초 후 자동 종료)",
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: '잘못된 경로',
      browse: '찾아보기', browsePicking: '선택 중…', test: '테스트', testRunning: '테스트 중…',
      testOk: '브라우저 시작 성공', testFail: '테스트 실패',
      exitOnWindowClose: '창을 닫으면 DSH 종료',
      exitOnWindowCloseHint: '자동으로 열린 창을 닫을 때 DSH를 종료합니다(기본값: 꺼짐)',
      experimental: '실험적',
    }
    const fr = {
      title: 'Ouvrir le web automatiquement',
      description: "Ouvre automatiquement la GUI DSH dans une fenêtre de type application au démarrage; le chemin du navigateur peut être configuré manuellement",
      save: 'Enregistrer', saving: 'Enregistrement…', discard: 'Annuler les modifications', unsaved: 'Non enregistré',
      readOnly: 'Les paramètres de ce déploiement sont en lecture seule.',
      saveFailed: "Le déploiement n'a pas accepté ces valeurs; elles ont été conservées pour correction.",
      unavailable: "Ce déploiement ne fournit pas ces paramètres ; ils ne peuvent pas être configurés ici.",
      expand: 'Afficher les paramètres', collapse: 'Masquer les paramètres',
      overridden: 'Remplacé', reset: 'Rétablir la valeur par défaut',
      appWindow: "Fenêtre d'application indépendante",
      appWindowHint: "Ouvre automatiquement une fenêtre d'application indépendante au démarrage; désactivé = comme le cœur officiel, ouverture dans le navigateur par défaut",
      windowKind: 'Type de fenêtre',
      windowKindWebview2: 'Hôte WebView2 (processus propre, icône DSH dans la barre des tâches, se ferme avec DSH; nécessite Windows + runtime WebView2)',
      windowKindBrowser: 'Fenêtre de navigateur (instance --app dédiée, isolée du navigateur normal)',
      browserPath: 'Exécutable du navigateur',
      browserPathHint: 'Modifiable uniquement en mode « Fenêtre de navigateur »; vide = candidats intégrés (Edge → Chrome); chemin manquant ignoré avec avertissement. « Tester » lance une instance de test dédiée (se ferme après quelques secondes)',
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: 'Chemin invalide',
      browse: 'Parcourir', browsePicking: 'Sélection…', test: 'Tester', testRunning: 'Test en cours…',
      testOk: 'Navigateur lancé avec succès', testFail: 'Échec du test',
      exitOnWindowClose: "Quitter DSH à la fermeture de la fenêtre",
      exitOnWindowCloseHint: 'Quitte DSH lorsque la fenêtre ouverte automatiquement est fermée (désactivé par défaut)',
      experimental: 'Expérimental',
    }
    const de = {
      title: 'Web automatisch öffnen',
      description: 'Öffnet die DSH-GUI beim Start in einem app-ähnlichen Fenster; der Browserpfad kann manuell konfiguriert werden',
      save: 'Speichern', saving: 'Speichern…', discard: 'Änderungen verwerfen', unsaved: 'Nicht gespeichert',
      readOnly: 'Die Einstellungen dieser Bereitstellung sind schreibgeschützt.',
      saveFailed: 'Die Bereitstellung hat diese Werte nicht akzeptiert; sie wurden zur Korrektur beibehalten.',
      unavailable: 'Diese Bereitstellung stellt diese Einstellungen nicht bereit; sie können hier nicht konfiguriert werden.',
      expand: 'Einstellungen anzeigen', collapse: 'Einstellungen ausblenden',
      overridden: 'Überschrieben', reset: 'Standard wiederherstellen',
      appWindow: 'Eigenständiges App-Fenster',
      appWindowHint: 'Beim Start automatisch ein eigenständiges App-Fenster öffnen; aus = wie offiziell, Öffnen der GUI im Standardbrowser',
      windowKind: 'Fenstertyp',
      windowKindWebview2: 'WebView2-Host (eigener Prozess, DSH-Symbol in der Taskleiste, wird mit DSH beendet; benötigt Windows + WebView2-Runtime)',
      windowKindBrowser: 'Browser-App-Fenster (dedizierte --app-Instanz, getrennt vom normalen Browser)',
      browserPath: 'Browser ausführbar',
      browserPathHint: 'Nur im Modus „Browser-App-Fenster" bearbeitbar; leer = eingebaute Kandidaten (Edge → Chrome); fehlender Pfad wird mit Warnung übersprungen. „Test" startet eine dedizierte Testinstanz (schließt sich nach einigen Sekunden)',
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: 'Ungültiger Pfad',
      browse: 'Durchsuchen', browsePicking: 'Auswahl…', test: 'Testen', testRunning: 'Test läuft…',
      testOk: 'Browser erfolgreich gestartet', testFail: 'Test fehlgeschlagen',
      exitOnWindowClose: 'DSH beim Schließen des Fensters beenden',
      exitOnWindowCloseHint: 'DSH beenden, wenn das automatisch geöffnete Fenster geschlossen wird (standardmäßig aus)',
      experimental: 'Experimentell',
    }
    const ru = {
      title: 'Автоматически открывать веб',
      description: 'Открывает GUI DSH в окне приложения при запуске; путь к браузеру можно настроить вручную',
      save: 'Сохранить', saving: 'Сохранение…', discard: 'Отменить изменения', unsaved: 'Не сохранено',
      readOnly: 'Настройки этого развёртывания доступны только для чтения.',
      saveFailed: 'Развёртывание не приняло эти значения; они оставлены для исправления.',
      unavailable: 'Это развёртывание не предоставляет эти настройки; здесь их настроить нельзя.',
      expand: 'Показать настройки', collapse: 'Скрыть настройки',
      overridden: 'Переопределено', reset: 'Вернуть по умолчанию',
      appWindow: 'Независимое окно приложения',
      appWindowHint: 'Автоматически открывать независимое окно приложения при запуске; выкл. — как в официальной версии, открытие GUI в браузере по умолчанию',
      windowKind: 'Тип окна',
      windowKindWebview2: 'Хост WebView2 (собственный процесс, значок DSH на панели задач, закрывается вместе с DSH; требуется Windows + среда WebView2)',
      windowKindBrowser: 'Окно браузера (выделенный экземпляр --app, изолирован от обычного браузера)',
      browserPath: 'Исполняемый файл браузера',
      browserPathHint: 'Редактируется только в режиме «Окно браузера»; пусто = встроенные кандидаты (Edge → Chrome); отсутствующий путь пропускается с предупреждением. «Тест» запускает выделенный тестовый экземпляр (автозакрытие через несколько секунд)',
      browserPathPlaceholder: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      browserPathInvalid: 'Недопустимый путь',
      browse: 'Обзор', browsePicking: 'Выбор…', test: 'Тест', testRunning: 'Тестирование…',
      testOk: 'Браузер успешно запущен', testFail: 'Ошибка теста',
      exitOnWindowClose: 'Завершать DSH при закрытии окна',
      exitOnWindowCloseHint: 'Завершать DSH, когда закрывается автоматически открытое окно (по умолчанию выкл.)',
      experimental: 'Экспериментально',
    }

    function apply(ctx) {
      // 文案(locale 机制,跟随界面语言)
      ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, ko, fr, de, ru }), 'auto-open-web: card dictionary')
      // ── 新版(dsh ≥0.1.6-alpha):插件管理页 → **bundle 详情页**配置 ────────
      // 与 dsh-harness-tags 同款席位:插槽 `plugins.bundle.config`,key = **bundle 包名**
      // (页面按 ledger.bundles.has(pkg.name) 判定是否渲染该区块,位置在说明与组件行之间)。
      // 页面只传 `{ view: 'page' }` —— 数据要**自己绑**:命名空间 = 本条目 id,
      // 由客户端服务 configForms 提供 ConfigForm(getSnapshot/subscribe/set/unset,
      // 与 FormModel 的 scope 接口一致);页面若哪天也下发 form,则优先用它。
      // 注意 configForms 必须**惰性读取**且不在 exports.inject 里:rc 线没有这个服务,
      // 硬注入会让插件在那条线上永远 pending(harness-tags 只在 0.1.7+ 上跑,所以它
      // 可以直接在 manifest 的 inject 里点名 plugin-manager,我们不能)。
      const configForms = typeof ctx.get === 'function' ? ctx.get('configForms') : undefined
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          { name: 'plugins.bundle.config', key: BUNDLE_NAME, locale: NS },
          (props) => AutoOpenRowForm(Object.assign({}, props, { configForms }))
        )
      )
      // ── 最新 rc 线(0.1.5-rc.x):设置页 → 插件配置卡片 ───────────────────
      // 该线仍走旧的 settings 域:宿主 settings.register(ns, schema) 注册命名空间,
      // 客户端经 settingsScope 读写。该服务在新版已被 configForms 取代,故惰性读取:
      // 缺失时只跳过这条注册,不影响新版路径(硬注入会让插件在新版永远 pending)。
      const settingsScope = typeof ctx.get === 'function' ? ctx.get('settingsScope') : undefined
      if (settingsScope !== undefined && settingsScope !== null && typeof settingsScope.bind === 'function') {
        const controller = new AutoOpenCardController(settingsScope.bind({ namespace: SETTINGS_NS }))
        ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            { name: 'settings.plugin.item', key: SETTINGS_NS, label: '自动打开网页', locale: NS, inject: () => controller.inject() },
            AutoOpenSettingsPage
          )
        )
      }
    }

    // 代码级服务依赖(cordis):两代共有的服务,不含任何 UI 包。
    // 注意:settingsScope(rc 线)/ configForms(新版)互不存在,二者都必须惰性读取,
    // 否则硬注入会让插件在另一条线上永远 pending。
    var clientInject = ['slots', 'locale', 'connection', 'remote']

    exports.apply = apply
    exports.inject = clientInject
    exports.name = 'auto-open-web'
    return module.exports
  }
})
