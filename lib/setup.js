// dsh-tailscale · 统一系统 Tailscale 的安装 / 启动 / 登录 / 主机名管理
// 原则：
// - 只操作本机这一套 Tailscale，不创建独立节点/独立 daemon
// - 安装必须用户显式触发（allowAutoInstall 只是允许"代跑"），失败一律如实归类
// - auth key 不落盘、不进日志：用临时文件 + `--auth-key=file:` 传给 CLI，用完即删
// - 只读/动作分开：detect 不产生副作用，install/start/login/setHostname 才动系统
import { execFile } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TailscaleError } from './cli.js'

const MAC_APP = '/Applications/Tailscale.app'
const MAC_APP_CLI = `${MAC_APP}/Contents/MacOS/Tailscale`
const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
const CLI_PATHS = ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale']
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const AUTH_KEY_RE = /^tskey-[A-Za-z0-9_-]{10,300}$/

function findOnPath(bin) {
  const path = process.env.PATH || ''
  for (const dir of path.split(':')) {
    if (!dir) continue
    const candidate = join(dir, bin)
    if (existsSync(candidate)) return candidate
  }
  return ''
}

function pushLog(state, line) {
  const text = String(line || '').trim()
  if (!text) return
  state.log.push(text.slice(0, 500))
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40)
}

/** 检测本机 Tailscale 安装情况（无副作用，可被 UI 轮询）。 */
export function detectInstall({ cliPath = 'auto' } = {}) {
  const explicit = typeof cliPath === 'string' && cliPath && cliPath !== 'auto' ? cliPath : ''
  const envCli = process.env.TAILSCALE_CLI || ''
  const appInstalled = existsSync(MAC_APP)
  const brewPath = BREW_PATHS.find((candidate) => existsSync(candidate)) || ''
  const candidates = [explicit, envCli, ...CLI_PATHS, appInstalled ? MAC_APP_CLI : '', findOnPath('tailscale')].filter(Boolean)
  const resolved = candidates.find((candidate) => candidate.includes('/') && existsSync(candidate)) || ''
  const platform = process.platform
  const method = platform === 'darwin' ? (brewPath ? 'brew' : 'pkg') : platform === 'linux' ? 'script' : platform === 'win32' ? 'winget' : 'manual'
  const canAutoInstall =
    platform === 'darwin' ? true : platform === 'linux' ? typeof process.getuid === 'function' && process.getuid() === 0 : platform === 'win32'
  return {
    platform,
    installed: !!resolved,
    cliPath: resolved,
    appPath: appInstalled ? MAC_APP : '',
    viaAppBundle: !!resolved && resolved.startsWith(MAC_APP),
    brewPath,
    method,
    canAutoInstall,
    source: resolved ? (resolved.startsWith(MAC_APP) ? 'app' : 'path') : 'none',
  }
}

function runFile(file, args, { timeout = 60000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: env ? { ...process.env, ...env } : process.env }, (error, stdout, stderr) => {
      if (error) {
        const message = String(stderr || stdout || error.message || '').trim()
        reject(new TailscaleError('tailscale/install-failed', message.slice(0, 400) || `${file} ${args[0] || ''} 失败`, { cause: error }))
        return
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function download(url, destination, { timeoutMs = 180000, hops = 0 } = {}) {
  if (hops > 5) throw new TailscaleError('tailscale/install-failed', '下载 Tailscale 安装包重定向次数过多')
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { 'user-agent': 'dsh-tailscale' } }, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        const next = new URL(response.headers.location, url).toString()
        resolve(download(next, destination, { timeoutMs, hops: hops + 1 }))
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new TailscaleError('tailscale/install-failed', `下载安装包失败：HTTP ${status}`))
        return
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', async () => {
        try {
          await fsp.writeFile(destination, Buffer.concat(chunks), { mode: 0o600 })
          resolve({ path: destination, bytes: Buffer.concat(chunks).length })
        } catch (error) {
          reject(new TailscaleError('tailscale/install-failed', `写入安装包失败：${error?.message || error}`))
        }
      })
      response.on('error', reject)
    })
    request.on('timeout', () => {
      request.destroy()
      reject(new TailscaleError('tailscale/install-failed', '下载安装包超时'))
    })
    request.on('error', (error) => reject(new TailscaleError('tailscale/install-failed', `下载安装包失败：${error?.message || error}`)))
  })
}

export class SetupManager {
  constructor({ cliPath = 'auto', config = {}, cli, log = () => {} }) {
    this.cliPath = cliPath
    this.config = config
    this.cli = cli
    this.log = log
    this.state = {
      running: false,
      phase: 'idle',
      method: '',
      startedAt: 0,
      endedAt: 0,
      error: null,
      log: [],
    }
    this.installPromise = null
  }

  detect() {
    return detectInstall({ cliPath: this.cliPath })
  }

