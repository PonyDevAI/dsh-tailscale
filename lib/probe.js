// dsh-tailscale · 可达性探测
// 单次 TCP connect，不握手、不发协议数据；调用方负责只探测 tailnet 地址。
import net from 'node:net'
import { isTailnetAddress } from './devices.js'

/** @returns {Promise<{ ok: boolean, ms: number, error?: string }>} */
export function probeTcp(host, port, { timeoutMs = 800 } = {}) {
  const targetHost = String(host || '').trim()
  const targetPort = Number(port)
  if (!targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    return Promise.resolve({ ok: false, ms: 0, error: 'bad-target' })
  }
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 10000) : 800
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok, error) => {
      if (settled) return
      settled = true
      resolve({ ok, ms: Date.now() - started, ...(error ? { error } : {}) })
    }
    const socket = net.connect({ host: targetHost, port: targetPort })
    socket.setTimeout(timeout)
    socket.once('connect', () => {
      socket.destroy()
      finish(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      finish(false, 'timeout')
    })
    socket.once('error', (error) => {
      socket.destroy()
      finish(false, error && error.code ? String(error.code) : 'error')
    })
  })
}

/** 目标是否允许探测：tailnet 地址，或调用方已确认在设备清单里的主机名。 */
export function assertProbeTarget(host, { knownHosts = [] } = {}) {
  const text = String(host || '').trim().toLowerCase()
  if (!text) return false
  if (isTailnetAddress(text)) return true
  return knownHosts.some((known) => String(known).toLowerCase() === text)
}
