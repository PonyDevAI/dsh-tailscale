// dsh-tailscale · serve 配置判定（纯函数）
// ServeConfig 形状（Tailscale 1.10x）：
// { TCP: { "443": { HTTPS: true } },
//   Web: { "node.example-tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3080" } } } },
//   AllowFunnel: { "host:443": true } }

export function normalizePath(path) {
  const text = typeof path === 'string' && path.trim() ? path.trim() : '/'
  return text.startsWith('/') ? text : `/${text}`
}

export function normalizeProxy(proxy) {
  return typeof proxy === 'string' ? proxy.trim().replace(/\/+$/, '') : ''
}

export function authorityFor(dnsName, httpsPort) {
  return `${dnsName}:${httpsPort}`
}

export function webHandlers(config, { dnsName, httpsPort }) {
  const web = config?.Web
  if (!web || typeof web !== 'object') return {}
  const entry = web[authorityFor(dnsName, httpsPort)] || web[`${dnsName}:${httpsPort}`]
  const handlers = entry?.Handlers
  return handlers && typeof handlers === 'object' ? handlers : {}
}

/**
 * 判定目标 path 上的路由归属。
 * @returns {{ state: 'absent'|'exact'|'stale'|'conflict', handler?: object, proxy?: string, reason?: string }}
 */
export function classifyServe(config, { dnsName, httpsPort, path, target, previousTarget }) {
  const handlers = webHandlers(config, { dnsName, httpsPort })
  const mount = normalizePath(path)
  const handler = handlers[mount]
  if (!handler) {
    // 端口被别的协议占了（例如 tcp 443 但没有 https/web）→ 冲突而不是 absent
    const tcp = config?.TCP?.[String(httpsPort)]
    const hasWeb = Object.keys(config?.Web || {}).length > 0
    if (tcp && !hasWeb) return { state: 'conflict', reason: 'tcp-port-in-use' }
    return { state: 'absent' }
  }
  const proxy = normalizeProxy(handler.Proxy)
  if (proxy && proxy === normalizeProxy(target)) return { state: 'exact', handler }
  if (previousTarget && proxy && proxy === normalizeProxy(previousTarget)) return { state: 'stale', handler }
  return { state: 'conflict', handler, proxy: handler?.Proxy }
}

/** Funnel 是否对本 authority 开启（该字段存在且为 true）。 */
export function funnelEnabled(config, { dnsName, httpsPort }) {
  const map = config?.AllowFunnel
  if (!map || typeof map !== 'object') return false
  const value = map[authorityFor(dnsName, httpsPort)]
  return value === true || value === 'true'
}

/** 本 authority 上所有 path（用于诊断冲突路由）。 */
export function listHandlers(config, { dnsName, httpsPort }) {
  const handlers = webHandlers(config, { dnsName, httpsPort })
  return Object.entries(handlers).map(([path, handler]) => ({
    path,
    proxy: typeof handler?.Proxy === 'string' ? handler.Proxy : '',
  }))
}
