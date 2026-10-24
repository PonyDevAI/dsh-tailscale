// dsh-tailscale · ctx.tailscale 服务实现
// 组合：TailscaleCli（CLI）+ serve 判定 + trustedHosts 桥 + 状态文件 + 探测。
// 只读能力返回结构化状态；只有 publish/unpublish/loginUrl 这类动作会抛带 code 的错误。
import http from 'node:http'
import https from 'node:https'
import { TailscaleCli, TailscaleError } from './cli.js'
import { normalizeStatus, filterDevices, findDevice, compileAllow } from './devices.js'
import { classifyServe, funnelEnabled, listHandlers, normalizePath } from './serve.js'
import { ensureTrusted, isTrusted } from './trust.js'
import { probeTcp, assertProbeTarget } from './probe.js'

export const DEFAULT_CONFIG = {
  cliPath: 'auto',
  autoPublish: true,
  httpsPort: 443,
  publishPath: '/',
  unpublishOnExit: true,
  adoptExisting: true,
  trustHost: true,
  deviceTtlMs: 10000,
  probeTimeoutMs: 800,
  allow: [],
  dshHome: undefined,
}

function messageOf(error) {
  const text = error && error.message ? String(error.message) : '未知错误'
  return text.length > 400 ? text.slice(0, 400) : text
}

function requestStatus({ protocol = 'http:', hostname, port, path = '/', method = 'GET', headers, timeoutMs = 4000 }) {
  return new Promise((resolve) => {
    const mod = protocol === 'https:' ? https : http
    const request = mod.request({ hostname, port, path, method, headers, timeout: timeoutMs }, (response) => {
      response.resume()
      resolve({ status: response.statusCode || 0 })
    })
    request.on('timeout', () => {
      request.destroy()
      resolve({ status: 0, error: 'timeout' })
    })
    request.on('error', (error) => resolve({ status: 0, error: error?.code || 'error' }))
    request.end()
  })
}

function pickConfig(config) {
  return {
    autoPublish: config.autoPublish,
    httpsPort: config.httpsPort,
    publishPath: config.publishPath,
    trustHost: config.trustHost,
    unpublishOnExit: config.unpublishOnExit,
    adoptExisting: config.adoptExisting,
  }
}

