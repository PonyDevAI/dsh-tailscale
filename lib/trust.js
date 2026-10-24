// dsh-tailscale · trustedHosts 桥
// connection.trustedHosts 在类型上是 private readonly，但运行期与 config 是同一数组、
// 围栏每次请求都会读它 —— 这里做特性检测 + 只在"确实是我们加的"情况下回滚。
import { TailscaleError } from './cli.js'

const AUTHORITY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/

/** 只接受裸 authority（host 或 host:port），拒绝 scheme/path/userinfo/空白。 */
export function assertAuthority(entry) {
  const text = String(entry || '')
  if (!AUTHORITY_RE.test(text) || text.includes('..')) {
    throw new TailscaleError('tailscale/trust-unavailable', `trustedHosts 条目不是裸 authority: ${JSON.stringify(entry)}`)
  }
  return text
}

/**
 * 把 authority 推进 connection.trustedHosts，返回只撤销"本次自己加入"那一条的 disposer。
 * 已存在（例如 --trusted-host 已配置）时不重复添加，disposer 也不动它。
 */
export function ensureTrusted(connection, authority) {
  if (!connection) throw new TailscaleError('tailscale/no-connection', 'connection 服务不可用')
  const list = connection.trustedHosts
  if (!Array.isArray(list)) {
    throw new TailscaleError('tailscale/trust-unavailable', 'connection.trustedHosts 不是可变数组（DSH 版本不兼容）')
  }
  const entry = assertAuthority(authority)
  const lower = entry.toLowerCase()
  const existed = list.some((item) => String(item).toLowerCase() === lower)
  if (!existed) list.push(entry)
  let disposed = false
  return () => {
    if (existed || disposed) return
    disposed = true
    const index = list.findIndex((item) => String(item).toLowerCase() === lower)
    if (index >= 0) list.splice(index, 1)
  }
}

/** 当前是否已有该 authority（health 用）。 */
export function isTrusted(connection, authority) {
  const list = connection?.trustedHosts
  if (!Array.isArray(list)) return false
  const lower = String(authority || '').toLowerCase()
  return list.some((item) => String(item).toLowerCase() === lower)
}
