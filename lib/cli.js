// dsh-tailscale · Tailscale CLI 封装
// - 一律 execFile + 参数数组 + 超时，不经过 shell
// - 只调用只读命令与 serve 的增删；绝不调用 up / down / login / serve reset
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class TailscaleError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'TailscaleError'
    this.code = code
    Object.assign(this, extra)
  }
}

const MAC_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const WIN_CLI = join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')

/** 解析 CLI 路径：显式配置 > PATH > 平台默认位置。 */
export function resolveCliPath(configured = 'auto') {
  if (typeof configured === 'string' && configured && configured !== 'auto') return configured
  if (process.env.TAILSCALE_CLI) return process.env.TAILSCALE_CLI
  if (process.platform === 'darwin' && existsSync(MAC_CLI)) return MAC_CLI
  if (process.platform === 'win32' && existsSync(WIN_CLI)) return WIN_CLI
  return 'tailscale' // 交给 PATH
}

/** 把 CLI 失败归类成稳定的错误码。 */
export function classifyCliError(error, text, argv = []) {
  const message = String(text || error?.message || '').trim()
  if (error?.code === 'ENOENT') {
    return new TailscaleError('tailscale/not-installed', `找不到 tailscale CLI${argv.length ? `（${argv[0]}）` : ''}`, { cause: error })
  }
  if (error?.killed || error?.signal === 'SIGTERM' || /timed? ?out/i.test(message)) {
    return new TailscaleError('tailscale/timeout', `tailscale ${argv[0] || ''} 超时`, { cause: error })
  }
  if (/not running|failed to connect|backend.*(stopped|not running)|machine is not running/i.test(message)) {
    return new TailscaleError('tailscale/not-running', 'Tailscale 未运行', { cause: error })
  }
  if (/logged out|needs login|not logged in|login\.tailscale\.com|auth ?url/i.test(message)) {
    return new TailscaleError('tailscale/not-logged-in', 'Tailscale 未登录', { cause: error })
  }
  if (/permission denied|access denied|operation not permitted|must be root|set --operator/i.test(message)) {
    return new TailscaleError('tailscale/permission', message || '没有权限操作 Tailscale', { cause: error })
  }
  if (/https.*not enabled|tls.*(disabled|unavailable)|certificate|magicdns/i.test(message)) {
    return new TailscaleError('tailscale/https-disabled', message || 'tailnet 未启用 HTTPS/MagicDNS', { cause: error })
  }
  if (/already serving|already (in use|exists)|conflict/i.test(message)) {
    return new TailscaleError('tailscale/route-conflict', message || 'serve 路由冲突', { cause: error })
  }
  return new TailscaleError('tailscale/cli-failed', message || `tailscale ${argv[0] || ''} 失败`, { cause: error })
}

function parseJson(text, label) {
  const raw = String(text || '').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    // 防御：输出里混了日志时，截取首尾花括号再试一次。
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {}
    }
    throw new TailscaleError('tailscale/bad-output', `tailscale ${label} 输出不是 JSON：${JSON.stringify(raw.slice(0, 160))}`)
  }
}

export class TailscaleCli {
  constructor({ cliPath = 'auto', timeoutMs = 8000 } = {}) {
    this.cliPath = resolveCliPath(cliPath)
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000
  }

  run(args, { timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.timeoutMs
      // App Store 版 Tailscale CLI 在没有 TERM 的环境里会走"启动 GUI"分支并报
      // `CLIError error 3`（launchd 启动的 host 进程就没有 TERM）。补一个默认值让 CLI 走命令行路径。
      const env = { ...process.env, TERM: process.env.TERM || 'xterm-256color' }
      execFile(this.cliPath, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env }, (error, stdout, stderr) => {
        if (error) {
          reject(classifyCliError(error, stderr || stdout || '', args))
          return
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
      })
    })
  }

  /** `tailscale version` 的第一行；输出不像版本号时按 CLI 失败处理。 */
  async version() {
    const { stdout } = await this.run(['version'], { timeoutMs: 5000 })
    const first = String(stdout).trim().split(/\r?\n/)[0] || ''
    if (!/^\d+\.\d+/.test(first)) {
      throw new TailscaleError('tailscale/cli-failed', first || 'tailscale version 没有返回版本号')
    }
    return first
  }

  async statusJson() {
    const { stdout } = await this.run(['status', '--json'], { timeoutMs: 5000 })
    return parseJson(stdout, 'status --json')
  }

  async serveStatusJson() {
    try {
      const { stdout } = await this.run(['serve', 'status', '--json'], { timeoutMs: 5000 })
      return parseJson(stdout, 'serve status --json')
    } catch (error) {
      // 只有明确表示"没有 serve 配置"时才视为空；超时/权限等继续上抛，
      // 否则健康检查会把"读不到"误判成"未开启 Funnel"。
      if (/no serve|not serving|no config|serve is not enabled|no handlers/i.test(String(error?.message || ''))) return {}
      throw error
    }
  }

  async serveCreate({ httpsPort, path, target }) {
    const args = ['serve', '--bg', `--https=${httpsPort}`]
    if (path && path !== '/') args.push(`--set-path=${path}`)
    args.push(target)
    const { stdout, stderr } = await this.run(args, { timeoutMs: 10000 })
    return String(stdout || stderr || '').trim()
  }

  async serveOff({ httpsPort, path }) {
    const args = ['serve', `--https=${httpsPort}`]
    if (path && path !== '/') args.push(`--set-path=${path}`)
    args.push('off')
    const { stdout, stderr } = await this.run(args, { timeoutMs: 10000 })
    return String(stdout || stderr || '').trim()
  }
}