  info() {
    const detected = this.detect()
    return {
      ...detected,
      allowAutoInstall: this.config.allowAutoInstall !== false,
      installMethod: this.config.installMethod || 'auto',
      state: {
        running: this.state.running,
        phase: this.state.phase,
        method: this.state.method,
        startedAt: this.state.startedAt,
        endedAt: this.state.endedAt,
        error: this.state.error,
        log: this.state.log.slice(-12),
      },
    }
  }

  #begin(method) {
    this.state = { running: true, phase: 'starting', method, startedAt: Date.now(), endedAt: 0, error: null, log: [] }
  }

  #finish(error = null) {
    this.state.running = false
    this.state.phase = error ? 'failed' : 'done'
    this.state.endedAt = Date.now()
    this.state.error = error ? { code: error.code || 'tailscale/install-failed', message: String(error.message || error).slice(0, 400) } : null
  }

  /** 代跑安装（必须用户显式调用；allowAutoInstall=false 时直接拒绝）。 */
  async install() {
    if (this.config.allowAutoInstall === false) {
      throw new TailscaleError('tailscale/install-disabled', 'allowAutoInstall 未开启，请在插件配置里允许后再安装')
    }
    const detected = this.detect()
    if (detected.installed) throw new TailscaleError('tailscale/already-installed', '本机已安装 Tailscale')
    // 并发安装请求共享同一个任务，而不是第二个直接失败。
    if (this.installPromise) return this.installPromise
    const method = this.#effectiveMethod(detected)
    this.#begin(method)
    this.installPromise = this.#runInstall(detected, method)
      .then(() => {
        this.#finish(null)
        return this.info()
      })
      .catch((error) => {
        this.#finish(error)
        throw error
      })
      .finally(() => {
        this.installPromise = null
      })
    return this.installPromise
  }

  /** installMethod 配置优先；manual 表示只给命令不代跑。 */
  #effectiveMethod(detected) {
    const requested = String(this.config.installMethod || 'auto')
    if (requested === 'manual') throw new TailscaleError('tailscale/install-manual', 'installMethod=manual：请手动安装 Tailscale，或改为 auto')
    if (requested === 'auto' || !requested) return detected.method
    if (detected.platform === 'darwin') {
      if (requested === 'brew' && !detected.brewPath) throw new TailscaleError('tailscale/install-failed', 'installMethod=brew 但找不到 Homebrew')
      if (requested === 'pkg' || requested === 'brew') return requested
    }
    if (requested === 'script' && detected.platform === 'linux') return requested
    if (requested === 'winget' && detected.platform === 'win32') return requested
    return detected.method
  }

  async #runInstall(detected, method = detected.method) {
    if (detected.platform === 'darwin') {
      if (method === 'brew') return this.#installViaBrew(detected)
      return this.#installViaPkg(detected)
    }
    if (detected.platform === 'linux') {
      if (!detected.canAutoInstall) {
        throw new TailscaleError('tailscale/permission', 'Linux 自动安装需要 root；请用 root 运行，或执行：curl -fsSL https://tailscale.com/install.sh | sh')
      }
      this.state.phase = 'installing'
      const script = join(tmpdir(), `dsh-tailscale-install-${process.pid}.sh`)
      pushLog(this.state, '下载官方安装脚本…')
      await download('https://tailscale.com/install.sh', script)
      pushLog(this.state, '执行安装脚本…')
      await runFile('/bin/sh', [script], { timeout: 15 * 60 * 1000 })
      await fsp.rm(script, { force: true })
      pushLog(this.state, '安装完成')
      return
    }
    if (detected.platform === 'win32') {
      this.state.phase = 'installing'
      pushLog(this.state, 'winget 安装 Tailscale…')
      await runFile('winget', ['install', '--id', 'Tailscale.Tailscale', '--accept-source-agreements', '--accept-package-agreements', '--silent'], { timeout: 15 * 60 * 1000 })
      pushLog(this.state, '安装完成')
      return
    }
    throw new TailscaleError('tailscale/install-failed', `当前平台（${detected.platform}）不支持自动安装，请从 tailscale.com/download 手动安装`)
  }

  async #installViaBrew(detected) {
    this.state.phase = 'installing'
    pushLog(this.state, `brew install --cask tailscale-app（${detected.brewPath}）`)
    const { stdout, stderr } = await runFile(detected.brewPath, ['install', '--cask', 'tailscale-app'], {
      timeout: 20 * 60 * 1000,
      env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', NONINTERACTIVE: '1' },
    })
    for (const line of `${stdout}\n${stderr}`.split(/\r?\n/).slice(-10)) pushLog(this.state, line)
    const after = this.detect()
    if (!after.installed) throw new TailscaleError('tailscale/install-failed', 'brew 返回成功但未检测到 Tailscale，请打开 Tailscale.app 完成首次授权')
    pushLog(this.state, '安装完成')
  }

  async #installViaPkg(detected) {
    this.state.phase = 'downloading'
    const pkg = join(tmpdir(), `Tailscale-latest-${process.pid}.pkg`)
    pushLog(this.state, '下载官方 macOS 安装包…')
    const file = await download('https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg', pkg)
    pushLog(this.state, `安装包 ${Math.round(file.bytes / 1024 / 1024)} MB，等待系统授权…`)
    this.state.phase = 'installing'
    const script = `do shell script "/usr/sbin/installer -pkg ${pkg.replace(/(["\\$`])/g, '\\$1')} -target /" with administrator privileges`
    await runFile('/usr/bin/osascript', ['-e', script], { timeout: 20 * 60 * 1000 })
    await fsp.rm(pkg, { force: true })
    const after = this.detect()
    if (!after.installed) throw new TailscaleError('tailscale/install-failed', '安装包执行成功但未检测到 Tailscale')
    pushLog(this.state, '安装完成')
  }

  /** 启动本机 Tailscale（macOS 拉起 App；其余平台提示命令）。 */
  async start() {
    const detected = this.detect()
    if (!detected.installed) throw new TailscaleError('tailscale/not-installed', '尚未安装 Tailscale')
    if (detected.platform === 'darwin') {
      if (detected.appPath) {
        await runFile('/usr/bin/open', ['-a', 'Tailscale'])
        return { ok: true, hint: '已尝试启动 Tailscale.app；若首次运行，请在系统设置里允许 VPN 配置' }
      }
      // CLI-only 安装（例如 brew 的 tailscale 包）没有 App：给出明确命令而不是误报安装失败。
      return { ok: false, hint: '没有 Tailscale.app；CLI-only 安装请执行：sudo brew services start tailscale（或手动运行 tailscaled）' }
    }
    if (detected.platform === 'linux') {
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        await runFile('systemctl', ['start', 'tailscaled'], { timeout: 30000 }).catch(() => {})
        return { ok: true }
      }
      return { ok: false, hint: '请执行：sudo systemctl start tailscaled' }
    }
    return { ok: false, hint: '请在系统里启动 Tailscale' }
  }

  /** 交互登录 URL（NeedsLogin 时可用；属于一次性凭据，只在已认证 RPC 中返回）。 */
  async authUrl() {
    const raw = await this.cli.statusJson()
    const url = typeof raw?.AuthURL === 'string' ? raw.AuthURL : ''
    if (!url) {
      if (raw?.BackendState === 'Running') throw new TailscaleError('tailscale/already-running', 'Tailscale 已登录并在运行')
      throw new TailscaleError('tailscale/no-auth-url', '当前没有待完成的登录（请先启动 Tailscale 或检查状态）')
    }
    return url
  }

  /** 用 auth key 登录：密钥只经过 0600 临时文件（--auth-key=file:），不出现在进程参数/日志里。 */
  async loginWithAuthKey(key, { hostname = '' } = {}) {
    const detected = this.detect()
    if (!detected.installed) throw new TailscaleError('tailscale/not-installed', '尚未安装 Tailscale')
    const authKey = String(key || '').trim()
    if (!AUTH_KEY_RE.test(authKey)) throw new TailscaleError('tailscale/bad-auth-key', 'auth key 格式不正确（应以 tskey- 开头）')
    if (hostname && !HOSTNAME_RE.test(hostname)) throw new TailscaleError('tailscale/bad-hostname', 'hostname 不合法（只允许字母、数字、连字符，总长 1–63）')
    const file = join(tmpdir(), `dsh-ts-authkey-${process.pid}-${Date.now()}`)
    await fsp.writeFile(file, `${authKey}\n`, { mode: 0o600 })
    try {
      const args = ['up', `--auth-key=file:${file}`]
      if (hostname) args.push(`--hostname=${hostname}`)
      await this.cli.run(args, { timeoutMs: 90000 })
      return { ok: true }
    } catch (error) {
      // 错误信息里绝不能回显 key：CLI 一般只说 authkey 无效，这里再做一次兜底脱敏。
      const message = String(error?.message || '')
        .split(authKey).join('tskey-***')
        .replace(/tskey-[A-Za-z0-9_-]{4,}/g, 'tskey-***')
      throw new TailscaleError(error?.code || 'tailscale/login-failed', message, { cause: error })
    } finally {
      await fsp.rm(file, { force: true })
    }
  }

  /** 修改本机节点 hostname（影响整机；UI 必须二次确认）。 */
  async setHostname(name) {
    const detected = this.detect()
    if (!detected.installed) throw new TailscaleError('tailscale/not-installed', '尚未安装 Tailscale')
    const value = String(name || '').trim()
    if (!HOSTNAME_RE.test(value)) throw new TailscaleError('tailscale/bad-hostname', 'hostname 不合法（只允许字母、数字、连字符，总长 1–63）')
    await this.cli.run(['set', `--hostname=${value}`], { timeoutMs: 30000 })
    return { ok: true, hostname: value }
  }
}
