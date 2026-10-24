#!/usr/bin/env node
// dsh-tailscale · 假 Tailscale CLI（测试专用，完全离线）
// - 由 `lib/cli.js` 通过 cliPath 调用，行为和可观测输出对齐 Tailscale 1.104 的只读面与 serve 增删
// - 只实现 smoke.mjs 需要的子命令；其余命令一律报错 exit 1（含 `down` / `up` / `login`）
// - 每次调用都把 argv 追加进 `$FAKE_TAILSCALE_HOME/calls.log`（每行一个 JSON），
//   测试用它断言"某命令绝不该出现"（serve reset / down）
//
// 环境变量：
//   FAKE_TAILSCALE_HOME  必填。status.json / serve.json / calls.log 所在目录（不存在会自动建）
//   FAKE_TAILSCALE_HOST  可选。serve 的 authority host，默认取 status.json 的 Self.DNSName（去尾点）
//   FAKE_TAILSCALE_FAIL  可选。模拟失败：`<mode>` 或 `<mode>@<命令过滤>`
//                        mode ∈ not-running | not-logged-in | permission | https-disabled
//                             | conflict | cli-failed | garbage
//                        过滤命中 argv[0]、`argv[0] argv[1]` 或整条命令行的子串；
//                        不写过滤 = 所有命令都失败。garbage 用 exit 0 + 非 JSON 输出模拟坏输出。
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)

const FAIL_MODES = {
  // 这些 stderr 文本刻意对齐 lib/cli.js 的 classifyCliError 正则。
  'not-running': { code: 1, stderr: 'tailscale is not running' },
  'not-logged-in': { code: 1, stderr: 'fetching control keys: needs login: https://login.tailscale.com/a/fake' },
  permission: { code: 1, stderr: 'permission denied: set --operator=$USER to allow serve changes' },
  'https-disabled': { code: 1, stderr: 'HTTPS is not enabled on this tailnet' },
  conflict: { code: 1, stderr: 'already serving on path /' },
  'cli-failed': { code: 1, stderr: 'unexpected internal error' },
  // 模拟 CLI 超时：stderr 文案命中 classifyCliError 的 /timed? ?out/i。
  timeout: { code: 1, stderr: 'dial tcp 127.0.0.1:443: i/o timeout (Client.Timeout exceeded)' },
  // `up` 失败：stderr 会回显读到的 auth key（只为验证 service 侧脱敏）；calls.log 里仍只有 argv。
  'up-failed': { code: 1, stderr: '' },
  // 非 JSON 输出：验证 parseJson 的 tailscale/bad-output 归类（exit 0）。
  garbage: { code: 0, stdout: 'this is not JSON at all' },
}

function toStdout(text) {
  process.stdout.write(`${text}\n`)
}

function toStderr(text) {
  process.stderr.write(`${text}\n`)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stripDot(value) {
  return typeof value === 'string' ? value.replace(/\.$/, '') : ''
}

function normalizePath(value) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : '/'
  return text.startsWith('/') ? text : `/${text}`
}

