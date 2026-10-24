// dsh-tailscale · Client 半区（手写 ModuleLoader bundle，无构建步骤、零运行时依赖）
// 设置 → 远程访问：Tailscale 状态 / 远程入口 / 登录链接 / 设备清单 / 诊断。
// 数据全部走同源 RPC：POST tailscale/<endpoint>（相对路径，不带前导 /）。
// 安全：登录链接含启动令牌，只存在于组件内存，不写 console / localStorage / 任何日志。
window.__ModuleLoader__.load({
  id: '@ponydev/dsh-tailscale',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'dsh-tailscale'
    const RPC_TIMEOUT_MS = 8000
    const LOGIN_TTL_MS = 60000
    const COPY_FLASH_MS = 1600

    // ---------------------------------------------------------------- i18n
    const zh = {
      title: '远程访问',
      desc: '把本机 DSH Web 发布到 tailnet，用手机或其他设备访问',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '载入中…',
      retry: '重试',
      statusRunning: '运行中',
      statusNotInstalled: '未安装',
      statusNotRunning: '未运行',
      statusNotLoggedIn: '未登录',
      statusHttpsDisabled: 'HTTPS 未启用',
      statusRouteConflict: '路由冲突',
      statusTrustNotEffective: '信任未生效',
      statusUnknown: '未知',
      hintNotInstalled: '安装 Tailscale（standalone 版）后重试；CLI 不在 PATH 时可在插件配置里指定 cliPath。',
      hintNotRunning: '启动 Tailscale 后重试。',
      hintNotLoggedIn: '在 Tailscale 客户端登录后重试。',
      hintHttpsDisabled: '在 Tailscale 管理台启用 HTTPS 证书（需要先开启 MagicDNS）。',
      hintRouteConflict: '该域名或路径已被其他服务占用，先清理冲突的 serve 路由再开启入口。',
      hintTrustNotEffective: '信任未生效：重启 dsh web，或在启动参数里加 --trusted-host <节点域名>。',
      hintUnknown: '查看下方诊断项获取具体原因。',
      entryLabel: '入口',
      entryOn: '已开启',
      entryOff: '已关闭',
      entryWorking: '处理中…',
      backendLabel: '后端',
      targetLabel: '目标',
      valueNone: '—',
      entrySection: '远程入口',
      entryOffHint: '入口未开启：开启后才能从 tailnet 访问本机 DSH。',
      urlLabel: '入口 URL',
      loginTitle: '首次登录',
      generateLogin: '生成登录链接',
      generating: '生成中…',
      loginNotice: '链接含本次启动令牌，只发给可信设备。',
      loginHideIn: '{n} 秒后自动隐藏',
      loginUrlLabel: '登录链接',
      loginUnavailable: '入口未开启，无法生成登录链接',
      adoptedNote: '已认领上次运行残留的路由。',
      copy: '复制',
      copied: '已复制',
      copySelect: '已选中，请按复制快捷键',
      devicesTitle: '设备',
      deviceSummary: '{online} 在线 / {total} 总计',
      refreshDevices: '刷新设备',
      devicesEmpty: '暂无设备',
      selfBadge: '本机',
      offline: '离线',
      lastSeen: '最后在线 {t}',
      copyDomain: '复制域名',
      relJustNow: '刚刚',
      relMinAgo: '{n} 分钟前',
      relHourAgo: '{n} 小时前',
      relDayAgo: '{n} 天前',
      diagTitle: '诊断',
      recheck: '重新检查',
      checking: '检查中…',
      diagEmpty: '暂无检查项',
      healthOk: '全部正常',
      healthIssues: '{n} 项待处理',
      copyCommand: '复制命令',
      unauthorized: '未授权',
      unauthorizedHint: '请从已登录的 DSH 页面打开。',
      networkError: '网络请求失败',
      timeoutError: '请求超时',
      loadFailed: '加载失败',
      hostUnavailable: '宿主接口不可用',
      hostUnavailableHint: '确认插件已装入 DSH profile，然后重启 dsh web。',
      serveFailed: '入口创建失败',
      unknownError: '未知错误',
      unknownDevice: '未知设备',
      headerTitle: 'Tailscale',
      headerOnline: '在线',
      headerOffline: '离线',
      headerUnknown: '状态未知',
      headerEntryOn: '入口已开启',
      headerEntryOff: '入口未开启',
      headerDeviceCount: '{online}/{total} 设备在线',
      headerHint: '点击打开 Tailscale 设置',
    }
    const en = {
      title: 'Remote access',
      desc: 'Publish this DSH Web on your tailnet and open it from a phone or another device',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading…',
      retry: 'Retry',
      statusRunning: 'Running',
      statusNotInstalled: 'Not installed',
      statusNotRunning: 'Not running',
      statusNotLoggedIn: 'Not signed in',
      statusHttpsDisabled: 'HTTPS not enabled',
      statusRouteConflict: 'Route conflict',
      statusTrustNotEffective: 'Trust not applied',
      statusUnknown: 'Unknown',
      hintNotInstalled: 'Install Tailscale (standalone build) and retry; if the CLI is not on PATH, set cliPath in the plugin config.',
      hintNotRunning: 'Start Tailscale, then retry.',
      hintNotLoggedIn: 'Sign in to the Tailscale client, then retry.',
      hintHttpsDisabled: 'Enable HTTPS certificates in the Tailscale admin console (MagicDNS must be on).',
      hintRouteConflict: 'This domain or path is already used by another service. Clear the conflicting serve route first.',
      hintTrustNotEffective: 'Trust not applied: restart dsh web, or add --trusted-host <node domain> to the launch command.',
      hintUnknown: 'See the diagnostics below for details.',
      entryLabel: 'Entry',
      entryOn: 'On',
      entryOff: 'Off',
      entryWorking: 'Working…',
      backendLabel: 'Backend',
      targetLabel: 'Target',
      valueNone: '—',
      entrySection: 'Remote entry',
      entryOffHint: 'Entry is off: enable it to reach this DSH from your tailnet.',
      urlLabel: 'Entry URL',
      loginTitle: 'First sign-in',
      generateLogin: 'Generate sign-in link',
      generating: 'Generating…',
      loginNotice: 'The link contains this launch token; share it only with trusted devices.',
      loginHideIn: 'Hides in {n}s',
      loginUrlLabel: 'Sign-in link',
      loginUnavailable: 'Entry is off, cannot generate a sign-in link',
      adoptedNote: 'Adopted a route left by a previous run.',
      copy: 'Copy',
      copied: 'Copied',
      copySelect: 'Selected — press the copy shortcut',
      devicesTitle: 'Devices',
      deviceSummary: '{online} online / {total} total',
      refreshDevices: 'Refresh devices',
      devicesEmpty: 'No devices',
      selfBadge: 'This device',
      offline: 'Offline',
      lastSeen: 'Last seen {t}',
      copyDomain: 'Copy domain',
      relJustNow: 'just now',
      relMinAgo: '{n} min ago',
      relHourAgo: '{n} h ago',
      relDayAgo: '{n} d ago',
      diagTitle: 'Diagnostics',
      recheck: 'Re-check',
      checking: 'Checking…',
      diagEmpty: 'No checks',
      healthOk: 'All good',
      healthIssues: '{n} need attention',
      copyCommand: 'Copy command',
      unauthorized: 'Unauthorized',
      unauthorizedHint: 'Open this page from a signed-in DSH session.',
      networkError: 'Network request failed',
      timeoutError: 'Request timed out',
      loadFailed: 'Failed to load',
      hostUnavailable: 'Host API unavailable',
      hostUnavailableHint: 'Make sure the plugin is installed in the DSH profile, then restart dsh web.',
      serveFailed: 'Could not create entry',
      unknownError: 'Unknown error',
      unknownDevice: 'Unknown device',
      headerTitle: 'Tailscale',
      headerOnline: 'Online',
      headerOffline: 'Offline',
      headerUnknown: 'Status unavailable',
      headerEntryOn: 'Entry on',
      headerEntryOff: 'Entry off',
      headerDeviceCount: '{online}/{total} devices online',
      headerHint: 'Open Tailscale settings',
    }

    // 活动语言：优先读 DSH 写在 <html lang> 上的值，其次浏览器语言，最后英文。
    // 设置页槽位会通过 props.t 提供框架翻译；t 缺失时用本地字典兜底。
    function activeLang() {
      const doc = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || ''
      const tag = String(doc).toLowerCase()
      if (tag) return tag.startsWith('zh') ? 'zh' : 'en'
      const nav = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase()
      return nav.startsWith('zh') ? 'zh' : 'en'
    }
    const LOCALE_TICK = { subs: new Set() }
    function useLocaleTick() {
      const [, bump] = useState(0)
      useEffect(() => {
        const fn = () => bump((n) => n + 1)
        LOCALE_TICK.subs.add(fn)
        return () => { LOCALE_TICK.subs.delete(fn) }
      }, [])
    }
    function formatVars(text, vars) {
      if (!vars) return text
      let out = text
      for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k]))
      return out
    }
    function trWith(t) {
      if (typeof t === 'function') {
        return (key, vars) => {
          let out = null
          try { out = vars ? t(key, vars) : t(key) } catch (e) { out = null }
          if (out != null && out !== key) return out
          const d = activeLang() === 'zh' ? zh : en
          return formatVars(d[key] != null ? d[key] : (en[key] != null ? en[key] : key), vars)
        }
      }
      const d = activeLang() === 'zh' ? zh : en
      return (key, vars) => formatVars(d[key] != null ? d[key] : (en[key] != null ? en[key] : key), vars)
    }

    // ---------------------------------------------------------------- RPC
    function rpcErr(kind, code, message, status) {
      const e = new Error(message || kind || 'rpc failed')
      e.kind = kind || 'unknown'
      e.code = code || ''
      e.status = status || 0
      return e
    }
    function isAbortError(e) {
      if (!e) return false
      if (e.name === 'AbortError') return true
      // 某些浏览器的 DOMException 只给 code 20（ABORT_ERR）
      return e.code === 20
    }
    // 所有请求：AbortController + 8s 超时；HTTP 401/403 = 未授权 / 围栏拒绝。
    async function post(endpoint, payload) {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort() } catch (e) {} }, RPC_TIMEOUT_MS) : null
      try {
        let res
        try {
          res = await fetch('tailscale/' + endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload || {}),
            credentials: 'same-origin',
            signal: ctrl ? ctrl.signal : undefined,
          })
        } catch (e) {
          if (isAbortError(e)) throw rpcErr('timeout', 'tailscale/timeout', 'timeout', 0)
          throw rpcErr('network', 'tailscale/no-connection', 'network', 0)
        }
        if (res.status === 401 || res.status === 403) {
          throw rpcErr('unauthorized', 'tailscale/permission', 'unauthorized', res.status)
        }
        if (!res.ok) {
          const kind = res.status === 404 ? 'unavailable' : 'http'
          throw rpcErr(kind, '', 'HTTP ' + res.status, res.status)
        }
        let body = null
        try {
          body = await res.json()
        } catch (e) {
          if (isAbortError(e)) throw rpcErr('timeout', 'tailscale/timeout', 'timeout', 0)
          throw rpcErr('shape', '', 'invalid response', res.status)
        }
        if (body && body.ok) return body.value
        const error = (body && body.error) || {}
        const code = typeof error.code === 'string' ? error.code : ''
        const message = typeof error.message === 'string' ? error.message : ''
        if (code === 'tailscale/permission') throw rpcErr('unauthorized', code, message || 'unauthorized', res.status)
        throw rpcErr('rpc', code, message || code || ('rpc failed: ' + endpoint), res.status)
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    const api = {
      snapshot: (opts) => post('snapshot', opts || {}),
      health: (opts) => post('health', opts || {}),
      loginUrl: () => post('login-url', {}),
      publish: (opts) => post('publish', opts || {}),
      unpublish: () => post('unpublish', {}),
      devices: (opts) => post('devices', opts || {}),
      status: () => post('status', {}),
    }

    // ---------------------------------------------------------------- 归一化（字段缺失 = 空态，不崩）
    function asObj(v) {
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    }
    function asStr(v) {
      return typeof v === 'string' ? v : ''
    }
    function asStrList(v) {
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []
    }
    function normDevice(d) {
      const o = asObj(d)
      const hostName = asStr(o.hostName)
      const dnsName = asStr(o.dnsName)
      return {
        id: asStr(o.id) || dnsName || hostName,
        hostName,
        dnsName,
        ips: asStrList(o.ips),
        os: asStr(o.os),
        online: !!o.online,
        tags: asStrList(o.tags),
        lastSeen: o.lastSeen,
        direct: !!o.direct,
        relay: asStr(o.relay),
        isSelf: !!o.isSelf,
      }
    }
    function normPublication(p) {
      const o = asObj(p)
      return {
        enabled: !!o.enabled,
        url: asStr(o.url),
        path: asStr(o.path),
        target: asStr(o.target),
        owned: !!o.owned,
        adopted: !!o.adopted,
        createdAt: o.createdAt,
        host: asStr(o.host),
        // Host 侧 classifyServe 四态：absent / exact / stale / conflict / unknown
        routeState: asStr(o.routeState),
        reason: asStr(o.reason),
        conflict: !!o.conflict,
      }
    }
    function normCheck(c) {
      const o = asObj(c)
      let level = o.level === 'ok' || o.level === 'warn' || o.level === 'error' ? o.level : ''
      let ok = typeof o.ok === 'boolean' ? o.ok : level !== 'warn' && level !== 'error'
      if (!level) level = ok ? 'ok' : 'warn'
      if (ok && level !== 'ok') level = 'ok'
      return {
        id: asStr(o.id),
        ok,
        level,
        message: asStr(o.message),
        hint: asStr(o.hint),
        command: asStr(o.command),
      }
    }
    function normHealth(hv) {
      const o = asObj(hv)
      const checks = Array.isArray(o.checks) ? o.checks.map(normCheck).filter((c) => c.id || c.message) : []
      const ok = typeof o.ok === 'boolean' ? o.ok : checks.every((c) => c.ok)
      return { ok, checks }
    }
    function normSnapshot(v) {
      const o = asObj(v)
      const st = asObj(o.status)
      const self = asObj(st.self)
      const cfg = asObj(o.config)
      const dnsName = asStr(st.dnsName) || asStr(self.dnsName)
      return {
        status: {
          backend: asStr(st.backend),
          version: asStr(st.version),
          cliPath: asStr(st.cliPath),
          dnsName,
          // Host 在 status 读不到时把错误塞进 snapshot.status.error（snapshot 本身仍 ok:true）
          error: st.error && typeof st.error === 'object'
            ? { code: asStr(st.error.code), message: asStr(st.error.message) }
            : null,
          self: {
            hostName: asStr(self.hostName),
            dnsName: asStr(self.dnsName) || dnsName,
            ips: asStrList(self.ips),
            os: asStr(self.os),
            online: !!self.online,
            isSelf: self.isSelf !== false,
          },
        },
        publication: normPublication(o.publication),
        devices: Array.isArray(o.devices) ? o.devices.map(normDevice) : [],
        health: normHealth(o.health),
        config: {
          autoPublish: !!cfg.autoPublish,
          httpsPort: cfg.httpsPort,
          publishPath: asStr(cfg.publishPath),
          trustHost: !!cfg.trustHost,
        },
      }
    }
    const EMPTY_SNAPSHOT = normSnapshot(null)

    // ---------------------------------------------------------------- 时间 / 状态
    function parseTime(v) {
      if (v == null || v === '') return 0
      if (typeof v === 'number') return v > 1e12 ? v : v * 1000
      const n = Date.parse(String(v))
      return isFinite(n) ? n : 0
    }
    function relText(v, tr) {
      const t = parseTime(v)
      if (!t) return ''
      const d = new Date(t)
      if (isNaN(d.getTime()) || d.getFullYear() < 2000) return ''
      const diff = Date.now() - t
      if (diff < 0) return ''
      if (diff < 60000) return tr('relJustNow')
      if (diff < 3600000) return tr('relMinAgo', { n: Math.floor(diff / 60000) })
      if (diff < 86400000) return tr('relHourAgo', { n: Math.floor(diff / 3600000) })
      return tr('relDayAgo', { n: Math.floor(diff / 86400000) })
    }
    const STATUS_HINTS = {
      statusRunning: '',
      statusNotInstalled: 'hintNotInstalled',
      statusNotRunning: 'hintNotRunning',
      statusNotLoggedIn: 'hintNotLoggedIn',
      statusHttpsDisabled: 'hintHttpsDisabled',
      statusRouteConflict: 'hintRouteConflict',
      statusTrustNotEffective: 'hintTrustNotEffective',
      statusUnknown: 'hintUnknown',
    }
    const STATUS_TONES = {
      statusRunning: 'ok',
      statusNotInstalled: 'err',
      statusNotRunning: 'warn',
      statusNotLoggedIn: 'warn',
      statusHttpsDisabled: 'warn',
      statusRouteConflict: 'err',
      statusTrustNotEffective: 'warn',
      statusUnknown: 'idle',
    }
    const ERROR_STATUS = {
      'tailscale/not-installed': 'statusNotInstalled',
      'tailscale/not-running': 'statusNotRunning',
      'tailscale/not-logged-in': 'statusNotLoggedIn',
      'tailscale/https-disabled': 'statusHttpsDisabled',
      'tailscale/route-conflict': 'statusRouteConflict',
      'tailscale/trust-unavailable': 'statusTrustNotEffective',
    }
    const CODE_TEXT = {
      'tailscale/not-installed': 'statusNotInstalled',
      'tailscale/not-running': 'statusNotRunning',
      'tailscale/not-logged-in': 'statusNotLoggedIn',
      'tailscale/https-disabled': 'statusHttpsDisabled',
      'tailscale/serve-failed': 'serveFailed',
      'tailscale/route-conflict': 'statusRouteConflict',
      'tailscale/trust-unavailable': 'statusTrustNotEffective',
      'tailscale/permission': 'unauthorizedHint',
      'tailscale/timeout': 'timeoutError',
      'tailscale/no-connection': 'networkError',
      'tailscale/no-publication': 'loginUnavailable',
    }
    function checksOf(snap) {
      const hv = snap && snap.health
      return hv && Array.isArray(hv.checks) ? hv.checks : []
    }
    function checkById(checks, id) {
      for (const c of checks) if (c && c.id === id) return c
      return null
    }
    // 状态语言（§8）：正常 / 未安装 / 未运行 / 未登录 / HTTPS 未启用 / 路由冲突 / 信任未生效 / 未知。
    function statusInfo(snap) {
      const st = (snap && snap.status) || {}
      const pub = (snap && snap.publication) || {}
      const backend = typeof st.backend === 'string' ? st.backend.toLowerCase() : ''
      const statusErrCode = st.error && st.error.code ? String(st.error.code) : ''
      const checks = checksOf(snap)
      const cli = checkById(checks, 'cli')
      const dnsCheck = checkById(checks, 'dnsName')
      const trust = checkById(checks, 'trust')
      let key = 'statusRunning'
      let checkId = null
      if (statusErrCode) {
        const mapped = ERROR_STATUS[statusErrCode]
        key = mapped || 'statusUnknown'
        checkId = key === 'statusNotInstalled' ? 'cli' : key === 'statusNotRunning' || key === 'statusNotLoggedIn' ? 'backend' : null
      } else if (backend.indexOf('install') >= 0 || (cli && cli.ok === false && !st.cliPath)) {
        key = 'statusNotInstalled'
        checkId = 'cli'
      } else if (backend === 'needslogin' || backend === 'needsmachineauth') {
        key = 'statusNotLoggedIn'
        checkId = 'backend'
      } else if (backend && backend !== 'running' && backend !== 'unknown') {
        key = 'statusNotRunning'
        checkId = 'backend'
      } else if (!backend || backend === 'unknown') {
        if (cli && cli.ok === false) {
          key = 'statusNotInstalled'
          checkId = 'cli'
        } else {
          key = 'statusUnknown'
        }
      } else if (pub.reason === 'no-dns-name' || (dnsCheck && dnsCheck.ok === false)) {
        key = 'statusHttpsDisabled'
        checkId = 'dnsName'
      } else if (pub.routeState === 'conflict') {
        key = 'statusRouteConflict'
        checkId = 'route'
      } else if (pub.enabled && trust && trust.ok === false) {
        // 入口开着但 trustedHosts 没生效 → 远程 /api 会 403
        key = 'statusTrustNotEffective'
        checkId = 'trust'
      }
      return { key, tone: STATUS_TONES[key] || 'idle', hintKey: STATUS_HINTS[key] || '', checkId }
    }
    function errorText(err, tr) {
      const kind = err && err.kind ? err.kind : 'unknown'
      if (kind === 'unauthorized') return tr('unauthorizedHint')
      if (kind === 'timeout') return tr('timeoutError')
      if (kind === 'network') return tr('networkError')
      if (kind === 'unavailable') return tr('hostUnavailableHint')
      const code = err && err.code ? String(err.code) : ''
      if (code && CODE_TEXT[code]) {
        const label = tr(CODE_TEXT[code])
        const msg = err && err.message ? String(err.message) : ''
        return msg && msg !== label ? label + ' · ' + msg : label
      }
      if (err && err.message) return String(err.message)
      return tr('unknownError')
    }
    function statusFromErrorCode(err) {
      const code = err && err.code ? String(err.code) : ''
      const key = ERROR_STATUS[code]
      return key ? { key, hintKey: STATUS_HINTS[key] || '' } : null
    }
    function sortDevices(list) {
      return list.slice().sort((a, b) => {
        const ao = a.online ? 0 : 1
        const bo = b.online ? 0 : 1
        if (ao !== bo) return ao - bo
        const as = a.isSelf ? 0 : 1
        const bs = b.isSelf ? 0 : 1
        if (as !== bs) return as - bs
        return String(a.hostName || a.dnsName || '').localeCompare(String(b.hostName || b.dnsName || ''))
      })
    }

    // ---------------------------------------------------------------- 剪贴板
    async function writeClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (e) {}
      return false
    }
    // 降级：选中节点（输入框用 select()，普通节点用 Range）
    function selectNode(el) {
      if (!el) return false
      try {
        if (typeof el.select === 'function') {
          el.focus()
          el.select()
          return true
        }
        const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null)
        if (!doc || typeof doc.createRange !== 'function') return false
        const range = doc.createRange()
        range.selectNodeContents(el)
        const view = doc.defaultView
        const sel = view && typeof view.getSelection === 'function' ? view.getSelection() : (typeof doc.getSelection === 'function' ? doc.getSelection() : null)
        if (!sel) return false
        sel.removeAllRanges()
        sel.addRange(range)
        return true
      } catch (e) {
        return false
      }
    }

    // ---------------------------------------------------------------- css（只用 --dsw-* 主题 token，fallback 除外）
    const CSS = `
.dst-root{display:flex;flex-direction:column;gap:16px;padding:0;color:var(--dsw-alias-label-primary,#191f28);font-size:13px;line-height:1.5}
.dst-shead{display:flex;align-items:flex-start;gap:12px}
.dst-shead-main{min-width:0;flex:1 1 auto}
.dst-title{font-size:16px;font-weight:650;margin:0;color:var(--dsw-alias-label-primary,#191f28)}
.dst-desc{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-shead-actions{display:flex;align-items:center;gap:8px;flex:none}
.dst-body{display:flex;flex-direction:column;gap:16px}
.dst-card{background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1,#e3e7ed));border-radius:var(--dsw-radius-lg,14px);padding:14px 16px}
.dst-card-head{display:flex;align-items:center;gap:8px;min-height:24px}
.dst-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#191f28)}
.dst-card-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#637182);font-variant-numeric:tabular-nums}
.dst-card-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.dst-grow{flex:1 1 auto;min-width:0}
.dst-status-head{display:flex;align-items:center;gap:8px;min-height:24px}
.dst-status-label{font-size:14px;font-weight:600}
.dst-tone-ok .dst-status-label{color:var(--dsw-alias-label-primary,#191f28)}
.dst-tone-warn .dst-status-label{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,#b45309))}
.dst-tone-err .dst-status-label{color:var(--dsw-alias-state-error-primary,#f04438)}
.dst-tone-idle .dst-status-label{color:var(--dsw-alias-label-secondary,#637182)}
.dst-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.dst-dot.ok{background:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-dot.warn{background:var(--dsw-alias-state-warn-primary,#f79009)}
.dst-dot.err{background:var(--dsw-alias-state-error-primary,#f04438)}
.dst-dot.idle{background:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-mono{font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px}
.dst-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-mutedline{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-hintline{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#637182)}
.dst-hintline.warn{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dst-hintline.err{color:var(--dsw-alias-state-error-primary,#f04438)}
.dst-switch{position:relative;flex:none;width:38px;height:22px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d8dce2);background:var(--dsw-alias-bg-layer-2,#f1f2f4);cursor:pointer;transition:background .16s ease}
.dst-switch[aria-checked="true"]{background:var(--dsw-alias-state-success-primary,#12b76a);border-color:transparent}
.dst-switch:disabled{opacity:.55;cursor:default}
.dst-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(2,6,16,.18));transition:transform .16s ease;display:block}
.dst-switch[aria-checked="true"] .dst-knob{transform:translateX(16px)}
.dst-field{margin-top:10px}
.dst-field-row{display:flex;align-items:center;gap:8px}
.dst-input{flex:1 1 auto;min-width:0;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#e3e7ed);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-base,#f6f7f9);color:var(--dsw-alias-label-primary,#191f28);font:inherit;font-size:12px;outline:none}
.dst-input:focus{border-color:var(--dsw-alias-state-business-primary,#4176E6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176E6) 18%,transparent)}
.dst-btn{flex:none;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1,#e3e7ed);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#191f28);font:inherit;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap}
.dst-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.dst-btn:disabled{opacity:.55;cursor:default}
.dst-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176E6));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}
.dst-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-state-business-primary,#4176E6))}
.dst-btn:focus-visible,.dst-switch:focus-visible,.dst-copy:focus-visible,.dst-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176E6));outline-offset:2px}
.dst-copy{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary,#98a2b3);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dst-copy:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5);color:var(--dsw-alias-label-secondary,#637182)}
.dst-notice{margin-top:8px;font-size:11.5px;color:var(--dsw-alias-state-warn-primary,#b45309)}
.dst-login{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,#e3e7ed)}
.dst-login-head{display:flex;align-items:center;gap:8px}
.dst-login-head .dst-btn{margin-left:auto}
.dst-login-url{margin-top:4px}
.dst-list{display:flex;flex-direction:column;gap:2px;margin-top:10px}
.dst-dev{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:var(--dsw-radius-md,10px);min-height:36px}
.dst-dev:hover{background:var(--dsw-alias-interactive-bg-hover,#f4f5f7)}
.dst-dev-main{flex:1 1 auto;min-width:0}
.dst-dev-top{display:flex;align-items:center;gap:6px;min-width:0}
.dst-dev-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#191f28);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-dev-meta{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-dev-domain{color:var(--dsw-alias-label-secondary,#637182);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.dst-dev-off{flex:none;font-size:10px;font-weight:600;color:var(--dsw-alias-label-tertiary,#98a2b3);background:var(--dsw-alias-bg-layer-2,#f1f2f4);border-radius:999px;padding:1px 6px}
.dst-badge{flex:none;font-size:10px;font-weight:600;color:var(--dsw-alias-state-business-primary,#4176E6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176E6) 10%,transparent);border-radius:999px;padding:1px 6px}
.dst-tags{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.dst-tag{font-size:10px;color:var(--dsw-alias-label-secondary,#637182);border:1px solid var(--dsw-alias-border-l1,#e3e7ed);border-radius:5px;padding:0 4px;line-height:15px}
.dst-sep{color:var(--dsw-alias-label-tertiary,#c0c4cc)}
.dst-dev-actions{flex:none;display:flex;align-items:center}
.dst-checks{display:flex;flex-direction:column;margin-top:6px}
.dst-check{display:flex;align-items:flex-start;gap:9px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3)}
.dst-check:last-child{border-bottom:0;padding-bottom:2px}
.dst-check-ico{flex:none;width:16px;height:16px;line-height:16px;text-align:center;font-size:11px;font-weight:700;border-radius:50%}
.dst-check-ico.ok{color:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-check-ico.warn{color:var(--dsw-alias-state-warn-primary,#f79009)}
.dst-check-ico.err{color:var(--dsw-alias-state-error-primary,#f04438)}
.dst-check-main{flex:1 1 auto;min-width:0}
.dst-check-msg{font-size:12.5px;color:var(--dsw-alias-label-primary,#191f28);word-break:break-word}
.dst-check-hint{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#637182);word-break:break-word}
.dst-check-cmd{margin-top:6px}
.dst-errline{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-error-primary,#f04438);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f04438) 8%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#f04438) 25%,transparent);border-radius:var(--dsw-radius-md,10px);padding:7px 10px;word-break:break-word}
.dst-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-state-head{display:flex;align-items:center;gap:8px}
.dst-state-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#191f28)}
.dst-state-actions{margin-top:12px;display:flex;gap:8px}
.dst-copied{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#98a2b3)}
@media (prefers-reduced-motion:reduce){.dst-switch,.dst-knob{transition:none}}
.dst-hbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#637182);cursor:pointer;flex:none}
.dst-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#191f28)}
.dst-hbtn:focus-visible{outline:2px solid var(--dsw-alias-state-focused-primary,#2e90fa);outline-offset:1px}
.dst-hbtn svg{display:block}
.dst-hbtn-dot{position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%;border:1.5px solid var(--dsw-alias-bg-layer-1,#fff);background:var(--dsw-alias-label-tertiary,#98a2b3)}
.dst-hbtn-dot.on{background:var(--dsw-alias-state-success-primary,#12b76a)}
.dst-hbtn-dot.off{background:var(--dsw-alias-state-error-primary,#f04438)}
.dst-hbtn-dot.warn{background:var(--dsw-alias-state-warn-primary,#f79009)}
`

    // ---------------------------------------------------------------- atoms
    function Dot({ tone }) {
      return h('span', { className: 'dst-dot ' + tone, 'aria-hidden': true })
    }

    function CopyField({ value, tr, ariaLabel, placeholder, mono }) {
      const inputRef = useRef(null)
      const timerRef = useRef(null)
      const [state, setState] = useState('')
      useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
      const flash = (s) => {
        setState(s)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { timerRef.current = null; setState('') }, COPY_FLASH_MS)
      }
      const copy = async () => {
        const text = value || ''
        if (!text) return
        const ok = await writeClipboard(text)
        if (ok) flash('copied')
        else flash(selectNode(inputRef.current) ? 'select' : 'failed')
      }
      return h('div', { className: 'dst-field' },
        h('div', { className: 'dst-field-row' },
          h('input', {
            ref: inputRef,
            type: 'text',
            className: 'dst-input' + (mono ? ' dst-mono' : ''),
            readOnly: true,
            value: value || '',
            placeholder: placeholder || '',
            spellCheck: false,
            'aria-label': ariaLabel || tr('copy'),
            onFocus: (e) => { try { e.target.select() } catch (err) {} },
          }),
          h('button', { type: 'button', className: 'dst-btn', onClick: copy, disabled: !value },
            state === 'copied' ? tr('copied') : tr('copy'))),
        state === 'select' || state === 'failed' ? h('div', { className: 'dst-copied' }, tr('copySelect')) : null)
    }

    function CopyButton({ value, tr, label, fallbackRef }) {
      const timerRef = useRef(null)
      const [done, setDone] = useState(false)
      useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
      const onClick = async () => {
        const text = value || ''
        if (!text) return
        const ok = await writeClipboard(text)
        if (!ok && fallbackRef && fallbackRef.current) selectNode(fallbackRef.current)
        setDone(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { timerRef.current = null; setDone(false) }, COPY_FLASH_MS)
      }
      return h('button', {
        type: 'button',
        className: 'dst-copy',
        title: label || tr('copy'),
        'aria-label': label || tr('copy'),
        onClick,
      }, done ? '✓' : '⧉')
    }

    function InlineError({ tr, err, onRetry }) {
      return h('div', { className: 'dst-errline' },
        h('span', { className: 'dst-grow' }, errorText(err, tr)),
        onRetry ? h('button', { type: 'button', className: 'dst-btn', onClick: onRetry }, tr('retry')) : null)
    }

    function StateCard({ tr, tone, title, hint, onRetry }) {
      return h('div', { className: 'dst-card dst-state dst-tone-' + tone },
        h('div', { className: 'dst-state-head' },
          h(Dot, { tone }),
          h('span', { className: 'dst-state-title' }, title)),
        hint ? h('div', { className: 'dst-mutedline' }, hint) : null,
        onRetry ? h('div', { className: 'dst-state-actions' },
          h('button', { type: 'button', className: 'dst-btn', onClick: onRetry }, tr('retry'))) : null)
    }

    // ---------------------------------------------------------------- 状态卡
    function StatusCard({ snap, tr, entryBusy, entryErr, onToggle }) {
      const st = statusInfo(snap)
      const status = (snap && snap.status) || {}
      const pub = (snap && snap.publication) || {}
      const enabled = !!pub.enabled
      const dns = status.dnsName || (status.self && status.self.dnsName) || ''
      const related = st.checkId ? checkById(checksOf(snap), st.checkId) : null
      const command = related && related.command ? related.command : ''
      return h('div', { className: 'dst-card dst-status dst-tone-' + st.tone },
        h('div', { className: 'dst-status-head' },
          h(Dot, { tone: st.tone }),
          h('span', { className: 'dst-status-label' }, tr(st.key)),
          h('span', { className: 'dst-grow' }),
          h('span', { className: 'dst-muted' }, entryBusy ? tr('entryWorking') : enabled ? tr('entryOn') : tr('entryOff')),
          h('button', {
            type: 'button',
            role: 'switch',
            className: 'dst-switch',
            'aria-checked': enabled ? 'true' : 'false',
            'aria-label': tr('entryLabel'),
            disabled: !!entryBusy,
            onClick: onToggle,
          }, h('span', { className: 'dst-knob' }))),
        h('div', { className: 'dst-meta' },
          h('span', { className: 'dst-mono' }, dns || tr('valueNone')),
          status.backend ? h('span', null, tr('backendLabel') + ' ' + status.backend) : null,
          status.version ? h('span', null, 'v' + status.version) : null),
        st.hintKey ? h('div', { className: 'dst-hintline ' + st.tone }, tr(st.hintKey)) : null,
        command ? h(CopyField, { value: command, tr, ariaLabel: tr('copyCommand'), mono: true }) : null,
        entryErr ? h(InlineError, { tr, err: entryErr }) : null)
    }

    // ---------------------------------------------------------------- 入口卡
    function EntryCard({ snap, tr, login, loginRemain, loginBusy, loginErr, onGenerate }) {
      const pub = (snap && snap.publication) || {}
      const cfg = (snap && snap.config) || {}
      const enabled = !!pub.enabled
      // 入口关闭时 Host 也会返回“将要使用”的 URL；这里只在已开启时展示，避免误以为入口已生效。
      const url = enabled && typeof pub.url === 'string' ? pub.url : ''
      const target = typeof pub.target === 'string' ? pub.target : ''
      const port = cfg.httpsPort
      const route = target ? (port ? String(port) + ' → ' + target : target) : ''
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('entrySection'))),
        enabled ? null : h('div', { className: 'dst-mutedline' }, tr('entryOffHint')),
        h(CopyField, { value: url, tr, ariaLabel: tr('urlLabel'), placeholder: tr('valueNone'), mono: true }),
        route ? h('div', { className: 'dst-meta' }, h('span', null, tr('targetLabel') + ' ' + route)) : null,
        pub.adopted ? h('div', { className: 'dst-mutedline' }, tr('adoptedNote')) : null,
        h('div', { className: 'dst-login' },
          h('div', { className: 'dst-login-head' },
            h('span', { className: 'dst-card-title' }, tr('loginTitle')),
            h('button', {
              type: 'button',
              className: 'dst-btn primary',
              disabled: !!loginBusy || !enabled,
              onClick: onGenerate,
            }, loginBusy ? tr('generating') : tr('generateLogin'))),
          h('div', { className: 'dst-notice' }, tr('loginNotice')),
          loginErr ? h(InlineError, { tr, err: loginErr }) : null,
          login && login.url ? h('div', { className: 'dst-login-url' },
            h(CopyField, { value: login.url, tr, ariaLabel: tr('loginUrlLabel'), mono: true }),
            h('div', { className: 'dst-copied' }, tr('loginHideIn', { n: loginRemain }))) : null))
    }

    // ---------------------------------------------------------------- 设备卡
    function DeviceRow({ d, tr }) {
      const domainRef = useRef(null)
      const online = !!d.online
      const dns = typeof d.dnsName === 'string' ? d.dnsName : ''
      const ips = Array.isArray(d.ips) ? d.ips : []
      const tags = Array.isArray(d.tags) ? d.tags : []
      const host = d.hostName || dns || tr('unknownDevice')
      const seen = !online && d.lastSeen ? relText(d.lastSeen, tr) : ''
      const meta = []
      if (dns) meta.push(h('span', { key: 'dns', ref: domainRef, className: 'dst-mono dst-dev-domain', title: dns }, dns))
      if (ips[0]) meta.push(h('span', { key: 'ip', className: 'dst-mono' }, ips[0]))
      if (d.os) meta.push(h('span', { key: 'os' }, d.os))
      if (tags.length) meta.push(h('span', { key: 'tags', className: 'dst-tags' }, tags.map((tag, i) => h('span', { key: i, className: 'dst-tag' }, tag))))
      if (seen) meta.push(h('span', { key: 'seen' }, tr('lastSeen', { t: seen })))
      const metaNodes = []
      meta.forEach((node, i) => {
        if (i) metaNodes.push(h('span', { key: 'sep' + i, className: 'dst-sep', 'aria-hidden': true }, '·'))
        metaNodes.push(node)
      })
      return h('div', { className: 'dst-dev' },
        h(Dot, { tone: online ? 'ok' : 'idle' }),
        h('div', { className: 'dst-dev-main' },
          h('div', { className: 'dst-dev-top' },
            h('span', { className: 'dst-dev-name' }, host),
            d.isSelf ? h('span', { className: 'dst-badge' }, tr('selfBadge')) : null,
            online ? null : h('span', { className: 'dst-dev-off' }, tr('offline'))),
          metaNodes.length ? h('div', { className: 'dst-dev-meta' }, metaNodes) : null),
        dns ? h('span', { className: 'dst-dev-actions' },
          h(CopyButton, { value: dns, tr, label: tr('copyDomain'), fallbackRef: domainRef })) : null)
    }

    function DevicesCard({ devices, tr, busy, error, onRefresh }) {
      const list = Array.isArray(devices) ? devices.filter((d) => d && typeof d === 'object') : []
      const sorted = sortDevices(list)
      const online = list.filter((d) => d.online).length
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('devicesTitle')),
          h('span', { className: 'dst-card-sub' }, tr('deviceSummary', { online, total: list.length })),
          h('div', { className: 'dst-card-actions' },
            h('button', { type: 'button', className: 'dst-btn', onClick: onRefresh, disabled: !!busy },
              busy ? tr('refreshing') : tr('refreshDevices')))),
        error ? h(InlineError, { tr, err: error, onRetry: onRefresh }) : null,
        sorted.length === 0
          ? h('div', { className: 'dst-empty' }, tr('devicesEmpty'))
          : h('div', { className: 'dst-list' },
            sorted.map((d, i) => h(DeviceRow, { key: d.id || d.dnsName || d.hostName || 'dev' + i, d, tr }))))
    }

    // ---------------------------------------------------------------- 诊断卡
    function CheckRow({ c, tr }) {
      const tone = c.level === 'error' ? 'err' : c.level === 'warn' ? 'warn' : 'ok'
      const ico = tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '✕'
      return h('div', { className: 'dst-check' },
        h('span', { className: 'dst-check-ico ' + tone, 'aria-hidden': true }, ico),
        h('div', { className: 'dst-check-main' },
          h('div', { className: 'dst-check-msg' }, c.message || c.id || tr('unknownError')),
          c.hint ? h('div', { className: 'dst-check-hint' }, '↳ ' + c.hint) : null,
          c.command ? h('div', { className: 'dst-check-cmd' },
            h(CopyField, { value: c.command, tr, ariaLabel: tr('copyCommand'), mono: true })) : null))
    }

    function DiagnosticsCard({ health, tr, busy, error, onRecheck }) {
      const checks = health && Array.isArray(health.checks) ? health.checks : []
      const failing = checks.filter((c) => c.ok === false || c.level === 'warn' || c.level === 'error').length
      let summary = ''
      if (health) summary = health.ok && failing === 0 ? tr('healthOk') : tr('healthIssues', { n: failing })
      return h('div', { className: 'dst-card' },
        h('div', { className: 'dst-card-head' },
          h('span', { className: 'dst-card-title' }, tr('diagTitle')),
          summary ? h('span', { className: 'dst-card-sub' }, summary) : null,
          h('div', { className: 'dst-card-actions' },
            h('button', { type: 'button', className: 'dst-btn', onClick: onRecheck, disabled: !!busy },
              busy ? tr('checking') : tr('recheck')))),
        error ? h(InlineError, { tr, err: error, onRetry: onRecheck }) : null,
        checks.length === 0
          ? h('div', { className: 'dst-empty' }, tr('diagEmpty'))
          : h('div', { className: 'dst-checks' },
            checks.map((c, i) => h(CheckRow, { key: (c.id || 'check') + i, c, tr }))))
    }

    // ---------------------------------------------------------------- 设置页整节
    function Section(props) {
      useLocaleTick()
      const tr = trWith(props && props.t)
      const [snap, setSnap] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [loadErr, setLoadErr] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [entryBusy, setEntryBusy] = useState(false)
      const [entryErr, setEntryErr] = useState(null)
      const [devicesBusy, setDevicesBusy] = useState(false)
      const [devicesErr, setDevicesErr] = useState(null)
      const [healthBusy, setHealthBusy] = useState(false)
      const [healthErr, setHealthErr] = useState(null)
      const [login, setLogin] = useState(null)
      const [loginRemain, setLoginRemain] = useState(0)
      const [loginBusy, setLoginBusy] = useState(false)
      const [loginErr, setLoginErr] = useState(null)
      const aliveRef = useRef(true)
      const snapRef = useRef(null)
      const reqRef = useRef(0)

      const commitSnap = (next) => {
        snapRef.current = next
        setSnap(next)
      }

      // 首屏一次 snapshot；focus / visibilitychange 再刷新一次；无常驻定时器。
      const load = useCallback(async (opts) => {
        const force = !!(opts && opts.force)
        const silent = !!(opts && opts.silent)
        const seq = ++reqRef.current
        if (!silent) setRefreshing(true)
        try {
          const value = await api.snapshot(force ? { fresh: true } : {})
          if (!aliveRef.current || seq !== reqRef.current) return
          commitSnap(normSnapshot(value))
          setLoadErr(null)
          setPhase('ready')
        } catch (e) {
          if (!aliveRef.current || seq !== reqRef.current) return
          const kind = e && e.kind ? e.kind : 'unknown'
          if (kind === 'unauthorized') {
            setLoadErr(e)
            setPhase('unauthorized')
            return
          }
          if (kind === 'unavailable') {
            setLoadErr(e)
            setPhase('unavailable')
            return
          }
          setLoadErr(e)
          if (!snapRef.current) setPhase('error')
        } finally {
          if (aliveRef.current && seq === reqRef.current && !silent) setRefreshing(false)
        }
      }, [])

      useEffect(() => {
        aliveRef.current = true
        load()
        const onRefresh = () => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          load({ silent: true, force: true })
        }
        window.addEventListener('focus', onRefresh)
        document.addEventListener('visibilitychange', onRefresh)
        return () => {
          aliveRef.current = false
          window.removeEventListener('focus', onRefresh)
          document.removeEventListener('visibilitychange', onRefresh)
        }
      }, [load])

      // 登录链接 60s 自动隐藏（只在这个链接存在时跑一个 1s 定时器）
      useEffect(() => {
        if (!login) return undefined
        let alive = true
        const tick = () => {
          if (!alive) return
          const left = Math.max(0, Math.ceil((login.expiresAt - Date.now()) / 1000))
          setLoginRemain(left)
          if (left <= 0) setLogin(null)
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => {
          alive = false
          clearInterval(id)
        }
      }, [login])

      // 入口被外部关掉时，丢弃已经生成的链接（token 不留在内存里）
      useEffect(() => {
        if (snap && !snap.publication.enabled && login) setLogin(null)
      }, [snap, login])

      const toggleEntry = useCallback(async () => {
        const cur = snapRef.current
        if (!cur || entryBusy) return
        const next = !cur.publication.enabled
        setEntryBusy(true)
        setEntryErr(null)
        try {
          const value = next ? await api.publish({}) : await api.unpublish()
          if (!aliveRef.current) return
          const publication = value && typeof value === 'object'
            ? normPublication(value)
            : { ...cur.publication, enabled: next, url: next ? cur.publication.url : '' }
          setLogin(null)
          setLoginErr(null)
          commitSnap({ ...cur, publication })
          load({ silent: true, force: true })
        } catch (e) {
          if (!aliveRef.current) return
          setEntryErr(e)
        } finally {
          if (aliveRef.current) setEntryBusy(false)
        }
      }, [entryBusy, load])

      const refreshDevices = useCallback(async () => {
        setDevicesBusy(true)
        setDevicesErr(null)
        try {
          const value = await api.devices({ fresh: true })
          if (!aliveRef.current) return
          const raw = Array.isArray(value) ? value : value && Array.isArray(value.devices) ? value.devices : []
          const cur = snapRef.current
          if (cur) commitSnap({ ...cur, devices: raw.map(normDevice) })
        } catch (e) {
          if (!aliveRef.current) return
          setDevicesErr(e)
        } finally {
          if (aliveRef.current) setDevicesBusy(false)
        }
      }, [])

      const recheckHealth = useCallback(async () => {
        setHealthBusy(true)
        setHealthErr(null)
        try {
          // deep 检查会额外发 https HEAD（5s）+ 本机 /api 请求（3s），叠加 CLI 调用可能超过 8s 的客户端超时；
          // 设置页的「重新检查」用浅检（cli/backend/dnsName/route/trust/funnel），深检留给需要时单独调用。
          const value = await api.health({ deep: false })
          if (!aliveRef.current) return
          const cur = snapRef.current
          if (cur) commitSnap({ ...cur, health: normHealth(value) })
        } catch (e) {
          if (!aliveRef.current) return
          setHealthErr(e)
        } finally {
          if (aliveRef.current) setHealthBusy(false)
        }
      }, [])

      const generateLogin = useCallback(async () => {
        if (loginBusy) return
        setLoginBusy(true)
        setLoginErr(null)
        try {
          const value = await api.loginUrl()
          if (!aliveRef.current) return
          const url = value && typeof value.url === 'string' ? value.url : typeof value === 'string' ? value : ''
          if (!url) throw rpcErr('rpc', '', 'empty login url', 0)
          setLogin({ url, expiresAt: Date.now() + LOGIN_TTL_MS })
          setLoginRemain(Math.round(LOGIN_TTL_MS / 1000))
        } catch (e) {
          if (!aliveRef.current) return
          setLoginErr(e)
        } finally {
          if (aliveRef.current) setLoginBusy(false)
        }
      }, [loginBusy])

      const view = snap || EMPTY_SNAPSHOT
      const head = h('div', { className: 'dst-shead' },
        h('div', { className: 'dst-shead-main' },
          h('h2', { className: 'dst-title' }, tr('title')),
          h('div', { className: 'dst-desc' }, tr('desc'))),
        h('div', { className: 'dst-shead-actions' },
          h('button', { type: 'button', className: 'dst-btn', onClick: () => load({ force: true }), disabled: refreshing },
            refreshing ? tr('refreshing') : '↻ ' + tr('refresh'))))

      let body = null
      if (phase === 'loading' && !snap) {
        body = h('div', { className: 'dst-card dst-empty' }, tr('loading'))
      } else if (phase === 'unauthorized') {
        body = h(StateCard, { tr, tone: 'warn', title: tr('unauthorized'), hint: tr('unauthorizedHint') })
      } else if (phase === 'unavailable') {
        body = h(StateCard, {
          tr, tone: 'warn', title: tr('hostUnavailable'), hint: tr('hostUnavailableHint'),
          onRetry: () => load({ force: true }),
        })
      } else if (phase === 'error' && !snap) {
        const known = statusFromErrorCode(loadErr)
        body = known
          ? h(StateCard, {
            tr, tone: 'err', title: tr(known.key), hint: tr(known.hintKey),
            onRetry: () => load({ force: true }),
          })
          : h(StateCard, {
            tr, tone: 'err', title: tr('loadFailed'), hint: errorText(loadErr, tr),
            onRetry: () => load({ force: true }),
          })
      } else {
        body = h('div', { className: 'dst-body' },
          loadErr ? h(InlineError, { tr, err: loadErr, onRetry: () => load({ force: true }) }) : null,
          h(StatusCard, { snap: view, tr, entryBusy, entryErr, onToggle: toggleEntry }),
          h(EntryCard, { snap: view, tr, login, loginRemain, loginBusy, loginErr, onGenerate: generateLogin }),
          h(DevicesCard, { devices: view.devices, tr, busy: devicesBusy, error: devicesErr, onRefresh: refreshDevices }),
          h(DiagnosticsCard, { health: view.health, tr, busy: healthBusy, error: healthErr, onRecheck: recheckHealth }))
      }

      return h('div', { className: 'dst-root' }, head, body)
    }

    // ---------------------------------------------------------------- 顶部图标（在线/离线 + 打开设置）
    function snapshotValue(observable) {
      if (!observable) return null
      try {
        if (typeof observable.get === 'function') return observable.get()
        if (typeof observable.getSnapshot === 'function') return observable.getSnapshot()
        if (typeof observable === 'object' && 'value' in observable) return observable.value
      } catch (e) {}
      return null
    }

    function settingsCommandRow(ctx) {
      try {
        const service = ctx.get('shortcuts')
        const rows = snapshotValue(service && service.catalog)
        if (Array.isArray(rows)) return rows.find((row) => row && row.id === 'settings.open') || null
      } catch (e) {}
      return null
    }

    function findButtonByText(text) {
      if (!text || typeof document === 'undefined') return null
      const nodes = document.querySelectorAll('button')
      for (const node of nodes) if ((node.textContent || '').trim() === text) return node
      return null
    }

    function findButtonByLabel(label) {
      if (!label || typeof document === 'undefined') return null
      const nodes = document.querySelectorAll('button,[role="button"]')
      for (const node of nodes) {
        const aria = node.getAttribute('aria-label') || ''
        const title = node.getAttribute('title') || ''
        if (aria === label || title === label) return node
      }
      return null
    }

    // 打开「设置 → 远程访问」：先点已有导航项；否则用 settings.open 快捷键（web: primary+alt+Comma）
    // 打开设置面板，再等它渲染出我们的分区并点中。没有公开的 settings 导航服务，只能这样无缝衔接。
    function openSettingsSection(ctx) {
      const label = (() => {
        try { return ctx.locale.bind(NS)('title') } catch (e) { return zh.title }
      })()
      const clickNav = () => {
        const node = findButtonByText(label)
        if (!node) return false
        try { node.click() } catch (e) { return false }
        return true
      }
      if (clickNav()) return
      const isMac = /Mac|iPhone|iPad/.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '')
      const row = settingsCommandRow(ctx)
      const triggerLabels = []
      if (row && typeof row.label === 'string' && row.label) triggerLabels.push(row.label)
      triggerLabels.push('Settings', '设置', 'Preferences', '偏好设置')
      const init = { code: 'Comma', key: ',', bubbles: true, cancelable: true, composed: true, altKey: true, metaKey: isMac, ctrlKey: !isMac }
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', init))
        window.dispatchEvent(new KeyboardEvent('keyup', init))
      } catch (e) {}
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        if (clickNav()) { clearInterval(timer); return }
        if (attempts === 4) {
          for (const text of triggerLabels) {
            const trigger = findButtonByLabel(text)
            if (trigger) { try { trigger.click() } catch (e) {}; break }
          }
        }
        if (attempts >= 20) clearInterval(timer)
      }, 100)
    }

    function tailscaleGlyph() {
      const dots = []
      for (const cy of [8.5, 15.5]) {
        for (const cx of [6.5, 12, 17.5]) {
          dots.push(h('circle', { key: cx + ':' + cy, cx: cx, cy: cy, r: 2.1 }))
        }
      }
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, dots)
    }

    function TailscaleHeaderButton(props) {
      const { t, openSettings } = props || {}
      const tr = trWith(t)
      const [summary, setSummary] = useState(null)
      const [failed, setFailed] = useState(false)
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])
      const load = useCallback(() => {
        api.status().then((value) => {
          if (!alive.current) return
          setSummary(value || null)
          setFailed(false)
        }).catch(() => {
          if (alive.current) setFailed(true)
        })
      }, [])
      useEffect(() => {
        load()
        const id = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load()
        }, 30000)
        const onVisible = () => { if (document.visibilityState === 'visible') load() }
        const onFocus = () => load()
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onFocus)
        return () => {
          clearInterval(id)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onFocus)
        }
      }, [load])
      const running = !!(summary && summary.running)
      const dotClass = summary ? (running ? 'on' : 'off') : failed ? 'warn' : ''
      const bits = [tr('headerTitle')]
      if (summary) {
        bits.push(running ? tr('headerOnline') : tr('headerOffline'))
        if (summary.dnsName) bits.push(summary.dnsName)
        if (summary.publication) bits.push(summary.publication.enabled ? tr('headerEntryOn') : tr('headerEntryOff'))
        if (summary.devicesTotal != null) bits.push(tr('headerDeviceCount', { online: summary.devicesOnline || 0, total: summary.devicesTotal || 0 }))
      } else if (failed) {
        bits.push(tr('headerUnknown'))
      }
      const title = bits.filter(Boolean).join(' · ')
      return h('button', {
        type: 'button',
        className: 'dst-hbtn',
        title: title,
        'aria-label': title,
        onClick: () => { if (typeof openSettings === 'function') openSettings() },
      }, tailscaleGlyph(), h('span', { className: 'dst-hbtn-dot ' + dotClass, 'aria-hidden': true }))
    }

    // ---------------------------------------------------------------- apply
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tailscale: locale')
        ctx.effect(() => {
          let off = null
          try {
            if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
              off = ctx.locale.subscribe(() => {
                for (const fn of Array.from(LOCALE_TICK.subs)) {
                  try { fn() } catch (e) {}
                }
              })
            }
          } catch (e) {}
          return () => { if (off) { try { off() } catch (e) {} } }
        }, 'dsh-tailscale: locale-change')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.id = 'dsh-tailscale-style'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'dsh-tailscale: styles')

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'tailscale',
          order: 40,
          label: () => { try { return ctx.locale.bind(NS)('title') } catch (e) { return zh.title } },
          locale: NS,
          inject: () => ({}),
        }, Section))

        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'dsh-tailscale',
          order: 9,
          locale: NS,
          inject: () => ({ openSettings: () => openSettingsSection(ctx) }),
        }, TailscaleHeaderButton))
      },
    }
  },
})
