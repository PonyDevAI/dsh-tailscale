// dsh-tailscale · 检查更新（npm registry，10 分钟缓存）
// 只读公开 registry；不登录、不上报任何标识；返回可复制的升级命令。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = '@ponydev/dsh-tailscale'
const REGISTRY = 'https://registry.npmjs.org/'
const CACHE_MS = 10 * 60 * 1000

/** 每次检查时读 package.json：HMR/本地开发 bump 版本后无需重启宿主。 */
function currentVersion() {
  try {
    return JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

let cache = { at: 0, data: null }

function cmpVersion(a, b) {
  const pa = String(a || '').split('-')[0].split('.').map(Number)
  const pb = String(b || '').split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0
    const db = Number.isFinite(pb[i]) ? pb[i] : 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

export async function checkUpdate({ force = false } = {}) {
  const now = Date.now()
  if (!force && cache.data && now - cache.at < CACHE_MS) return cache.data
  const selfVersion = currentVersion()
  const result = {
    name: PKG_NAME,
    registry: REGISTRY,
    current: selfVersion,
    latest: null,
    updateAvailable: false,
    checkedAt: now,
    command: `dsh plugin --profile web add ${PKG_NAME}@latest`,
    error: null,
  }
  try {
    const response = await fetch(`${REGISTRY}${PKG_NAME.replace('/', '%2F')}/latest`, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-tailscale-update-check' },
      signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404) throw new Error('npm 上还没有发布这个包（首次发布前属于正常状态）')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    const latest = typeof body.version === 'string' ? body.version : null
    if (!latest) throw new Error('registry 未返回 version')
    result.latest = latest
    result.updateAvailable = cmpVersion(latest, selfVersion) > 0
    result.command = `dsh plugin --profile web add ${PKG_NAME}@${latest}`
  } catch (error) {
    result.error = error && error.message ? String(error.message).slice(0, 200) : '检查更新失败'
  }
  // 只缓存成功结果：偶发的 404/500/超时不该让设置页在 10 分钟内一直显示旧错误。
  if (!result.error) cache = { at: now, data: result }
  return result
}