function readStatus(home) {
  const file = join(home, 'status.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readServeConfig(home) {
  const file = join(home, 'serve.json')
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8')
  if (!text.trim()) return {}
  const parsed = JSON.parse(text)
  return isPlainObject(parsed) ? parsed : {}
}

/** 读 serve.json；损坏时返回错误而不是崩栈。 */
function loadServe(home) {
  try {
    return { config: readServeConfig(home) }
  } catch {
    return { error: `serve.json is not valid JSON (${join(home, 'serve.json')})` }
  }
}

function writeServe(home, config) {
  writeFileSync(join(home, 'serve.json'), `${JSON.stringify(config, null, 2)}\n`)
}

/** 解析 `<mode>` 或 `<mode>@<filter>`，返回命中的 mode / 'unknown' / null。 */
function requestedFailure() {
  const raw = process.env.FAKE_TAILSCALE_FAIL
  if (!raw) return null
  const at = raw.indexOf('@')
  const mode = at === -1 ? raw : raw.slice(0, at)
  if (!FAIL_MODES[mode]) return 'unknown'
  if (at === -1) return mode
  const filter = raw.slice(at + 1)
  const head = `${argv[0] || ''} ${argv[1] || ''}`.trim()
  const hit = argv[0] === filter || head === filter || argv.join(' ').includes(filter)
  return hit ? mode : null
}

function parseServeArgs(tokens) {
  const result = { action: 'on', bg: false, httpsPort: '443', path: '/', target: '', error: '' }
  const positional = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--bg') {
      result.bg = true
      continue
    }
    if (token.startsWith('--https=')) {
      result.httpsPort = token.slice('--https='.length)
      continue
    }
    if (token === '--https') {
      result.httpsPort = tokens[index + 1] || ''
      index += 1
      continue
    }
    if (token.startsWith('--set-path=')) {
      result.path = token.slice('--set-path='.length)
      continue
    }
    if (token === '--set-path') {
      result.path = tokens[index + 1] || ''
      index += 1
      continue
    }
    if (token.startsWith('--')) {
      result.error = `unsupported flag: ${token}`
      return result
    }
    positional.push(token)
  }
  if (!/^\d{1,5}$/.test(result.httpsPort)) {
    result.error = `invalid --https port: ${JSON.stringify(result.httpsPort)}`
    return result
  }
  result.path = normalizePath(result.path)
  const last = positional[positional.length - 1] ?? ''
  if (last === 'off') {
    result.action = 'off'
    return result
  }
  result.target = last
  if (!result.target) {
    result.error = 'serve create 缺少 target'
    return result
  }
  if (!/^https?:\/\//i.test(result.target)) {
    result.error = `target 不是 http(s) URL: ${result.target}`
    return result
  }
  return result
}

/** host：显式覆盖 > status.json 的 Self.DNSName（去尾点）。 */
function resolveHost(home) {
  const explicit = String(process.env.FAKE_TAILSCALE_HOST || '').trim()
  if (explicit) return stripDot(explicit)
  const status = readStatus(home)
  return stripDot(status?.Self?.DNSName || '')
}

function runStatus(home) {
  if (!argv.includes('--json')) {
    toStderr('fake-tailscale: only `status --json` is implemented')
    return 1
  }
  const data = readStatus(home)
  if (!data) {
    toStderr(`fake-tailscale: unable to read ${join(home, 'status.json')} (missing or invalid JSON)`)
    return 1
  }
  toStdout(JSON.stringify(data, null, 2))
  return 0
}

function runServeStatus(home) {
  const loaded = loadServe(home)
  if (loaded.error) {
    toStderr(`fake-tailscale: ${loaded.error}`)
    return 1
  }
  // 没有 serve 配置时真实 CLI 返回空输出/非零；这里统一给 `{}`，与 cli.js 的"无路由"语义一致。
  toStdout(JSON.stringify(loaded.config, null, 2))
  return 0
}

/** 撤掉最后一条 handler 后，tailscaled 会一并清掉端口映射；这里照做，避免留下 TCP-only 的"冲突"态。 */
function compactServe(config) {
  if (isPlainObject(config.Web)) {
    for (const authority of Object.keys(config.Web)) {
      const handlers = config.Web[authority]?.Handlers
      if (!isPlainObject(handlers) || Object.keys(handlers).length === 0) delete config.Web[authority]
    }
    if (Object.keys(config.Web).length === 0) delete config.Web
  }
  if (!isPlainObject(config.Web)) delete config.TCP
  for (const key of Object.keys(config)) {
    if (isPlainObject(config[key]) && Object.keys(config[key]).length === 0) delete config[key]
  }
  return config
}