export function createTailscaleService({ ctx, config: rawConfig, cli, state, now = () => Date.now() }) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig || {}) }
  const engine = cli instanceof TailscaleCli ? cli : new TailscaleCli({ cliPath: config.cliPath })

  /** @type {{ at: number, data: any } | null} */
  let cache = null
  const listeners = new Set()
  let trustDispose = null
  let runtime = null // { url, host, path, target, owned, adopted, createdAt }

  const getConnection = () => {
    try {
      return ctx.get('connection') || null
    } catch {
      return null
    }
  }
  const getWebServer = () => {
    try {
      return ctx.get('webServer') || null
    } catch {
      return null
    }
  }

  function emit(reason = 'change') {
    const event = {
      at: now(),
      reason,
      publication: runtime ? { enabled: true, ...runtime } : { enabled: false },
    }
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {}
    }
  }

  async function status({ fresh = false } = {}) {
    if (!fresh && cache && now() - cache.at < config.deviceTtlMs) return cache.data
    const raw = await engine.statusJson()
    const norm = normalizeStatus(raw)
    const data = {
      backend: norm.backend,
      version: norm.version,
      cliPath: engine.cliPath,
      dnsName: norm.dnsName,
      magicDnsSuffix: norm.magicDnsSuffix,
      certDomains: norm.certDomains,
      self: norm.self,
      devices: norm.devices,
    }
    cache = { at: now(), data }
    return data
  }

  async function devices({ fresh = false, online, allow } = {}) {
    const data = await status({ fresh })
    return filterDevices(data.devices, { online, allow: allow ?? config.allow })
  }

  async function device(ref) {
    const data = await status()
    return findDevice(data.devices, ref)
  }

  function webTarget() {
    const web = getWebServer()
    const port = web?.port
    if (!port) throw new TailscaleError('tailscale/no-connection', 'DSH webServer 尚未监听（没有可用端口）')
    return { port, target: `http://127.0.0.1:${port}` }
  }

  async function createRoute(options) {
    try {
      return await engine.serveCreate(options)
    } catch (error) {
      throw new TailscaleError('tailscale/serve-failed', `创建 serve 路由失败：${messageOf(error)}`, { cause: error, upstream: error?.code })
    }
  }

  async function offRoute(options) {
    try {
      return await engine.serveOff(options)
    } catch (error) {
      // 只有"路由本来就不存在"才算幂等成功；权限/超时等必须上抛，不能静默留下已经指向退出进程的路由。
      if (/no serve|not found|not serving|no config|no handlers/i.test(messageOf(error))) return ''
      throw new TailscaleError('tailscale/serve-failed', `撤回 serve 路由失败：${messageOf(error)}`, { cause: error, upstream: error?.code })
    }
  }

  function urlFor(dnsName, path) {
    const suffix = !path || path === '/' ? '/' : path
    return `https://${dnsName}${suffix}`
  }

  async function publication({ fresh = false } = {}) {
    const connection = getConnection()
    const web = getWebServer()
    const stored = await state.read()
    if (!connection || !web?.port) {
      return {
        enabled: false,
        reason: 'no-connection',
        routeState: 'unknown',
        owned: false,
        adopted: false,
        host: stored?.host || '',
        path: stored?.path || normalizePath(config.publishPath),
        target: stored?.target || '',
      }
    }
    let data
    try {
      data = await status({ fresh })
    } catch (error) {
      return { enabled: false, reason: 'tailscale-unavailable', routeState: 'unknown', owned: false, adopted: false, host: stored?.host || '', path: normalizePath(stored?.path ?? config.publishPath), target: stored?.target || '', error: { code: error?.code || 'tailscale/error', message: messageOf(error) } }
    }
    if (!data.dnsName) {
      return { enabled: false, reason: 'no-dns-name', routeState: 'unknown', owned: false, adopted: false, host: '', path: normalizePath(config.publishPath), target: stored?.target || '' }
    }
    const { target } = webTarget()
    const path = normalizePath(runtime?.path ?? stored?.path ?? config.publishPath)
    let serveConfig = {}
    try {
      serveConfig = await engine.serveStatusJson()
    } catch (error) {
      return { enabled: false, reason: 'serve-unavailable', routeState: 'unknown', owned: false, adopted: false, host: data.dnsName, path, target, error: { code: error?.code || 'tailscale/error', message: messageOf(error) } }
    }
    const classified = classifyServe(serveConfig, {
      dnsName: data.dnsName,
      httpsPort: config.httpsPort,
      path,
      target,
      previousTarget: runtime?.target ?? stored?.target,
    })
    const enabled = classified.state === 'exact'
    const owned = enabled ? (runtime?.owned ?? stored?.owned === true) : false
    return {
      enabled,
      routeState: classified.state,
      url: urlFor(data.dnsName, path),
      host: data.dnsName,
      path,
      target,
      owned,
      // exact 但没有 runtime 说明是启动前就存在的路由（上次崩溃残留或外部脚本创建）→ 视为认领。
      adopted: enabled ? (runtime ? runtime.adopted : true) : false,
      createdAt: runtime?.createdAt ?? stored?.createdAt,
      routes: listHandlers(serveConfig, { dnsName: data.dnsName, httpsPort: config.httpsPort }),
      ...(classified.state === 'conflict' ? { conflict: { path: classified.proxy || classified.reason || '', routes: listHandlers(serveConfig, { dnsName: data.dnsName, httpsPort: config.httpsPort }) } } : {}),
    }
  }

  async function publish({ path: requestedPath } = {}) {
    const connection = getConnection()
    if (!connection) throw new TailscaleError('tailscale/no-connection', 'connection 服务不可用')
    const { target } = webTarget()
    const data = await status({ fresh: true })
    if (data.backend !== 'Running') {
      throw new TailscaleError('tailscale/not-running', `Tailscale 当前状态是 ${data.backend || 'Unknown'}，请先确认已登录并运行`)
    }
    if (!data.dnsName) {
      throw new TailscaleError('tailscale/https-disabled', '没有 MagicDNS 域名（Self.DNSName 为空），无法发布 HTTPS 入口')
    }
    const path = normalizePath(requestedPath ?? config.publishPath)
    const stored = await state.read()
    let serveConfig
    try {
      serveConfig = await engine.serveStatusJson()
    } catch (error) {
      // 读取失败按上下文包装：权限/未运行/未登录/超时保留原码，其余归为 serve-failed。
      if (error instanceof TailscaleError && ['tailscale/permission', 'tailscale/not-running', 'tailscale/not-logged-in', 'tailscale/timeout'].includes(error.code)) throw error
      throw new TailscaleError('tailscale/serve-failed', `读取 serve 状态失败：${messageOf(error)}`, { cause: error, upstream: error?.code })
    }
    const classified = classifyServe(serveConfig, {
      dnsName: data.dnsName,
      httpsPort: config.httpsPort,
      path,
      target,
      previousTarget: stored?.target,
    })
    let adopted = false
    if (classified.state === 'exact') {
      adopted = true
    } else if (classified.state === 'absent') {
      await createRoute({ httpsPort: config.httpsPort, path, target })
    } else if (classified.state === 'stale' && config.adoptExisting) {
      // 先撤旧（沿用旧目标的 handler），再按本实例目标重建；避免真实 CLI 报 already serving。
      await offRoute({ httpsPort: config.httpsPort, path })
      await createRoute({ httpsPort: config.httpsPort, path, target })
    } else {
      throw new TailscaleError(
        'tailscale/route-conflict',
        `serve 上 ${data.dnsName}${path} 已被 ${classified.proxy || '其他服务'} 占用，未覆盖`,
        { routes: listHandlers(serveConfig, { dnsName: data.dnsName, httpsPort: config.httpsPort }) },
      )
    }
    const next = {
      url: urlFor(data.dnsName, path),
      host: data.dnsName,
      path,
      target,
      owned: true,
      adopted,
      createdAt: now(),
    }
    // 发布要尽量原子：路由已存在/已创建后，若状态写入或信任桥失败，就撤掉路由并清状态，不留孤路由。
    const rollback = async () => {
      try {
        await offRoute({ httpsPort: config.httpsPort, path })
      } catch {}
      runtime = null
      try {
        await state.clear()
      } catch {}
    }
    try {
      await state.write({
        url: next.url,
        host: next.host,
        path,
        target,
        owned: true,
        createdAt: next.createdAt,
        dshPid: process.pid,
      })
    } catch (error) {
      await rollback()
      throw new TailscaleError('tailscale/serve-failed', `写入状态文件失败：${messageOf(error)}`, { cause: error })
    }
    runtime = next
    if (config.trustHost) {
      try {
        if (typeof trustDispose === 'function') trustDispose()
        trustDispose = ensureTrusted(connection, data.dnsName)
      } catch (error) {
        if (typeof trustDispose === 'function') {
          trustDispose()
          trustDispose = null
        }
        await rollback()
        throw error
      }
    }
    emit('publish')
    return publication({ fresh: false })
  }

  async function unpublish() {
    const stored = await state.read()
    const info = runtime || stored
    if (!info) {
      emit('unpublish')
      return { enabled: false }
    }
    const path = normalizePath(info.path ?? config.publishPath)
    await offRoute({ httpsPort: config.httpsPort, path })
    if (typeof trustDispose === 'function') {
      trustDispose()
      trustDispose = null
    }
    runtime = null
    await state.clear()
    cache = null
    emit('unpublish')
    return { enabled: false, path, target: info.target }
  }

  async function loginUrl() {
    const current = await publication({ fresh: true })
    if (!current.enabled || !current.url) {
      throw new TailscaleError('tailscale/no-publication', '远程入口未开启，先开启入口再生成登录链接')
    }
    const connection = getConnection()
    if (!connection || typeof connection.authenticatedUrl !== 'function') {
      throw new TailscaleError('tailscale/no-connection', 'connection 服务不可用，无法生成登录链接')
    }
    return connection.authenticatedUrl(current.url)
  }

  async function health({ deep = false } = {}) {
    const checks = []
    let data = null
    try {
      const version = await engine.version()
      checks.push({ id: 'cli', ok: true, level: 'ok', message: `CLI 可用（${version || 'unknown'}，${engine.cliPath}）` })
    } catch (error) {
      checks.push({ id: 'cli', ok: false, level: 'error', message: messageOf(error), hint: '安装 Tailscale 或检查 cliPath 配置' })
    }
    try {
      data = await status({ fresh: true })
      const running = data.backend === 'Running'
      checks.push({
        id: 'backend',
        ok: running,
        level: running ? 'ok' : 'error',
        message: running ? 'Tailscale 运行中' : `Tailscale 状态：${data.backend}`,
        ...(running ? {} : { hint: '打开 Tailscale 并确认已登录' }),
      })
    } catch (error) {
      checks.push({ id: 'backend', ok: false, level: 'error', message: messageOf(error), hint: '打开 Tailscale 并确认已登录' })
    }
    const dnsName = data?.dnsName || ''
    checks.push({
      id: 'dnsName',
      ok: !!dnsName,
      level: dnsName ? 'ok' : 'error',
      message: dnsName ? `节点域名 ${dnsName}` : '没有 MagicDNS 域名',
      ...(dnsName ? {} : { hint: '在 Tailscale 管理后台启用 MagicDNS' }),
    })
    let serveConfig = {}
    let serveConfigOk = true
    try {
      serveConfig = await engine.serveStatusJson()
    } catch {
      serveConfigOk = false
    }
    let current = { enabled: false, routeState: 'unknown' }
    try {
      current = await publication()
    } catch {}
    const routeOk = current.routeState === 'exact'
    checks.push({
      id: 'route',
      ok: routeOk,
      level: routeOk ? 'ok' : 'error',
      message: routeOk ? `入口路由正常：${current.url}` : `入口路由状态：${current.routeState || current.reason || '未知'}`,
      ...(routeOk ? {} : { hint: '在设置页点「开启入口」；冲突时先检查同 authority 的其它 serve 路由' }),
    })
    const trusted = dnsName ? isTrusted(getConnection(), dnsName) : false
    checks.push({
      id: 'trust',
      ok: trusted,
      level: trusted ? 'ok' : 'warn',
      message: trusted ? 'Host 信任已生效' : 'Host 信任未生效（远程 /api 会 403）',
      ...(trusted ? {} : { hint: '重新开启入口；若仍失败，在 profile patch 里把域名加进 connection.trustedHosts' }),
    })
    const funnel = dnsName ? funnelEnabled(serveConfig, { dnsName, httpsPort: config.httpsPort }) : false
    checks.push({
      id: 'funnel',
      ok: !funnel,
      level: funnel ? 'error' : serveConfigOk ? 'ok' : 'warn',
      message: funnel
        ? '检测到该入口启用了 Funnel（公网暴露）'
        : serveConfigOk
          ? 'Funnel 未开启（仅 tailnet）'
          : '无法读取 serve 状态，Funnel 状态未知',
      ...(funnel ? { hint: '执行 tailscale funnel --https=<port> off 关闭公网暴露' } : {}),
    })
    if (deep && dnsName) {
      const httpsCheck = await requestStatus({ protocol: 'https:', hostname: dnsName, port: config.httpsPort, path: '/', method: 'HEAD', timeoutMs: 5000 })
      const httpsOk = httpsCheck.status === 401 || httpsCheck.status === 200
      checks.push({
        id: 'https',
        ok: httpsOk,
        level: httpsOk ? 'ok' : httpsCheck.status === 403 ? 'error' : 'warn',
        message: httpsCheck.status
          ? `https://${dnsName}/ 返回 ${httpsCheck.status}${httpsCheck.status === 401 ? '（入口可达，认证层正常）' : ''}`
          : `https://${dnsName}/ 不可达（${httpsCheck.error || 'unknown'}）`,
        ...(httpsOk ? {} : { hint: httpsCheck.status === 403 ? 'Host 信任未生效' : '检查 tailnet 连接、HTTPS 证书与访问规则' }),
      })
      const web = getWebServer()
      if (web?.port) {
        const local = await requestStatus({ hostname: '127.0.0.1', port: web.port, path: '/api', method: 'GET', headers: { host: dnsName }, timeoutMs: 3000 })
        const localOk = local.status !== 403
        checks.push({
          id: 'trust-probe',
          ok: localOk,
          level: localOk ? 'ok' : 'error',
          message: local.status === 403 ? '带 tailnet Host 的本机 /api 请求被 403（信任围栏未通过）' : `带 tailnet Host 的本机 /api 请求返回 ${local.status || local.error || 'unknown'}`,
          ...(localOk ? {} : { hint: '确认 connection.trustedHosts 已包含节点域名' }),
        })
      }
    }
    return {
      ok: !checks.some((check) => check.level === 'error'),
      checks,
      url: current.url,
      dnsName,
    }
  }

  async function snapshot() {
    const result = {
      config: pickConfig(config),
      status: null,
      publication: null,
      devices: [],
      health: null,
    }
    try {
      const data = await status({ fresh: false })
      result.status = {
        backend: data.backend,
        version: data.version,
        cliPath: data.cliPath,
        dnsName: data.dnsName,
        self: data.self,
        deviceCount: data.devices.length,
        onlineCount: data.devices.filter((device) => device.online).length,
      }
      result.devices = filterDevices(data.devices, { allow: config.allow })
    } catch (error) {
      result.status = { error: { code: error?.code || 'tailscale/error', message: messageOf(error) } }
    }
    try {
      result.publication = await publication()
    } catch (error) {
      result.publication = { enabled: false, error: { code: error?.code || 'tailscale/error', message: messageOf(error) } }
    }
    try {
      result.health = await health({ deep: false })
    } catch (error) {
      result.health = { ok: false, checks: [{ id: 'health', ok: false, level: 'error', message: messageOf(error) }] }
    }
    return result
  }

  async function probe(host, port, options = {}) {
    let knownHosts = []
    try {
      const data = await status()
      knownHosts = data.devices.flatMap((item) => [item.hostName, item.dnsName, ...item.ips])
    } catch {}
    if (!assertProbeTarget(host, { knownHosts })) {
      throw new TailscaleError('tailscale/bad-target', '只允许探测 tailnet 网段地址或当前设备清单里的主机')
    }
    return probeTcp(host, port, { timeoutMs: options.timeoutMs || config.probeTimeoutMs })
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** 供健康检查/消费方复用的额外信息。 */
  function describe() {
    return {
      name: '@ponydev/dsh-tailscale',
      cliPath: engine.cliPath,
      config: { ...pickConfig(config), deviceTtlMs: config.deviceTtlMs, probeTimeoutMs: config.probeTimeoutMs, allow: compileAllow(config.allow).map(String) },
    }
  }

  return {
    status,
    devices,
    device,
    publication,
    publish,
    unpublish,
    loginUrl,
    health,
    snapshot,
    probe,
    subscribe,
    describe,
    get config() {
      return { ...config }
    },
  }
}
