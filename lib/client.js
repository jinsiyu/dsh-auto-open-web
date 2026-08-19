// dsh-auto-open-web — Client bundle(设置卡片,与官方 Shell/Agent loop 卡片同构)
// 格式:window.__ModuleLoader__.load({ id, factory });factory(require) 的
// require 解析浏览器端冻结模块表(react、@deepseek-ai/dsh-client-ui-primitives、
// @deepseek-ai/dsh-client-runtime)。
//
// 架构完全对齐官方 @deepseek-ai/dsh-client-ui-settings-plugins:
//   - 数据通道:settingsScope.bind({namespace})(官方 settings 域,dsh ≥0.1.0-rc.7
//     已取消第三方命名空间白名单)
//   - 表单:CardForm 移植(FieldSpec format/parse、staged 草稿、plan/save 计划、
//     写后以 user 层落地校验、失败保留草稿)
//   - 字段:ValueField 移植(overridden 徽章 + 恢复默认 + invalid 提示;browserPath
//     附带"浏览/测试"按钮槽);checkbox/radio 值型字段自绘但带同款徽章
//   - 外壳:PluginCard 移植(折叠/未保存标记/只读提示/放弃/保存/保存失败)
//   - 文案:locale 注册(zh/en),与官方同机制
//   - 依赖:react/primitives(壳层 seed 词)+ dsh-client-runtime(动态包)
//     + 代码级 5 服务,与官方 settings-plugins 一致
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

    // ---- 内置 PluginCard.module.css(官方卡片外观,原样注入) ----
    var CARD_CSS = '.YyYd_a_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.YyYd_a_card:hover{border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}.YyYd_a_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed,var(--dsw-alias-border-l2))}.YyYd_a_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.YyYd_a_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.YyYd_a_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.YyYd_a_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.YyYd_a_description{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:13px;line-height:1.5}.YyYd_a_chevron{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none;transition:transform .16s}.YyYd_a_chevronOpen{transform:rotate(180deg)}.YyYd_a_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.YyYd_a_readOnly{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:12px 0 0;font-size:12px;line-height:1.5}.YyYd_a_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.YyYd_a_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.YyYd_a_failed{min-width:0;color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary));flex:1;margin:0;font-size:12px;line-height:1.5}.YyYd_a_discard,.YyYd_a_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.YyYd_a_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.YyYd_a_discard:disabled{opacity:.55;cursor:default}.YyYd_a_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.YyYd_a_save{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse,#fff);font-weight:600}.YyYd_a_save:disabled{opacity:.55;cursor:default}'
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
      '.aow-test-ok{color:var(--dsw-alias-state-success-primary);margin:4px 0 0;font-size:12px;line-height:1.5}' +
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

    // ---- 官方共享模块(冻结表) ----
    // 与官方 settings-plugins 同源:react/primitives 是壳层 seed 词,
    // dsh-client-runtime 是动态包(经 /plugins/<pkg>/client.js 提供)。
    // 各 require 独立容错:任一可选模块缺失不得拖垮其余模块(尤其 runtime)。
    var prim = null
    var runtime = null
    try {
      prim = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (e) {
      console.error('[auto-open-web] primitives require failed:', e !== null && e !== undefined && e.message !== undefined ? e.message : String(e))
    }
    try {
      runtime = require('@deepseek-ai/dsh-client-runtime')
    } catch (e) {
      console.error('[auto-open-web] runtime require failed:', e !== null && e !== undefined && e.message !== undefined ? e.message : String(e))
    }
    var Button = prim !== null && prim.Button !== undefined ? prim.Button : null
    var Input = prim !== null && prim.Input !== undefined ? prim.Input : null
    var ChevronIcon = prim !== null && prim.IconChevronDownOutline14 !== undefined ? prim.IconChevronDownOutline14 : null
    // 快照 store 契约与官方一致:{ getSnapshot, subscribe, set }。runtime 缺失
    // 或版本不含 createSnapshotStore 时退化为内置最小实现(卡片仍可用)。
    var createSnapshotStore = runtime !== null && runtime.createSnapshotStore !== undefined ? runtime.createSnapshotStore : fallbackSnapshotStore
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
    /** 字段头部"已覆盖 + 恢复默认"徽章(官方 ValueField 同款)。 */
    function FieldHeadBadges(props) {
      if (!props.overridden) return null
      return React.createElement('span', { className: 'At1oFq_badges' },
        React.createElement('span', { className: 'At1oFq_badge' }, props.overriddenLabel),
        React.createElement('button', { type: 'button', className: 'At1oFq_reset', disabled: props.disabled, onClick: props.onReset }, props.resetLabel)
      )
    }

    // ---- 官方 PluginCard 移植(settings.plugin.item 卡片外壳) ----
    function PluginCard(props) {
      const [open, setOpen] = React.useState(false)
      const { state } = props
      if (!state.available) return null
      const title = props.t(props.titleKey)
      const blocked = !state.dirty || state.invalid || state.saving
      return React.createElement('li', { className: 'YyYd_a_card' + (open ? ' YyYd_a_cardOpen' : '') },
        React.createElement('button', {
          type: 'button',
          className: 'YyYd_a_header',
          'aria-expanded': open,
          'aria-label': (open ? props.t('collapse') : props.t('expand')) + ': ' + title,
          onClick: () => setOpen(!open)
        },
          React.createElement('span', { className: 'YyYd_a_headText' },
            React.createElement('span', { className: 'YyYd_a_name' }, title),
            React.createElement('span', { className: 'YyYd_a_description' }, props.t(props.descriptionKey))
          ),
          state.dirty ? React.createElement('span', { className: 'YyYd_a_pending' }, props.t('unsaved')) : null,
          ChevronIcon !== null
            ? React.createElement(ChevronIcon, { className: 'YyYd_a_chevron' + (open ? ' YyYd_a_chevronOpen' : '') })
            : React.createElement('span', { className: 'YyYd_a_chevron' + (open ? ' YyYd_a_chevronOpen' : '') }, '▾')
        ),
        open ? React.createElement('div', { className: 'YyYd_a_body' },
          !state.writable ? React.createElement('p', { className: 'YyYd_a_readOnly', role: 'status' }, props.t('readOnly')) : null,
          props.children,
          React.createElement('div', { className: 'YyYd_a_footer' },
            state.failed ? React.createElement('p', { className: 'YyYd_a_failed', role: 'status' }, props.t('saveFailed')) : null,
            React.createElement('button', { type: 'button', className: 'YyYd_a_discard', disabled: !state.dirty || state.saving, onClick: props.onDiscard }, props.t('discard')),
            React.createElement('button', { type: 'button', className: 'YyYd_a_save', disabled: blocked, onClick: props.onSave }, state.saving ? props.t('saving') : props.t('save'))
          )
        ) : null
      )
    }

    // ---- 官方 ValueField 移植(带 overridden 徽章/重置/invalid;extra 为按钮槽) ----
    function ValueField(props) {
      return React.createElement('div', { className: 'At1oFq_field' },
        React.createElement('div', { className: 'At1oFq_head' },
          React.createElement('label', { className: 'At1oFq_label', htmlFor: props.id }, props.label),
          props.overridden
            ? React.createElement('span', { className: 'At1oFq_badges' },
                React.createElement('span', { className: 'At1oFq_badge' }, props.overriddenLabel),
                React.createElement('button', { type: 'button', className: 'At1oFq_reset', disabled: props.disabled, onClick: props.onReset }, props.resetLabel)
              )
            : null
        ),
        React.createElement('div', { className: 'aow-row' },
          React.createElement('input', {
            id: props.id,
            className: props.invalid ? 'At1oFq_input At1oFq_inputInvalid' : 'At1oFq_input',
            type: 'text',
            value: props.text,
            placeholder: props.placeholder !== undefined ? props.placeholder : '',
            disabled: props.disabled,
            onChange: (event) => props.onEdit(event.target.value)
          }),
          props.extra !== undefined ? props.extra : null
        ),
        React.createElement('p', { className: props.invalid ? 'At1oFq_invalid' : 'At1oFq_hint' },
          props.invalid ? props.invalidLabel : props.hint
        ),
        props.footer !== undefined ? props.footer : null
      )
    }

    // ---- 官方 CardForm 移植(字段规格 + 草稿计划 + 保存落地校验) ----
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
    function CardForm(scope, specs) {
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
    CardForm.prototype.bind = function (project) {
      const store = createSnapshotStore(project())
      this.listeners.add(() => {
        store.set(project())
      })
      return store
    }
    CardForm.prototype.shell = function () {
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
    CardForm.prototype.field = function (field) {
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
    CardForm.prototype.actions = function () {
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
    CardForm.prototype.save = function () {
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
    CardForm.prototype.plan = function () {
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
    CardForm.prototype.stage = function (field, edit) {
      this.staged.set(field, edit)
      this.failed = false
      this.publish()
    }
    CardForm.prototype.clear = async function (field) {
      await this.scope.unset(field)
      return !this.stored(field)
    }
    CardForm.prototype.store = async function (field, value) {
      await this.scope.set(field, value)
      const user = this.userLayer()
      return user !== undefined && user !== null && user[field] === value
    }
    CardForm.prototype.snapshotOf = function () {
      return this.scope.getSnapshot()
    }
    CardForm.prototype.sectionValue = function (field) {
      const snapshot = this.snapshotOf()
      return snapshot.value !== undefined && snapshot.value !== null ? snapshot.value[field] : undefined
    }
    CardForm.prototype.baseValue = function (field) {
      const snapshot = this.snapshotOf()
      return snapshot.base !== undefined && snapshot.base !== null ? snapshot.base[field] : undefined
    }
    CardForm.prototype.userLayer = function () {
      return this.snapshotOf().user
    }
    CardForm.prototype.stored = function (field) {
      const user = this.userLayer()
      return user !== undefined && user !== null && Object.prototype.hasOwnProperty.call(user, field)
    }
    CardForm.prototype.publish = function () {
      for (const listener of this.listeners) listener()
    }

    // ---- 卡片控制器:scope → CardForm → 投影 store + 动作面 ----
    function AutoOpenCardController(scope) {
      this.form = new CardForm(scope, [boolField('appWindow'), windowKindField('windowKind'), textField('browserPath'), boolField('exitOnWindowClose')])
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

    // ---- 卡片组件(官方 BashCard 同构:PluginCard 包字段) ----
    function AutoOpenSettingsPage(props) {
      const { t } = props
      const state = props.useAutoOpenCard((snapshot) => snapshot)
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
              props.edit('browserPath', result.path)
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
          body: JSON.stringify({ browserPath: state.browserPath.text }),
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

      const browserDisabled = !state.writable || state.windowKind.text !== 'browser'

      return React.createElement(PluginCard, {
        t,
        titleKey: 'title',
        descriptionKey: 'description',
        state,
        onSave: props.save,
        onDiscard: props.discard
      },
        // ---- 独立应用窗口 ----
        React.createElement('div', { className: 'At1oFq_field' },
          React.createElement('div', { className: 'At1oFq_head' },
            React.createElement('span', { className: 'At1oFq_label' }, t('appWindow')),
            React.createElement(FieldHeadBadges, { overridden: state.appWindow.overridden, disabled: !state.writable, overriddenLabel: t('overridden'), resetLabel: t('reset'), onReset: () => props.resetField('appWindow') })
          ),
          React.createElement(Checkbox, { checked: state.appWindow.text === true, disabled: !state.writable, onChange: (v) => props.edit('appWindow', v) }, t('appWindowHint'))
        ),
        // ---- 窗口类型 ----
        React.createElement('div', { className: 'At1oFq_field' },
          React.createElement('div', { className: 'At1oFq_head' },
            React.createElement('span', { className: 'At1oFq_label' }, t('windowKind')),
            React.createElement(FieldHeadBadges, { overridden: state.windowKind.overridden, disabled: !state.writable, overriddenLabel: t('overridden'), resetLabel: t('reset'), onReset: () => props.resetField('windowKind') })
          ),
          React.createElement(Radio, { checked: state.windowKind.text === 'webview2', disabled: !state.writable, value: 'webview2', onChange: (v) => props.edit('windowKind', v) }, t('windowKindWebview2')),
          React.createElement(Radio, { checked: state.windowKind.text === 'browser', disabled: !state.writable, value: 'browser', onChange: (v) => props.edit('windowKind', v) }, t('windowKindBrowser'))
        ),
        // ---- 浏览器可执行文件(ValueField + 浏览/测试按钮) ----
        React.createElement(ValueField, {
          id: 'auto-open-web-browser-path',
          label: t('browserPath'),
          hint: t('browserPathHint'),
          overridden: state.browserPath.overridden,
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalid: state.browserPath.invalid,
          invalidLabel: t('browserPathInvalid'),
          disabled: browserDisabled,
          text: state.browserPath.text,
          placeholder: t('browserPathPlaceholder'),
          onEdit: (text) => props.edit('browserPath', text),
          onReset: () => props.resetField('browserPath'),
          extra: React.createElement(React.Fragment, null,
            React.createElement(ProxyButton, { variant: 'outline', size: 'sm', disabled: !state.writable || picking, onClick: browse }, picking ? t('browsePicking') : t('browse')),
            React.createElement(ProxyButton, { variant: 'outline', size: 'sm', disabled: testing || state.windowKind.text !== 'browser', onClick: testBrowser }, testing ? t('testRunning') : t('test'))
          ),
          footer: testResult !== null
            ? React.createElement('p', { className: testResult.ok ? 'aow-test-ok' : 'aow-test-fail', role: 'status' },
                (testResult.ok ? '✓ ' : '✗ ') + testResult.text
              )
            : null
        }),
        // ---- 窗口关闭时退出 DSH(实验性) ----
        React.createElement('div', { className: 'At1oFq_field' },
          React.createElement('div', { className: 'At1oFq_head' },
            React.createElement('span', { className: 'At1oFq_label' }, t('exitOnWindowClose')),
            React.createElement('span', { className: 'At1oFq_badges' },
              React.createElement('span', { className: 'At1oFq_badge' }, t('experimental'))
            ),
            React.createElement(FieldHeadBadges, { overridden: state.exitOnWindowClose.overridden, disabled: !state.writable, overriddenLabel: t('overridden'), resetLabel: t('reset'), onReset: () => props.resetField('exitOnWindowClose') })
          ),
          React.createElement(Checkbox, { checked: state.exitOnWindowClose.text === true, disabled: !state.writable, onChange: (v) => props.edit('exitOnWindowClose', v) }, t('exitOnWindowCloseHint'))
        )
      )
    }

    // ---- 文案(官方 locale 机制,zh/en 字典) ----
    const NS = 'auto-open-web'
    const en = {
      title: 'Auto-open web',
      description: 'Open the DSH Web GUI in an app-style window on profile start; the browser path can be configured manually.',
      save: 'Save', saving: 'Saving…', discard: 'Discard', unsaved: 'Unsaved',
      readOnly: 'This deployment stores settings read-only.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      expand: 'Show settings', collapse: 'Hide settings',
      overridden: 'Overridden', reset: 'Reset to default',
      appWindow: 'Independent app window',
      appWindowHint: 'Automatically open an independent app window on start; off opens nothing.',
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
      expand: '展开设置', collapse: '收起设置',
      overridden: '已覆盖', reset: '恢复默认',
      appWindow: '独立应用窗口',
      appWindowHint: '启动时自动打开独立应用窗口;关闭后不自动打开任何窗口',
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
      expand: '設定を表示', collapse: '設定を隠す',
      overridden: '上書き済み', reset: 'デフォルトに戻す',
      appWindow: '独立アプリウィンドウ',
      appWindowHint: '起動時に独立アプリウィンドウを自動的に開く;オフの場合は何も開かない',
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
      expand: '설정 표시', collapse: '설정 숨기기',
      overridden: '재정의됨', reset: '기본값으로 재설정',
      appWindow: '독립 앱 창',
      appWindowHint: '시작 시 독립 앱 창을 자동으로 엽니다. 끄면 아무 창도 열지 않습니다',
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
      expand: 'Afficher les paramètres', collapse: 'Masquer les paramètres',
      overridden: 'Remplacé', reset: 'Rétablir la valeur par défaut',
      appWindow: "Fenêtre d'application indépendante",
      appWindowHint: "Ouvre automatiquement une fenêtre d'application indépendante au démarrage; désactivé n'ouvre rien",
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
      expand: 'Einstellungen anzeigen', collapse: 'Einstellungen ausblenden',
      overridden: 'Überschrieben', reset: 'Standard wiederherstellen',
      appWindow: 'Eigenständiges App-Fenster',
      appWindowHint: 'Beim Start automatisch ein eigenständiges App-Fenster öffnen; aus = nichts öffnen',
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
      expand: 'Показать настройки', collapse: 'Скрыть настройки',
      overridden: 'Переопределено', reset: 'Вернуть по умолчанию',
      appWindow: 'Независимое окно приложения',
      appWindowHint: 'Автоматически открывать независимое окно приложения при запуске; выкл. — ничего не открывать',
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
      // 文案(locale 机制,与官方同构;跟随界面语言)
      ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, ko, fr, de, ru }), 'auto-open-web: card dictionary')
      // 数据通道:settingsScope(官方 settings 域)
      const scope = ctx.settingsScope.bind({ namespace: 'auto-open-web' })
      const controller = new AutoOpenCardController(scope)
      // 插槽:keyed 注册 + inject 面(hooks + 表单动作)
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          { name: 'settings.plugin.item', key: 'auto-open-web', label: '自动打开网页', locale: NS, inject: () => controller.inject() },
          AutoOpenSettingsPage
        )
      )
    }

    // 代码级服务依赖(cordis):与官方 settings-plugins 完全一致
    var clientInject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

    exports.apply = apply
    exports.inject = clientInject
    exports.name = 'auto-open-web'
    return module.exports
  }
})