function runServeOn(home, parsed) {
  const host = resolveHost(home)
  if (!host) {
    toStderr('fake-tailscale: cannot resolve host (set FAKE_TAILSCALE_HOST or status.json Self.DNSName)')
    return 1
  }
  const loaded = loadServe(home)
  if (loaded.error) {
    toStderr(`fake-tailscale: ${loaded.error}`)
    return 1
  }
  const config = loaded.config
  const port = String(Number(parsed.httpsPort))
  config.TCP = isPlainObject(config.TCP) ? config.TCP : {}
  config.TCP[port] = { ...(isPlainObject(config.TCP[port]) ? config.TCP[port] : {}), HTTPS: true }
  const authority = `${host}:${port}`
  config.Web = isPlainObject(config.Web) ? config.Web : {}
  const entry = isPlainObject(config.Web[authority]) ? config.Web[authority] : { Handlers: {} }
  entry.Handlers = isPlainObject(entry.Handlers) ? entry.Handlers : {}
  entry.Handlers[parsed.path] = { Proxy: parsed.target }
  config.Web[authority] = entry
  writeServe(home, config)
  toStdout(`https://${authority}${parsed.path} proxies to ${parsed.target}`)
  toStdout('serve started in background')
  return 0
}

function runServeOff(home, parsed) {
  const host = resolveHost(home)
  if (!host) {
    toStderr('fake-tailscale: cannot resolve host (set FAKE_TAILSCALE_HOST or status.json Self.DNSName)')
    return 1
  }
  const loaded = loadServe(home)
  if (loaded.error) {
    toStderr(`fake-tailscale: ${loaded.error}`)
    return 1
  }
  const config = loaded.config
  const authority = `${host}:${String(Number(parsed.httpsPort))}`
  const handlers = isPlainObject(config.Web?.[authority]?.Handlers) ? config.Web[authority].Handlers : null
  if (!handlers || !(parsed.path in handlers)) {
    // 路由本来就不在：视为幂等成功（service.unpublish 也把这种情况当"已撤销"）。
    toStdout(`no serve config for https://${authority}${parsed.path}`)
    return 0
  }
  delete handlers[parsed.path]
  writeServe(home, compactServe(config))
  toStdout(`serve ${parsed.path} off for https://${authority}`)
  return 0
}

function writeStatus(home, status) {
  writeFileSync(join(home, 'status.json'), `${JSON.stringify(status, null, 2)}\n`)
}

function authKeyFileFromArgs(args) {
  for (const token of args) {
    if (token.startsWith('--auth-key=file:')) return token.slice('--auth-key=file:'.length)
  }
  return ''
}

function hostnameFromArgs(args) {
  for (const token of args) {
    if (token.startsWith('--hostname=')) return token.slice('--hostname='.length)
  }
  return ''
}

/** `tailscale up`：读 auth key 文件登录（只记录"读到过 + 文件权限位"，绝不记录内容）。 */
function runUp(home) {
  const status = readStatus(home)
  if (!status) {
    toStderr(`fake-tailscale: unable to read ${join(home, 'status.json')}`)
    return 1
  }
  for (const token of argv.slice(1)) {
    if (token.startsWith('--hostname=')) continue
    if (token.startsWith('--auth-key=file:') || token.startsWith('--auth-key=')) continue
    toStderr(`fake-tailscale: unsupported up flag: ${token}`)
    return 1
  }
  const keyFile = authKeyFileFromArgs(argv)
  if (keyFile) {
    if (!existsSync(keyFile)) {
      toStderr(`fake-tailscale: auth key file not found: ${keyFile}`)
      return 1
    }
    let keyText = ''
    try {
      keyText = readFileSync(keyFile, 'utf8')
    } catch {
      keyText = ''
    }
    if (!keyText.trim()) {
      toStderr('fake-tailscale: auth key file is empty')
      return 1
    }
    const keyMode = statSync(keyFile).mode & 0o777
    // 密钥内容不落盘、不进日志；只把 marker 与文件权限写进 status.json 供测试断言。
    status.FakeUp = { authKeyProvided: true, authKeyMode: keyMode }
  }
  const hostname = hostnameFromArgs(argv)
  status.BackendState = 'Running'
  status.HaveNodeKey = true
  status.TUN = true
  status.Self = isPlainObject(status.Self) ? status.Self : {}
  status.Self.Online = true
  if (hostname) status.Self.HostName = hostname
  writeStatus(home, status)
  toStdout(hostname ? `Logged in; hostname set to ${hostname}` : 'Logged in')
  return 0
}

/** `tailscale set --hostname=<name>`：更新 status.json 的 Self.HostName。 */
function runSet(home) {
  const status = readStatus(home)
  if (!status) {
    toStderr(`fake-tailscale: unable to read ${join(home, 'status.json')}`)
    return 1
  }
  let hostname = ''
  for (const token of argv.slice(1)) {
    if (token.startsWith('--hostname=')) {
      hostname = token.slice('--hostname='.length)
      continue
    }
    toStderr(`fake-tailscale: unsupported set flag: ${token}`)
    return 1
  }
  if (!hostname) {
    toStderr('fake-tailscale: set 需要 --hostname=<name>')
    return 1
  }
  status.Self = isPlainObject(status.Self) ? status.Self : {}
  status.Self.HostName = hostname
  writeStatus(home, status)
  toStdout(`hostname set to ${hostname}`)
  return 0
}

function runServe(home) {
  const sub = argv[1] || ''
  if (sub === 'status') return runServeStatus(home)
  if (sub === 'reset') {
    writeServe(home, {})
    toStdout('serve config reset')
    return 0
  }
  const parsed = parseServeArgs(argv.slice(1))
  if (parsed.error) {
    toStderr(`fake-tailscale: ${parsed.error}`)
    return 1
  }
  if (parsed.action === 'off') return runServeOff(home, parsed)
  return runServeOn(home, parsed)
}

function main() {
  const home = process.env.FAKE_TAILSCALE_HOME
  if (!home) {
    toStderr('fake-tailscale: FAKE_TAILSCALE_HOME is not set')
    return 2
  }
  mkdirSync(home, { recursive: true })
  appendFileSync(join(home, 'calls.log'), `${JSON.stringify({ argv, cwd: process.cwd(), at: new Date().toISOString() })}\n`)

  const failure = requestedFailure()
  if (failure === 'unknown') {
    toStderr(`fake-tailscale: unknown FAKE_TAILSCALE_FAIL mode: ${process.env.FAKE_TAILSCALE_FAIL}`)
    return 2
  }
  if (failure === 'up-failed') {
    // 故意把 key 回显到 stderr（execFile 只捕获、不会打印到终端），用来验证 service 侧脱敏。
    const keyFile = authKeyFileFromArgs(argv)
    let key = ''
    if (keyFile && existsSync(keyFile)) {
      try {
        key = readFileSync(keyFile, 'utf8').trim()
      } catch {
        key = ''
      }
    }
    // 除了真实 key 再拼一个「看起来像 key」的 decoy，用来验证 service 侧的正则兜底脱敏。
    toStderr(`up failed: invalid authkey ${key || '(missing key file)'} (seen also: tskey-decoyAAAA1111BBBB)`)
    return 1
  }
  if (failure) {
    const spec = FAIL_MODES[failure]
    if (spec.stdout) toStdout(spec.stdout)
    if (spec.stderr) toStderr(spec.stderr)
    return spec.code
  }

  const command = argv[0] || ''
  if (command === 'version') {
    toStdout('1.104.2-fake')
    return 0
  }
  if (command === 'status') return runStatus(home)
  if (command === 'serve') return runServe(home)
  if (command === 'up') return runUp(home)
  if (command === 'set') return runSet(home)
  // 刻意不实现 down / login / logout / funnel 等：插件不该调用它们。
  toStderr(`fake-tailscale: unsupported command: ${argv.join(' ') || '(empty)'}`)
  return 1
}

process.exitCode = main()
