#!/usr/bin/env node
// dsh-tailscale · 冒烟测试（完全离线：假 CLI + 临时目录，绝不调用真实 tailscale）
// - 运行：node scripts/smoke.mjs（npm run smoke）
// - 零依赖：只用 node:test / node:assert/strict（Node >= 22.5 内置）
// - 覆盖：纯函数（devices/serve/trust/state/cli 归类）→ CLI 包装 → 服务层状态机
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { TailscaleCli, TailscaleError, classifyCliError, resolveCliPath } from '../lib/cli.js'
import { compileAllow, filterDevices, findDevice, isTailnetAddress, normalizeStatus, stripDot, toDevice } from '../lib/devices.js'
import { apply, createHandler, dispatch } from '../lib/index.js'
import { authorityFor, classifyServe, funnelEnabled, listHandlers, normalizePath, normalizeProxy, webHandlers } from '../lib/serve.js'
import { assertAuthority, ensureTrusted, isTrusted } from '../lib/trust.js'
import { createStateStore } from '../lib/state.js'
import { createTailscaleService } from '../lib/service.js'
import { assertProbeTarget, probeTcp } from '../lib/probe.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const FAKE_CLI = join(SCRIPT_DIR, 'fake-tailscale.mjs')
const FIXTURES = join(SCRIPT_DIR, 'fixtures')
const HOST = 'fake-studio.tail1234.ts.net' // status-running.json 的 Self.DNSName 去掉尾点
const AUTHORITY = `${HOST}:443`

// ---------------------------------------------------------------- 临时目录
const tempDirs = new Set()

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.add(dir)
  return dir
}

function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

/**
 * 建一个临时 FAKE_TAILSCALE_HOME 并在作用域内设置环境变量；结束时删目录、还原 env。
 * 顶层 test 默认串行执行，所以进程级 env 不会被并发测试交叉污染。
 */
async function withFakeHome({ status = 'status-running.json', serve } = {}, run) {
  const home = tempDir('dsh-ts-fake-')
  if (status) writeFileSync(join(home, 'status.json'), `${JSON.stringify(fixture(status), null, 2)}\n`)
  if (serve !== undefined) writeFileSync(join(home, 'serve.json'), `${JSON.stringify(serve, null, 2)}\n`)
  const previous = {
    home: process.env.FAKE_TAILSCALE_HOME,
    fail: process.env.FAKE_TAILSCALE_FAIL,
    host: process.env.FAKE_TAILSCALE_HOST,
  }
  process.env.FAKE_TAILSCALE_HOME = home
  delete process.env.FAKE_TAILSCALE_FAIL
  delete process.env.FAKE_TAILSCALE_HOST
  try {
    return await run({ home })
  } finally {
    restoreEnv('FAKE_TAILSCALE_HOME', previous.home)
    restoreEnv('FAKE_TAILSCALE_FAIL', previous.fail)
    restoreEnv('FAKE_TAILSCALE_HOST', previous.host)
  }
}

function readServe(home) {
  const file = join(home, 'serve.json')
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readCalls(home) {
  const file = join(home, 'calls.log')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

/** `serve --bg ...`（真正的创建）调用次数。 */
function serveCreateCalls(calls) {
  return calls.filter((call) => call.argv[0] === 'serve' && call.argv.includes('--bg'))
}

/** 假 ctx：service 只通过 ctx.get(name) 取 connection / webServer。 */
function makeService({ home, trustedHosts = [], port = 3080, cliPath = FAKE_CLI, config = {} }) {
  const connection = {
    trustedHosts,
    authenticatedUrl: (url) => `${url}?token=smoke-secret-token`,
  }
  const services = { connection, webServer: { port } }
  const ctx = { get: (name) => services[name] }
  const dshHome = join(home, 'dsh-home')
  const state = createStateStore({ dshHome })
  const cli = new TailscaleCli({ cliPath })
  const service = createTailscaleService({
    ctx,
    cli,
    state,
    // deviceTtlMs: 0 → 每次读 CLI，测试不需要跟 10s 缓存赛跑。
    config: { cliPath, httpsPort: 443, publishPath: '/', deviceTtlMs: 0, dshHome, ...config },
  })
  return { service, connection, state, dshHome, stateFile: join(dshHome, 'tailscale.json') }
}

/** 等一个异步副作用（apply 的自动发布/撤回是 fire-and-forget，不返回 promise）。 */
async function waitFor(predicate, message, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

/** 最小 res 桩：createHandler 里的 json() 只用到 writeHead + end。 */
function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers || {}
    },
    end(chunk) {
      res.body = chunk === undefined || chunk === null ? '' : String(chunk)
    },
  }
  return res
}

/** 最小 req 桩：readBody 只用到 on('data'|'end'|'error')。 */
function fakeReq({ url = '/tailscale/snapshot', method = 'POST', body = '{}' } = {}) {
  const req = Readable.from([Buffer.from(String(body), 'utf8')])
  req.url = url
  req.method = method
  return req
}

async function callRpc(handler, options = {}) {
  const res = fakeRes()
  await handler(fakeReq(options), res)
  let parsed = null
  try {
    parsed = res.body ? JSON.parse(res.body) : null
  } catch {}
  return { status: res.status, headers: res.headers, body: res.body, json: parsed }
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.clear()
})

// ================================================================ 1. 纯函数 · devices
test('devices.js · normalizeStatus 归一化 Self + Peer', () => {
  const normalized = normalizeStatus(fixture('status-running.json'))
  assert.equal(normalized.backend, 'Running', 'BackendState 透传')
  assert.equal(normalized.version, '1.104.2-fake', 'Version 透传')
  assert.equal(normalized.magicDnsSuffix, 'tail1234.ts.net', 'MagicDNSSuffix 透传')
  assert.deepEqual(normalized.certDomains, [HOST], 'CertDomains 透传')
  assert.equal(normalized.dnsName, HOST, 'dnsName 取 Self.DNSName 并去掉尾点')
  assert.equal(normalized.devices.length, 3, 'Self + 2 个 Peer')
  assert.deepEqual(
    normalized.devices.map((device) => device.hostName),
    ['fake-studio', 'pixel-7a', 'macbook-air'],
    '在线优先、同组按 hostName 排序',
  )
  assert.equal(normalized.self.isSelf, true, 'Self 标记 isSelf')
  assert.equal(normalized.devices[1].isSelf, false, 'Peer 不是 isSelf')
  for (const device of normalized.devices) {
    assert.equal(device.dnsName.endsWith('.'), false, `dnsName 已去尾点：${device.dnsName}`)
  }
  assert.deepEqual(normalized.self.tags, ['tag:server'], 'Self tags')
  assert.deepEqual(normalized.self.ips, ['100.101.102.103', 'fd7a:115c:a1e0:ab12:4843:cd96:6265:6667'], 'Self ips')
  assert.equal(normalized.devices[1].direct, true, 'CurAddr 非空 → direct')
  assert.equal(normalized.devices[1].relay, 'hkg', 'Peer Relay')
  assert.deepEqual(normalized.devices[1].tags, ['tag:phone'], 'Peer tags')
  assert.equal(normalized.devices[2].online, false, '离线 Peer 保留')
  assert.equal(normalized.devices[2].lastSeen, '2026-10-20T03:21:00Z', '离线节点 lastSeen')
  assert.equal(normalized.devices[2].direct, false, 'CurAddr 为空 → 非直连')

  // 无 Self.DNSName / Self 缺失
  const noDns = normalizeStatus(fixture('status-no-dns.json'))
  assert.equal(noDns.backend, 'Running', '无 DNSName 但仍在运行')
  assert.equal(noDns.dnsName, '', '缺 DNSName 时 dnsName 为空串')
  assert.equal(noDns.devices[0].hostName, 'fake-studio', 'DNSName 缺失时回落到 HostName')

  const empty = normalizeStatus({})
  assert.equal(empty.backend, 'Unknown', '空 status 的 backend 默认 Unknown')
  assert.equal(empty.dnsName, '', '空 status 没有 dnsName')
  assert.equal(empty.self, null, '空 status 的 self 为 null')
  assert.deepEqual(empty.devices, [], '空 status 没有设备')

  assert.equal(toDevice(null), null, 'toDevice 对非对象返回 null')
  assert.equal(toDevice({ DNSName: '', HostName: '' }).hostName, 'unknown', '无 HostName 且无 DNSName → unknown')
  assert.equal(stripDot('a.b.c.'), 'a.b.c', 'stripDot 去尾点')
  assert.equal(stripDot(undefined), '', 'stripDot 非字符串 → 空串')
})

test('devices.js · filterDevices / findDevice / isTailnetAddress', () => {
  const devices = normalizeStatus(fixture('status-running.json')).devices
  const self = devices[0]
  const pixel = devices[1]
  const macbook = devices[2]

  assert.equal(filterDevices(devices, { online: true }).length, 2, 'online 过滤只留在线设备')
  assert.equal(filterDevices(devices, {}).length, 3, '空条件返回全部')
  assert.deepEqual(filterDevices(devices, { allow: ['tag:phone'] }), [pixel], 'allow 按 tags 匹配')
  assert.deepEqual(filterDevices(devices, { allow: ['fake-studio'] }), [self], 'allow 按 hostName 匹配')
  assert.deepEqual(filterDevices(devices, { allow: ['^100\\.107\\.'] }), [pixel], 'allow 按 IP 前缀匹配')
  assert.deepEqual(filterDevices(devices, { allow: ['nomatch-*'] }), [], 'allow 不命中返回空')
  assert.equal(filterDevices(devices, { allow: ['['] }).length, 3, '非法正则被忽略（空 allow = 全部）')
  const compiled = compileAllow(['tag:phone', /tag:server/, 42, '['])
  assert.equal(compiled.length, 2, 'compileAllow 只保留字符串/RegExp 且忽略非法项')

  assert.equal(findDevice(devices, 'PIXEL-7A'), pixel, '按 hostName 且大小写不敏感')
  assert.equal(findDevice(devices, 'pixel-7a.tail1234.ts.net'), pixel, '按 dnsName 精确匹配')
  assert.equal(findDevice(devices, '100.107.25.26'), pixel, '按 IP 全等匹配')
  assert.equal(findDevice(devices, '100.90.'), macbook, '按 IP 前缀匹配')
  assert.equal(findDevice(devices, 'nope.example'), null, '找不到返回 null')
  assert.equal(findDevice(devices, '  '), null, '空 ref 返回 null')

  assert.equal(isTailnetAddress('100.64.0.1'), true, '100.64/10 下界')
  assert.equal(isTailnetAddress('100.127.255.255'), true, '100.64/10 上界')
  assert.equal(isTailnetAddress('100.63.255.255'), false, '100.63 不属于 tailnet')
  assert.equal(isTailnetAddress('100.128.0.1'), false, '100.128 不属于 tailnet')
  assert.equal(isTailnetAddress('101.64.0.1'), false, '101/8 不属于 tailnet')
  assert.equal(isTailnetAddress('fd7a:115c:a1e0::1'), true, 'Tailscale IPv6 ULA')
  assert.equal(isTailnetAddress('FD7A:115C:A1E0::1'), true, 'IPv6 大小写不敏感')
  assert.equal(isTailnetAddress('fd7a:115c:a1e0'), false, 'IPv6 前缀不完整')
  assert.equal(isTailnetAddress('fd00::1'), false, '非 Tailscale ULA')
  assert.equal(isTailnetAddress('192.168.1.10'), false, '私网 IPv4 不是 tailnet')
  assert.equal(isTailnetAddress('100.64.1'), false, '残缺 IPv4')
  assert.equal(isTailnetAddress('100.64.0.1.5'), false, '五段不是 IPv4')
  // 修复项 5：严格校验八位组范围与前导零
  assert.equal(isTailnetAddress('100.64.999.999'), false, '八位组超过 255 不是 tailnet')
  assert.equal(isTailnetAddress('100.256.0.1'), false, '第二段超过 255 不是 tailnet')
  assert.equal(isTailnetAddress('100.064.0.1'), false, '前导零不是合法 IPv4')
  assert.equal(isTailnetAddress('100.64.0.01'), false, '末段前导零不是合法 IPv4')
  assert.equal(isTailnetAddress('100.64.0.00'), false, '多前导零不是合法 IPv4')
  // 修复项 5：IPv6 严格前缀 + 十六进制字符
  assert.equal(isTailnetAddress('fd7b:115c:a1e0::1'), false, 'fd7b 不是 Tailscale ULA')
  assert.equal(isTailnetAddress('fd7a:115c:a1e1::1'), false, 'a1e1 不是 Tailscale ULA')
  assert.equal(isTailnetAddress('fd7a:115c:a1e0:zz::1'), false, '非十六进制字符不是 tailnet')
  assert.equal(isTailnetAddress(''), false, '空串不是 tailnet')
})

// ================================================================ 2. 纯函数 · serve
test('serve.js · classifyServe 四态 / 路径与代理归一化', () => {
  const base = { dnsName: HOST, httpsPort: 443 }
  const exactConfig = { Web: { [AUTHORITY]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080/' } } } } }

  assert.equal(classifyServe({}, { ...base, path: '/', target: 'http://127.0.0.1:3080' }).state, 'absent', '空配置 → absent')
  assert.equal(classifyServe(exactConfig, { ...base, path: '/', target: 'http://127.0.0.1:3080' }).state, 'exact', 'Proxy 去尾斜杠后相同 → exact')
  assert.equal(classifyServe(exactConfig, { ...base, path: '/', target: 'http://127.0.0.1:3080/' }).state, 'exact', 'target 带尾斜杠也归一化')
  assert.equal(
    classifyServe(
      { Web: { [AUTHORITY]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } },
      { ...base, path: '/', target: 'http://127.0.0.1:3080', previousTarget: 'http://127.0.0.1:9999' },
    ).state,
    'stale',
    '指向上次自己的旧 target → stale',
  )
  const conflict = classifyServe(
    { Web: { [AUTHORITY]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } },
    { ...base, path: '/', target: 'http://127.0.0.1:3080' },
  )
  assert.equal(conflict.state, 'conflict', '指向其他服务 → conflict')
  assert.equal(conflict.proxy, 'http://127.0.0.1:9999', 'conflict 带原 proxy')
  assert.equal(
    classifyServe({ TCP: { 443: { HTTPS: true } } }, { ...base, path: '/', target: 'http://127.0.0.1:3080' }).state,
    'conflict',
    '443 被 TCP 占用且无 Web → conflict(tcp-port-in-use)',
  )
  assert.equal(
    classifyServe({ TCP: { 443: { HTTPS: true } } }, { ...base, path: '/', target: 'http://127.0.0.1:3080' }).reason,
    'tcp-port-in-use',
    'tcp-port-in-use 原因',
  )
  assert.equal(
    classifyServe({ TCP: { 443: { HTTPS: true } }, Web: { 'other.ts.net:443': { Handlers: {} } } }, { ...base, path: '/', target: 'http://127.0.0.1:3080' }).state,
    'absent',
    '其他 authority 上的 Web 不影响本 authority 的 absent 判定',
  )
  assert.equal(
    classifyServe({ Web: { 'other.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } }, { ...base, path: '/', target: 'http://127.0.0.1:3080' }).state,
    'absent',
    '别的 authority 的 handler 不算本路径',
  )

  assert.equal(normalizePath(''), '/', '空 path → /')
  assert.equal(normalizePath(undefined), '/', 'undefined path → /')
  assert.equal(normalizePath('dsh2'), '/dsh2', '补前导斜杠')
  assert.equal(normalizePath('  /dsh2  '), '/dsh2', '去空白')
  assert.equal(normalizeProxy('http://127.0.0.1:3080///'), 'http://127.0.0.1:3080', 'proxy 去尾斜杠')
  assert.equal(normalizeProxy(undefined), '', 'proxy 非字符串 → 空串')

  assert.equal(authorityFor(HOST, 443), AUTHORITY, 'authority = host:port')
  assert.deepEqual(webHandlers({ Web: [] }, base), {}, 'Web 不是对象 → 无 handler')
  assert.deepEqual(webHandlers({}, base), {}, '无 Web → 无 handler')

  const serveConfig = { Web: { [AUTHORITY]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' }, '/x': { Proxy: 'http://127.0.0.1:3081' } } } } }
  assert.deepEqual(
    listHandlers(serveConfig, base).map((route) => route.path).sort(),
    ['/', '/x'],
    'listHandlers 列出全部 path',
  )
  assert.equal(listHandlers(serveConfig, base).find((route) => route.path === '/x').proxy, 'http://127.0.0.1:3081', 'listHandlers 带 proxy')

  assert.equal(funnelEnabled({ AllowFunnel: { [AUTHORITY]: true } }, base), true, 'AllowFunnel=true → 开启')
  assert.equal(funnelEnabled({ AllowFunnel: { [AUTHORITY]: 'true' } }, base), true, 'AllowFunnel="true" → 开启')
  assert.equal(funnelEnabled({ AllowFunnel: { [AUTHORITY]: false } }, base), false, 'AllowFunnel=false → 关闭')
  assert.equal(funnelEnabled({}, base), false, '无 AllowFunnel → 关闭')
  assert.equal(funnelEnabled({ AllowFunnel: { 'other.ts.net:443': true } }, base), false, '其他 authority 的 Funnel 不算')
})

// ================================================================ 3. 状态文件
test('state.js · 状态文件写入/读取/清理（600、不含 token）', async () => {
  const dshHome = tempDir('dsh-ts-state-')
  const store = createStateStore({ dshHome })
  assert.equal(store.file, join(dshHome, 'tailscale.json'), '状态文件路径 = $DSH_HOME/tailscale.json')
  assert.equal(await store.read(), null, '文件不存在时 read → null')

  const payload = {
    url: `https://${HOST}/`,
    host: HOST,
    path: '/',
    target: 'http://127.0.0.1:3080',
    owned: true,
    createdAt: 1700000000000,
    dshPid: 4242,
  }
  await store.write(payload)
  assert.deepEqual(await store.read(), payload, '写进去的内容读回来一致')
  const file = store.file
  assert.equal(statSync(file).mode & 0o777, 0o600, '状态文件权限必须是 600')
  const text = readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /token/i, '状态文件不含 token')
  assert.doesNotMatch(text, /secret/i, '状态文件不含 secret')

  // 修复项 6：writeFile 的 mode 不会收紧已有文件，write() 必须显式 chmod
  const legacyFile = join(dshHome, 'legacy.json')
  writeFileSync(legacyFile, '{"legacy":true}\n')
  chmodSync(legacyFile, 0o644)
  assert.equal(statSync(legacyFile).mode & 0o777, 0o644, '构造一个 644 的旧状态文件')
  const legacyStore = createStateStore({ dshHome, fileName: 'legacy.json' })
  await legacyStore.write({ url: `https://${HOST}/` })
  assert.equal(statSync(legacyFile).mode & 0o777, 0o600, '已有状态文件写入后也被 chmod 到 600')

  await store.write({})
  assert.equal(await store.read(), null, '空对象视为无状态')

  await store.clear()
  assert.equal(existsSync(file), false, 'clear 后状态文件被删除')
  assert.equal(await store.read(), null, 'clear 后 read → null')
  await store.clear() // 幂等
})

// ================================================================ 4. trust
test('trust.js · trustedHosts 推送 / 去重 / 只回滚自己', () => {
  const connection = { trustedHosts: [] }
  const dispose = ensureTrusted(connection, HOST)
  assert.deepEqual(connection.trustedHosts, [HOST], 'ensureTrusted 推进 authority')

  ensureTrusted(connection, HOST)
  ensureTrusted(connection, HOST.toUpperCase())
  assert.equal(connection.trustedHosts.length, 1, '重复 ensureTrusted 不重复添加')

  dispose()
  assert.deepEqual(connection.trustedHosts, [], 'dispose 只删自己加的那条')
  dispose()
  assert.deepEqual(connection.trustedHosts, [], 'dispose 幂等')

  const seeded = { trustedHosts: ['preexisting.example'] }
  const disposeSeeded = ensureTrusted(seeded, HOST)
  assert.deepEqual(seeded.trustedHosts, ['preexisting.example', HOST], '追加到已有列表末尾')
  disposeSeeded()
  assert.deepEqual(seeded.trustedHosts, ['preexisting.example'], '回滚时不动别人加的条目')

  const alreadyTrusted = { trustedHosts: [HOST] }
  const noop = ensureTrusted(alreadyTrusted, HOST)
  noop()
  assert.deepEqual(alreadyTrusted.trustedHosts, [HOST], '原本就存在时 disposer 不删除')

  assert.equal(isTrusted({ trustedHosts: [HOST] }, HOST), true, 'isTrusted 命中')
  assert.equal(isTrusted({ trustedHosts: [HOST.toUpperCase()] }, HOST), true, 'isTrusted 大小写不敏感')
  assert.equal(isTrusted({ trustedHosts: [] }, HOST), false, 'isTrusted 未命中')
  assert.equal(isTrusted({ trustedHosts: null }, HOST), false, 'trustedHosts 非数组时 isTrusted=false')

  assert.throws(
    () => ensureTrusted({ trustedHosts: null }, HOST),
    (error) => {
      assert.ok(error instanceof TailscaleError, 'trust 不可用应为 TailscaleError')
      assert.equal(error.code, 'tailscale/trust-unavailable', 'trustedHosts 非数组 → trust-unavailable')
      return true
    },
    'trustedHosts 非数组时抛 trust-unavailable',
  )
  assert.throws(
    () => ensureTrusted(null, HOST),
    (error) => {
      assert.equal(error.code, 'tailscale/no-connection', '缺 connection → no-connection')
      return true
    },
    'connection 缺失时抛 no-connection',
  )

  assert.equal(assertAuthority('example.com'), 'example.com', '裸 host 合法')
  assert.equal(assertAuthority(`${HOST}:443`), `${HOST}:443`, 'host:port 合法')
  for (const bad of ['https://example.com/', 'example.com/path', ' example.com', 'example.com:443:1', 'a..b']) {
    assert.throws(
      () => assertAuthority(bad),
      (error) => {
        assert.equal(error.code, 'tailscale/trust-unavailable', `${bad} 应被拒绝`)
        return true
      },
      `非法 authority 被拒绝：${bad}`,
    )
  }
})

// ================================================================ 5. cli.js 错误归类（纯函数）
test('cli.js · classifyCliError 归类与 cliPath 解析', () => {
  const cases = [
    [{ code: 'ENOENT' }, '', ['status'], 'tailscale/not-installed', 'ENOENT → 未安装'],
    [{ killed: true }, '', ['version'], 'tailscale/timeout', '被 kill → 超时'],
    [{}, 'operation timed out', ['status'], 'tailscale/timeout', 'stderr 超时文案'],
    [{}, 'tailscaled is not running', ['status'], 'tailscale/not-running', 'not running'],
    [{}, 'failed to connect to local tailscaled', ['serve'], 'tailscale/not-running', 'failed to connect'],
    [{}, 'fetching control keys: needs login', ['serve'], 'tailscale/not-logged-in', 'needs login'],
    [{}, 'logged out', ['status'], 'tailscale/not-logged-in', 'logged out'],
    [{}, 'permission denied', ['serve'], 'tailscale/permission', 'permission denied'],
    [{}, 'HTTPS is not enabled on this tailnet', ['serve'], 'tailscale/https-disabled', 'HTTPS 未启用'],
    [{}, 'already serving on path /', ['serve'], 'tailscale/route-conflict', '路由冲突'],
    [{}, 'unexpected boom', ['serve'], 'tailscale/cli-failed', '兜底 cli-failed'],
  ]
  for (const [error, text, argv, code, label] of cases) {
    assert.equal(classifyCliError(error, text, argv).code, code, label)
  }
  assert.equal(resolveCliPath('/custom/tailscale-cli'), '/custom/tailscale-cli', '显式 cliPath 原样返回')
  assert.ok(resolveCliPath().length > 0, 'auto 至少解析出一个非空路径')
})

// ================================================================ 6. 假 CLI 本体
test('fake-tailscale.mjs · version / status / serve 增删', async () => {
  await withFakeHome({}, async ({ home }) => {
    const cli = new TailscaleCli({ cliPath: FAKE_CLI })

    assert.equal(await cli.version(), '1.104.2-fake', 'version 第一行')

    const status = await cli.statusJson()
    assert.equal(status.BackendState, 'Running', 'status --json 透传 fixture')
    assert.equal(status.Self.DNSName, 'fake-studio.tail1234.ts.net.', 'fixture 原始 DNSName 带尾点')

    assert.deepEqual(await cli.serveStatusJson(), {}, '没有 serve.json 时 serve status → {}')

    await cli.serveCreate({ httpsPort: 443, path: '/dsh-smoke', target: 'http://127.0.0.1:3080' })
    let serveConfig = readServe(home)
    assert.equal(serveConfig.Web[AUTHORITY].Handlers['/dsh-smoke'].Proxy, 'http://127.0.0.1:3080', '创建写入代理')
    assert.equal(serveConfig.TCP['443'].HTTPS, true, '创建时标记 TCP 443 HTTPS')

    assert.equal((await cli.serveStatusJson()).Web[AUTHORITY].Handlers['/dsh-smoke'].Proxy, 'http://127.0.0.1:3080', 'serve status 读回刚写的路由')

    await cli.serveOff({ httpsPort: 443, path: '/dsh-smoke' })
    assert.deepEqual(readServe(home), {}, '撤最后一条 handler 后 serve 配置清空')

    // publishPath='/' 时 CLI 封装不应传 --set-path
    const beforeRoot = readCalls(home).length
    await cli.serveCreate({ httpsPort: 443, path: '/', target: 'http://127.0.0.1:3080' })
    const rootCreate = readCalls(home)
      .slice(beforeRoot)
      .find((call) => call.argv.includes('--bg'))
    assert.deepEqual(rootCreate?.argv, ['serve', '--bg', '--https=443', 'http://127.0.0.1:3080'], '根路由的 serve 调用不带 --set-path')
    await cli.serveOff({ httpsPort: 443, path: '/' })
    const rootOff = readCalls(home)
      .slice(beforeRoot)
      .find((call) => call.argv[0] === 'serve' && call.argv.includes('off'))
    assert.deepEqual(rootOff?.argv, ['serve', '--https=443', 'off'], '撤根路由 = 末位 off（不传 --set-path）')

    // 兜底：未知命令必须失败（保证 on/off 语法解析正确）
    const unknown = await cli.run(['frobnicate']).then(
      () => null,
      (error) => error,
    )
    assert.equal(unknown?.code, 'tailscale/cli-failed', '未知子命令 → 非零退出并被归类')

    // FAKE_TAILSCALE_HOST 优先于 status.json 的 Self.DNSName
    process.env.FAKE_TAILSCALE_HOST = 'override-host.tail9999.ts.net'
    await cli.serveCreate({ httpsPort: 443, path: '/override', target: 'http://127.0.0.1:3080' })
    assert.equal(
      readServe(home).Web['override-host.tail9999.ts.net:443']?.Handlers['/override']?.Proxy,
      'http://127.0.0.1:3080',
      'FAKE_TAILSCALE_HOST 覆盖 serve authority',
    )
    restoreEnv('FAKE_TAILSCALE_HOST', undefined)

    // serve reset：清空配置且被记录（真实插件绝不该调它，测试要能断言）
    await cli.serveCreate({ httpsPort: 443, path: '/reset-me', target: 'http://127.0.0.1:3080' })
    await cli.run(['serve', 'reset'])
    assert.deepEqual(readServe(home), {}, 'serve reset 清空 serve 配置')
    assert.ok(
      readCalls(home).some((call) => call.argv.join(' ') === 'serve reset'),
      'serve reset 调用写进 calls.log（供断言"绝不该出现"）',
    )
  })
})

test('fake-tailscale.mjs · FAKE_TAILSCALE_FAIL 失败注入', async () => {
  await withFakeHome({}, async () => {
    const cases = [
      ['not-running', 'tailscale/not-running'],
      ['not-logged-in', 'tailscale/not-logged-in'],
      ['permission', 'tailscale/permission'],
      ['https-disabled', 'tailscale/https-disabled'],
      ['conflict', 'tailscale/route-conflict'],
      ['cli-failed', 'tailscale/cli-failed'],
      ['timeout', 'tailscale/timeout'],
    ]
    for (const [mode, code] of cases) {
      process.env.FAKE_TAILSCALE_FAIL = mode
      const cli = new TailscaleCli({ cliPath: FAKE_CLI })
      await assert.rejects(
        () => cli.statusJson(),
        (error) => {
          assert.ok(error instanceof TailscaleError, `${mode} 抛 TailscaleError`)
          assert.equal(error.code, code, `${mode} → ${code}`)
          return true
        },
        `失败注入 ${mode} 归类为 ${code}`,
      )
    }

    process.env.FAKE_TAILSCALE_FAIL = 'garbage'
    const garbage = new TailscaleCli({ cliPath: FAKE_CLI })
    await assert.rejects(
      () => garbage.statusJson(),
      (error) => {
        assert.equal(error.code, 'tailscale/bad-output', '非 JSON 输出 → bad-output')
        return true
      },
      '坏输出被归类',
    )

    // 只让指定命令失败：status 正常、serve 失败
    process.env.FAKE_TAILSCALE_FAIL = 'permission@serve'
    const selective = new TailscaleCli({ cliPath: FAKE_CLI })
    await assert.rejects(
      () => selective.serveCreate({ httpsPort: 443, path: '/', target: 'http://127.0.0.1:3080' }),
      (error) => {
        assert.equal(error.code, 'tailscale/permission', '过滤命中的命令失败')
        return true
      },
      'serve 被注入 permission 失败',
    )
    assert.equal((await selective.statusJson()).BackendState, 'Running', '未命中过滤的命令仍正常')

    restoreEnv('FAKE_TAILSCALE_FAIL', undefined)
    const missing = new TailscaleCli({ cliPath: join(tempDir('dsh-ts-missing-'), 'tailscale') })
    await assert.rejects(
      () => missing.version(),
      (error) => {
        assert.equal(error.code, 'tailscale/not-installed', '不存在的 CLI 路径 → not-installed')
        return true
      },
      'ENOENT 归类为未安装',
    )
  })
})

// ================================================================ 7. 服务层生命周期
test('service · 发布 → 认领 → 健康 → 快照 → 撤回', async (t) => {
  await withFakeHome({ status: 'status-running.json' }, async ({ home }) => {
    const { service, connection, state, stateFile } = makeService({ home })

    await t.test('status() 返回 Running 与节点域名', async () => {
      const status = await service.status()
      assert.equal(status.backend, 'Running', 'backend')
      assert.equal(status.dnsName, HOST, 'dnsName 去尾点')
      assert.equal(status.cliPath, FAKE_CLI, 'cliPath 暴露给 UI')
      assert.equal(status.devices.length, 3, '设备数量')
      assert.equal(status.self.isSelf, true, 'self')
    })

    await t.test('publication() 初始为 absent', async () => {
      const current = await service.publication()
      assert.equal(current.enabled, false, '未发布')
      assert.equal(current.routeState, 'absent', '路由 absent')
      assert.equal(current.host, HOST, 'host 来自 status')
      assert.equal(current.path, '/', 'publishPath 默认 /')
      assert.equal(current.target, 'http://127.0.0.1:3080', 'target = webServer.port')
      assert.equal(current.owned, false, '未发布时 owned=false')
    })

    await t.test('publish() 创建 serve 路由、状态文件与 trustedHosts', async () => {
      const published = await service.publish()
      assert.equal(published.enabled, true, '发布成功')
      assert.equal(published.routeState, 'exact', '路由 exact')
      assert.equal(published.owned, true, '自有路由')
      assert.equal(published.adopted, false, '本次新建不算认领')
      assert.equal(published.url, `https://${HOST}/`, 'URL 正确')
      assert.equal(published.target, 'http://127.0.0.1:3080', 'target 正确')
      assert.equal(typeof published.createdAt, 'number', 'createdAt 存在')

      const serveConfig = readServe(home)
      assert.equal(serveConfig.Web[AUTHORITY].Handlers['/'].Proxy, 'http://127.0.0.1:3080', 'serve.json 写入 handler')
      assert.equal(serveCreateCalls(readCalls(home)).length, 1, '只调用一次 serve 创建')
      assert.deepEqual(connection.trustedHosts, [HOST], 'trustedHosts 推进节点域名')

      assert.equal(existsSync(stateFile), true, '状态文件已写入')
      assert.equal(statSync(stateFile).mode & 0o777, 0o600, '状态文件权限 600')
      const storedText = readFileSync(stateFile, 'utf8')
      const stored = JSON.parse(storedText)
      assert.equal(stored.url, `https://${HOST}/`, '状态文件 url')
      assert.equal(stored.host, HOST, '状态文件 host')
      assert.equal(stored.path, '/', '状态文件 path')
      assert.equal(stored.target, 'http://127.0.0.1:3080', '状态文件 target')
      assert.equal(stored.owned, true, '状态文件 owned')
      assert.equal(stored.dshPid, process.pid, '状态文件 dshPid')
      assert.doesNotMatch(storedText, /token/i, '状态文件不含 token')
    })

    await t.test('再次 publish() 只认领，不重复创建', async () => {
      const before = serveCreateCalls(readCalls(home)).length
      const again = await service.publish()
      assert.equal(again.enabled, true, '仍然可用')
      assert.equal(again.routeState, 'exact', '仍然 exact')
      assert.equal(again.adopted, true, 'exact 已存在时标记为认领')
      assert.equal(serveCreateCalls(readCalls(home)).length, before, '认领不应再调 serve --bg')
      assert.deepEqual(connection.trustedHosts, [HOST], 'trustedHosts 不重复')
      assert.equal(await state.read() === null, false, '状态文件仍在')
    })

    await t.test('health({deep:false}) 六项检查且 route/trust/funnel 正常', async () => {
      const report = await service.health({ deep: false })
      assert.deepEqual(
        report.checks.map((check) => check.id),
        ['cli', 'backend', 'dnsName', 'route', 'trust', 'funnel'],
        '健康检查项齐全且顺序稳定',
      )
      const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]))
      assert.equal(byId.cli.ok, true, 'cli 可用')
      assert.equal(byId.backend.ok, true, 'backend Running')
      assert.equal(byId.dnsName.ok, true, 'dnsName 存在')
      assert.equal(byId.route.ok, true, `route 在 exact 时 ok：${byId.route.message}`)
      assert.equal(byId.route.level, 'ok', 'route level=ok')
      assert.equal(byId.trust.ok, true, 'trustedHosts 已生效')
      assert.equal(byId.funnel.ok, true, '未开 Funnel')
      assert.equal(report.ok, true, '整体健康')
      assert.equal(report.dnsName, HOST, '健康报告带 dnsName')
      assert.equal(report.url, `https://${HOST}/`, '健康报告带 url')
    })

    await t.test('snapshot() 结构完整', async () => {
      const snapshot = await service.snapshot()
      assert.equal(typeof snapshot.config, 'object', 'config')
      assert.equal(snapshot.config.httpsPort, 443, 'config.httpsPort')
      assert.equal(snapshot.config.publishPath, '/', 'config.publishPath')
      assert.equal(snapshot.status.backend, 'Running', 'status.backend')
      assert.equal(snapshot.status.dnsName, HOST, 'status.dnsName')
      assert.equal(snapshot.status.deviceCount, 3, 'status.deviceCount')
      assert.equal(snapshot.status.onlineCount, 2, 'status.onlineCount')
      assert.equal(snapshot.publication.enabled, true, 'publication.enabled')
      assert.equal(Array.isArray(snapshot.devices), true, 'devices 是数组')
      assert.equal(snapshot.devices.length, 3, 'devices 数量')
      assert.equal(snapshot.health.ok, true, 'health.ok')
      assert.equal(snapshot.health.checks.length, 6, 'health.checks 数量')
    })

    await t.test('unpublish() 撤单条、清状态文件、复原 trustedHosts，且不用 reset/down', async () => {
      const result = await service.unpublish()
      assert.equal(result.enabled, false, '撤回后 enabled=false')
      assert.equal(result.path, '/', '撤回的 path')
      assert.deepEqual(readServe(home), {}, 'handler 已从 serve.json 删除')
      assert.equal(existsSync(stateFile), false, '状态文件已清除')
      assert.deepEqual(connection.trustedHosts, [], 'trustedHosts 复原')

      const calls = readCalls(home)
      assert.equal(calls.some((call) => call.argv.includes('reset')), false, '绝不能调用 serve reset')
      assert.equal(calls.some((call) => call.argv[0] === 'down'), false, '绝不能调用 tailscale down')
      assert.ok(
        calls.some((call) => call.argv.join(' ') === 'serve --https=443 off'),
        '撤单条用末位 off',
      )
      assert.equal(serveCreateCalls(calls).length, 1, '全程只创建过一次路由')

      const current = await service.publication()
      assert.equal(current.enabled, false, '撤回后 publication enabled=false')
      assert.equal(current.routeState, 'absent', '撤回后路由 absent')
    })
  })
})

test('service · 预置冲突路由只报错不覆盖', async (t) => {
  await withFakeHome({ status: 'status-running.json', serve: fixture('serve-conflict.json') }, async ({ home }) => {
    const { service, connection, stateFile } = makeService({ home })

    await t.test('publication() 报告 conflict', async () => {
      const current = await service.publication()
      assert.equal(current.enabled, false, '冲突时不可用')
      assert.equal(current.routeState, 'conflict', 'routeState=conflict')
      assert.equal(current.conflict?.path, 'http://127.0.0.1:9999', '冲突详情带原 proxy')
      assert.ok(Array.isArray(current.routes), 'routes 列表存在')
      assert.equal(current.routes.find((route) => route.path === '/')?.proxy, 'http://127.0.0.1:9999', 'routes 暴露冲突方')
    })

    await t.test('publish() 抛 route-conflict 且保留原路由', async () => {
      await assert.rejects(
        () => service.publish(),
        (error) => {
          assert.equal(error.code, 'tailscale/route-conflict', '冲突错误码')
          assert.ok(
            Array.isArray(error.routes) && error.routes.some((route) => route.proxy === 'http://127.0.0.1:9999'),
            '错误带现有路由，便于 UI 展示',
          )
          return true
        },
        '预置冲突时 publish 必须拒绝',
      )
      assert.equal(readServe(home).Web[AUTHORITY].Handlers['/'].Proxy, 'http://127.0.0.1:9999', '原路由必须保留')
      assert.equal(serveCreateCalls(readCalls(home)).length, 0, '冲突时不能调用 serve --bg')
      assert.deepEqual(connection.trustedHosts, [], '冲突时不能推进 trustedHosts')
      assert.equal(existsSync(stateFile), false, '冲突时不能写状态文件')
    })
  })
})

test('service · Stopped / NeedsLogin / 无 DNSName 的降级', async (t) => {
  await t.test('Stopped：不崩，publish 抛 not-running', async () => {
    await withFakeHome({ status: 'status-stopped.json' }, async ({ home }) => {
      const { service } = makeService({ home })
      const status = await service.status()
      assert.equal(status.backend, 'Stopped', 'backend=Stopped')
      assert.equal(status.dnsName, HOST, 'Stopped 时仍能读到上次的 DNSName')

      await assert.rejects(
        () => service.publish(),
        (error) => {
          assert.equal(error.code, 'tailscale/not-running', '未运行 → not-running（绝不自动 up）')
          return true
        },
        'Stopped 时 publish 必须拒绝',
      )
      const report = await service.health({ deep: false })
      assert.equal(report.ok, false, 'Stopped 时整体不健康')
      const backend = report.checks.find((check) => check.id === 'backend')
      assert.equal(backend.ok, false, 'backend 检查失败')
      assert.equal(backend.level, 'error', 'backend level=error')

      const snapshot = await service.snapshot()
      assert.equal(snapshot.status.backend, 'Stopped', 'snapshot 不崩且如实报告')
      assert.equal(snapshot.publication.enabled, false, 'snapshot.publication 不可用')
      assert.equal(snapshot.health.ok, false, 'snapshot.health 不健康')
    })
  })

  await t.test('NeedsLogin：publish 抛 not-running（不自行 login）', async () => {
    await withFakeHome({ status: 'status-needs-login.json' }, async ({ home }) => {
      const { service } = makeService({ home })
      const status = await service.status()
      assert.equal(status.backend, 'NeedsLogin', 'backend=NeedsLogin')
      assert.equal(status.dnsName, '', '未登录时没有 DNSName')
      await assert.rejects(
        () => service.publish(),
        (error) => {
          assert.equal(error.code, 'tailscale/not-running', '未登录按未运行处理')
          return true
        },
        'NeedsLogin 时 publish 必须拒绝',
      )
      const current = await service.publication()
      assert.equal(current.enabled, false, '未登录时不可发布')
      assert.equal(current.reason, 'no-dns-name', '未登录时 publication 原因是 no-dns-name')
      // 修复项 2：降级分支补齐 routeState/owned/adopted
      assert.equal(current.routeState, 'unknown', 'no-dns-name 分支 routeState=unknown')
      assert.equal(current.owned, false, 'no-dns-name 分支 owned=false')
      assert.equal(current.adopted, false, 'no-dns-name 分支 adopted=false')
    })
  })

  await t.test('无 Self.DNSName：publish 抛 https-disabled', async () => {
    await withFakeHome({ status: 'status-no-dns.json' }, async ({ home }) => {
      const { service } = makeService({ home })
      const status = await service.status()
      assert.equal(status.dnsName, '', '没有 MagicDNS 域名')
      await assert.rejects(
        () => service.publish(),
        (error) => {
          assert.equal(error.code, 'tailscale/https-disabled', '缺 DNSName → https-disabled')
          return true
        },
        '无 DNSName 时 publish 必须拒绝',
      )
      const report = await service.health({ deep: false })
      const dnsCheck = report.checks.find((check) => check.id === 'dnsName')
      assert.equal(dnsCheck.ok, false, 'dnsName 检查失败')
      assert.equal(dnsCheck.level, 'error', 'dnsName level=error')
      assert.equal(report.ok, false, '整体不健康')
    })
  })
})

test('service · trustHost=false 降级 / 已有 trustedHosts 不被误删', async (t) => {
  await t.test('trustHost=false 时不碰 trustedHosts，health 给 warn', async () => {
    await withFakeHome({}, async ({ home }) => {
      const { service, connection } = makeService({ home, config: { trustHost: false } })
      const published = await service.publish()
      assert.equal(published.enabled, true, '仍能发布 serve 路由')
      assert.deepEqual(connection.trustedHosts, [], 'trustHost=false 不推进 trustedHosts')
      const report = await service.health({ deep: false })
      const trust = report.checks.find((check) => check.id === 'trust')
      assert.equal(trust.ok, false, '未信任时 trust 检查不通过')
      assert.equal(trust.level, 'warn', '降级为 warn 而不是 error')
      await service.unpublish()
      assert.deepEqual(connection.trustedHosts, [], '撤回后也不应改动 trustedHosts')
    })
  })

  await t.test('已有 trustedHosts 条目在撤回时保留', async () => {
    await withFakeHome({}, async ({ home }) => {
      const seeded = ['preexisting.example']
      const { service, connection } = makeService({ home, trustedHosts: seeded })
      await service.publish()
      assert.deepEqual(connection.trustedHosts, ['preexisting.example', HOST], '追加自己的条目')
      await service.unpublish()
      assert.deepEqual(connection.trustedHosts, ['preexisting.example'], '只回滚自己加的那条')
    })
  })
})

// ================================================================ 7b. 修复回归（lib 修复后新增）
test('service · stale 重建先撤旧再建新', async () => {
  const staleServe = {
    TCP: { 443: { HTTPS: true } },
    Web: { [AUTHORITY]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } },
  }
  await withFakeHome({ serve: staleServe }, async ({ home }) => {
    const { service, state } = makeService({ home })
    // 状态文件记录旧目标，classifyServe 才会判成 stale 而不是 conflict
    await state.write({
      url: `https://${HOST}/`,
      host: HOST,
      path: '/',
      target: 'http://127.0.0.1:9999',
      owned: true,
      createdAt: 1,
      dshPid: 1,
    })
    const published = await service.publish()
    assert.equal(published.enabled, true, 'stale 路由可重建')
    assert.equal(published.routeState, 'exact', '重建后 exact')
    assert.equal(published.adopted, false, '重建不是认领')

    const commands = readCalls(home).map((call) => call.argv.join(' '))
    const offIndex = commands.indexOf('serve --https=443 off')
    const createIndex = commands.indexOf('serve --bg --https=443 http://127.0.0.1:3080')
    assert.ok(offIndex >= 0, `应先撤旧路由（调用序列：${JSON.stringify(commands)}）`)
    assert.ok(createIndex > offIndex, `再创建新路由（调用序列：${JSON.stringify(commands)}）`)
    assert.equal(commands.filter((command) => command.includes('--bg')).length, 1, '只创建一次')

    const serveConfig = readServe(home)
    assert.equal(serveConfig.Web[AUTHORITY].Handlers['/'].Proxy, 'http://127.0.0.1:3080', '最终 handler 指向本实例端口')
    assert.equal(serveConfig.TCP['443'].HTTPS, true, 'TCP 443 HTTPS 保留')
  })
})

test('service · 崩溃残留重启后 publication() 标记 adopted', async () => {
  await withFakeHome({}, async ({ home }) => {
    const first = makeService({ home })
    await first.service.publish()
    assert.equal((await first.service.publication()).adopted, false, '本进程新建的路由不算认领')

    // 同一状态目录 + 同一假 CLI，新 service 实例（runtime 为空）= 模拟重启
    const second = makeService({ home })
    const current = await second.service.publication()
    assert.equal(current.enabled, true, '重启后仍可用')
    assert.equal(current.owned, true, '由本插件创建（状态文件仍标记 owned）')
    assert.equal(current.routeState, 'exact', '路由 exact')
    assert.equal(current.adopted, true, '启动前就存在的 exact 路由应视为认领')
    assert.equal(current.host, HOST, 'host 正确')
    assert.equal(typeof current.createdAt, 'number', 'createdAt 从状态文件带回')
  })
})

test('service · serve status 读失败时 funnel 为 warn 且提示未知', async (t) => {
  // C：cli.js 只把"没有 serve 配置"当空；permission/timeout 等真失败必须上抛
  for (const [mode, expectedCode] of [
    ['permission', 'tailscale/permission'],
    ['timeout', 'tailscale/timeout'],
  ]) {
    await t.test(`${mode}：funnel warn + publication serve-unavailable`, async () => {
      await withFakeHome({}, async ({ home }) => {
        const { service } = makeService({ home })
        await service.publish()
        process.env.FAKE_TAILSCALE_FAIL = `${mode}@serve status --json`
        const report = await service.health({ deep: false })
        const funnel = report.checks.find((check) => check.id === 'funnel')
        assert.equal(funnel.level, 'warn', `serve 状态不可读时 funnel 应为 warn（实际 ${funnel.level}：${funnel.message}）`)
        assert.match(funnel.message, /未知/, `funnel message 应说明状态未知：${funnel.message}`)
        assert.equal(funnel.ok, true, '未知不是曝光，ok 仍为 true')

        // publication 的 serve-unavailable 分支：字段齐全 + 透传底层错误码
        const current = await service.publication()
        assert.equal(current.enabled, false, '入口不可判定')
        assert.equal(current.reason, 'serve-unavailable', 'publication 原因是 serve-unavailable')
        assert.equal(current.routeState, 'unknown', 'routeState=unknown')
        assert.equal(current.owned, false, 'owned=false')
        assert.equal(current.adopted, false, 'adopted=false')
        assert.equal(current.error.code, expectedCode, '透传底层错误码')

        // route 检查同样读不到 serve 状态 → error
        const route = report.checks.find((check) => check.id === 'route')
        assert.equal(route.level, 'error', 'route 无法确认为 error')
      })
    })
  }
})

test('service · subscribe 收到 publish/unpublish 事件', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service } = makeService({ home })
    const events = []
    const unsubscribe = service.subscribe((event) => events.push(event))

    await service.publish()
    assert.equal(events.length, 1, 'publish 触发一次事件')
    assert.equal(events[0].reason, 'publish', 'reason=publish')
    assert.equal(events[0].publication.enabled, true, 'publication.enabled=true')
    assert.equal(events[0].publication.host, HOST, '事件带 host')
    assert.equal(events[0].publication.url, `https://${HOST}/`, '事件带 url')
    assert.equal(typeof events[0].at, 'number', '事件带时间戳')

    await service.unpublish()
    assert.equal(events.length, 2, 'unpublish 再触发一次')
    assert.equal(events[1].reason, 'unpublish', 'reason=unpublish')
    assert.equal(events[1].publication.enabled, false, 'publication.enabled=false')

    unsubscribe()
    await service.publish()
    assert.equal(events.length, 2, 'unsubscribe 后不再收到事件')

    // 单个监听器抛错不影响其他监听器
    const others = []
    service.subscribe(() => {
      throw new Error('listener boom')
    })
    service.subscribe((event) => others.push(event))
    await service.unpublish()
    assert.equal(others.length, 1, '抛错监听器被隔离')
    assert.equal(others[0].reason, 'unpublish', '其他监听器照常收到事件')
  })
})

test('service · 创建/撤回路由失败归为 serve-failed', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service, connection, stateFile } = makeService({ home })

    process.env.FAKE_TAILSCALE_FAIL = 'permission@serve --bg'
    await assert.rejects(
      () => service.publish(),
      (error) => {
        assert.equal(error.code, 'tailscale/serve-failed', '创建失败 → serve-failed（不再冒 cli-failed）')
        assert.equal(error.upstream, 'tailscale/permission', '保留 upstream 分类')
        assert.match(error.message, /创建 serve 路由失败/, '错误信息说明动作')
        assert.ok(error.cause instanceof TailscaleError, '保留 cause')
        return true
      },
      'serve --bg 权限失败时 publish 抛 serve-failed',
    )
    assert.deepEqual(readServe(home), {}, '失败时不能留下路由')
    assert.equal(existsSync(stateFile), false, '失败时不写状态文件')
    assert.deepEqual(connection.trustedHosts, [], '失败时不推进 trustedHosts')
  })
})

test('service · 路由已不存在时 unpublish 幂等成功', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service, state, stateFile } = makeService({ home })
    await state.write({
      url: `https://${HOST}/`,
      host: HOST,
      path: '/',
      target: 'http://127.0.0.1:3080',
      owned: true,
      createdAt: 1,
      dshPid: 1,
    })
    const result = await service.unpublish()
    assert.equal(result.enabled, false, '撤回成功')
    assert.equal(result.path, '/', '撤回的 path')
    assert.deepEqual(readServe(home), {}, 'serve.json 保持无路由')
    assert.equal(existsSync(stateFile), false, '状态文件清除')
  })
})

test('service · publication() 在缺 connection/webServer 时字段完整', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service } = makeService({ home, port: 0 })
    const current = await service.publication()
    assert.equal(current.enabled, false, '不可用')
    assert.equal(current.reason, 'no-connection', 'reason=no-connection')
    assert.equal(current.routeState, 'unknown', 'routeState=unknown')
    assert.equal(current.owned, false, 'owned=false')
    assert.equal(current.adopted, false, 'adopted=false')
    assert.equal(current.path, '/', 'path 用默认 publishPath')
  })
})

test('service · trust 桥失败时 publish 回滚路由（不留孤路由）', async () => {
  await withFakeHome({}, async ({ home }) => {
    // DSH 升级后 connection.trustedHosts 不是可变数组的降级场景
    const { service, connection, stateFile } = makeService({ home, trustedHosts: null })
    await assert.rejects(
      () => service.publish(),
      (error) => {
        assert.equal(error.code, 'tailscale/trust-unavailable', 'trust 桥不可用 → trust-unavailable')
        return true
      },
      'trustedHosts 非数组时 publish 必须拒绝',
    )
    assert.equal(connection.trustedHosts, null, '不篡改不可用的 trustedHosts')
    assert.deepEqual(readServe(home), {}, 'rollback 后 serve.json 不能留下 handler')
    assert.equal(existsSync(stateFile), false, 'rollback 后状态文件不存在')

    const commands = readCalls(home).map((call) => call.argv.join(' '))
    assert.ok(
      commands.includes('serve --https=443 off'),
      `rollback 必须撤掉刚创建的路由（调用序列：${JSON.stringify(commands)}）`,
    )
    assert.equal(
      commands.filter((command) => command.startsWith('serve --bg')).length,
      1,
      '创建一次后回滚，不重复创建',
    )

    const result = await service.unpublish()
    assert.deepEqual(result, { enabled: false }, '回滚后 unpublish 幂等返回且不报错')
  })
})

test('service · publish 读 serve 状态失败的错误归类', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service, stateFile } = makeService({ home })

    // E：已知码（permission/not-running/not-logged-in/timeout）原样上抛
    process.env.FAKE_TAILSCALE_FAIL = 'permission@serve status --json'
    await assert.rejects(
      () => service.publish(),
      (error) => {
        assert.equal(error.code, 'tailscale/permission', '已知码原样上抛，不包成 serve-failed')
        return true
      },
      'permission 原样上抛',
    )
    process.env.FAKE_TAILSCALE_FAIL = 'timeout@serve status --json'
    await assert.rejects(
      () => service.publish(),
      (error) => {
        assert.equal(error.code, 'tailscale/timeout', 'timeout 原样上抛')
        return true
      },
      'timeout 原样上抛',
    )

    // E：其余码（如 cli-failed）包成 serve-failed，upstream 保留
    process.env.FAKE_TAILSCALE_FAIL = 'cli-failed@serve status --json'
    await assert.rejects(
      () => service.publish(),
      (error) => {
        assert.equal(error.code, 'tailscale/serve-failed', '未知码包成 serve-failed')
        assert.equal(error.upstream, 'tailscale/cli-failed', '保留 upstream')
        assert.match(error.message, /读取 serve 状态失败/, '错误信息说明动作')
        assert.ok(error.cause instanceof TailscaleError, '保留 cause')
        return true
      },
      'cli-failed 包成 serve-failed',
    )
    assert.deepEqual(readServe(home), {}, '读取失败时不建路由')
    assert.equal(existsSync(stateFile), false, '读取失败时不写状态文件')
  })
})

test('service · 状态文件写入失败时 publish 回滚路由', async () => {
  await withFakeHome({}, async ({ home }) => {
    // 把 dshHome 占成普通文件，state.write() 的 mkdir 必然失败
    writeFileSync(join(home, 'dsh-home'), 'blocked')
    const { service } = makeService({ home })
    await assert.rejects(
      () => service.publish(),
      (error) => {
        assert.equal(error.code, 'tailscale/serve-failed', '状态写入失败 → serve-failed')
        assert.match(error.message, /写入状态文件失败/, '错误信息说明动作')
        return true
      },
      '状态文件写入失败时 publish 必须拒绝',
    )
    assert.deepEqual(readServe(home), {}, 'rollback 后不留下 handler')
    const commands = readCalls(home).map((call) => call.argv.join(' '))
    assert.ok(
      commands.includes('serve --https=443 off'),
      `rollback 必须撤掉刚创建的路由（调用序列：${JSON.stringify(commands)}）`,
    )
  })
})

test('service · status 读取失败时 publication 降级字段完整', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service, state } = makeService({ home })
    await state.write({
      url: `https://${HOST}/`,
      host: HOST,
      path: '/',
      target: 'http://127.0.0.1:3080',
      owned: true,
      createdAt: 1,
      dshPid: 1,
    })
    process.env.FAKE_TAILSCALE_FAIL = 'not-running@status --json'
    const current = await service.publication()
    assert.equal(current.enabled, false, '不可用')
    assert.equal(current.reason, 'tailscale-unavailable', 'reason=tailscale-unavailable')
    // D：该分支也要补齐 routeState/owned/adopted 与 host/path/target
    assert.equal(current.routeState, 'unknown', 'routeState=unknown')
    assert.equal(current.owned, false, 'owned=false')
    assert.equal(current.adopted, false, 'adopted=false')
    assert.equal(current.host, HOST, 'host 从状态文件带回')
    assert.equal(current.path, '/', 'path 从状态文件带回')
    assert.equal(current.target, 'http://127.0.0.1:3080', 'target 从状态文件带回')
    assert.equal(current.error.code, 'tailscale/not-running', '透传底层错误码')
  })
})

test('service · off 权限失败时 unpublish 上抛且保留路由/状态/信任', async () => {
  await withFakeHome({}, async ({ home }) => {
    const { service, connection, stateFile } = makeService({ home })
    const published = await service.publish()
    assert.equal(published.enabled, true, '先正常发布')
    const stateBefore = readFileSync(stateFile, 'utf8')

    process.env.FAKE_TAILSCALE_FAIL = 'permission@serve --https=443 off'
    await assert.rejects(
      () => service.unpublish(),
      (error) => {
        assert.equal(error.code, 'tailscale/serve-failed', '权限失败 → serve-failed')
        assert.equal(error.upstream, 'tailscale/permission', '保留 upstream')
        assert.match(error.message, /撤回 serve 路由失败/, '错误信息说明动作')
        assert.ok(error.cause instanceof TailscaleError, '保留 cause')
        return true
      },
      'off 权限失败必须上抛，不能静默成功',
    )
    assert.equal(readServe(home).Web[AUTHORITY].Handlers['/'].Proxy, 'http://127.0.0.1:3080', '失败时路由仍在')
    assert.equal(existsSync(stateFile), true, '失败时状态文件保留')
    assert.equal(readFileSync(stateFile, 'utf8'), stateBefore, '状态文件内容不变')
    assert.deepEqual(connection.trustedHosts, [HOST], '失败时 trustedHosts 保留')

    // 解除注入后重试，能正常撤干净（dispose 只 warn 的路径也依赖这一点）
    delete process.env.FAKE_TAILSCALE_FAIL
    const retry = await service.unpublish()
    assert.equal(retry.enabled, false, '重试成功')
    assert.deepEqual(readServe(home), {}, '重试后 handler 删除')
    assert.equal(existsSync(stateFile), false, '重试后状态文件清除')
    assert.deepEqual(connection.trustedHosts, [], '重试后 trustedHosts 复原')
  })
})

// ================================================================ 8. 探测（本地回环，不触网）
test('probe.js · 只探测 tailnet 地址 / 本机 TCP 连通', async () => {
  assert.equal(assertProbeTarget('100.107.25.26'), true, 'tailnet IPv4 允许')
  assert.equal(assertProbeTarget('fd7a:115c:a1e0::1'), true, 'tailnet IPv6 允许')
  assert.equal(assertProbeTarget('evil.example.com'), false, '任意公网域名拒绝')
  assert.equal(assertProbeTarget('100.107.25.26:5555'), false, '带端口的地址不是裸地址')
  assert.equal(assertProbeTarget('pixel-7a.tail1234.ts.net', { knownHosts: ['pixel-7a.tail1234.ts.net'] }), true, '已知 peer 主机名允许')
  assert.equal(assertProbeTarget('pixel-7a.tail1234.ts.net', { knownHosts: [] }), false, '未知主机名拒绝')
  assert.equal(assertProbeTarget('', {}), false, '空目标拒绝')

  assert.deepEqual(await probeTcp('', 5555), { ok: false, ms: 0, error: 'bad-target' }, '空主机直接返回 bad-target')
  assert.deepEqual(await probeTcp('127.0.0.1', 0), { ok: false, ms: 0, error: 'bad-target' }, '非法端口直接返回 bad-target')
  assert.deepEqual(await probeTcp('127.0.0.1', 70000), { ok: false, ms: 0, error: 'bad-target' }, '超范围端口直接返回 bad-target')

  const server = net.createServer((socket) => socket.end())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const { port } = server.address()
    const result = await probeTcp('127.0.0.1', port, { timeoutMs: 1000 })
    assert.equal(result.ok, true, '本机监听端口可探测')
    assert.equal(typeof result.ms, 'number', '返回耗时')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// ================================================================ 9. RPC 围栏（index.js createHandler）
test('index.js · createHandler RPC 围栏', async (t) => {
  const makeRpcService = () => ({
    snapshot: async () => ({ status: { backend: 'Running' }, devices: [] }),
    health: async (options) => ({ ok: true, deep: options?.deep === true, checks: [] }),
    loginUrl: async () => `https://${HOST}/?token=smoke-secret-token`,
    publish: async (options) => ({ enabled: true, path: options?.path ?? '/' }),
    unpublish: async () => ({ enabled: false }),
    devices: async () => ({ devices: [] }),
  })
  const rpc = (admit) => createHandler({ scope: { connection: { admit } }, service: makeRpcService() })

  await t.test('admit 401：先认证后方法检查，返回纯文本 unauthorized', async () => {
    const response = await callRpc(rpc(() => ({ rejection: 401 })), { method: 'GET' })
    assert.equal(response.status, 401, '401 状态码')
    assert.equal(response.body, 'unauthorized', '401 body')
  })

  await t.test('admit 403：返回 forbidden', async () => {
    const response = await callRpc(rpc(() => ({ rejection: 403 })), { method: 'POST', body: '{}' })
    assert.equal(response.status, 403, '403 状态码')
    assert.equal(response.body, 'forbidden', '403 body')
  })

  await t.test('admit 抛错：500 admit-failed', async () => {
    const response = await callRpc(
      rpc(() => {
        throw new Error('admit boom')
      }),
    )
    assert.equal(response.status, 500, '500 状态码')
    assert.equal(response.json?.ok, false, 'ok=false')
    assert.equal(response.json?.error?.code, 'tailscale/admit-failed', 'admit 异常错误码')
  })

  await t.test('非 POST：405 tailscale/method', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { method: 'GET' })
    assert.equal(response.status, 405, '405 状态码')
    assert.equal(response.json?.error?.code, 'tailscale/method', '只接受 POST')
    assert.match(response.headers['content-type'] || '', /application\/json/, 'JSON content-type')
    assert.equal(response.headers['cache-control'], 'no-store', '禁缓存')
  })

  await t.test('坏 JSON：400 tailscale/bad-body', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { method: 'POST', body: '{not json' })
    assert.equal(response.status, 400, '400 状态码')
    assert.equal(response.json?.error?.code, 'tailscale/bad-body', '坏请求体错误码')
  })

  await t.test('POST snapshot：200 且 {ok:true,value}', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { url: '/tailscale/snapshot', method: 'POST', body: '{}' })
    assert.equal(response.status, 200, '200 状态码')
    assert.equal(response.json?.ok, true, 'ok=true')
    assert.deepEqual(response.json?.value, { status: { backend: 'Running' }, devices: [] }, 'value 原样透传')
  })

  await t.test('query 与尾斜杠归一化', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { url: '/tailscale/snapshot/?x=1', method: 'POST', body: '{}' })
    assert.equal(response.status, 200, '200 状态码')
    assert.equal(response.json?.ok, true, 'endpoint 解析为 snapshot')
  })

  await t.test('未知 endpoint：200 且 error.code=not-found', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { url: '/tailscale/nope', method: 'POST', body: '{}' })
    assert.equal(response.status, 200, '业务错误仍是 200')
    assert.equal(response.json?.ok, false, 'ok=false')
    assert.equal(response.json?.error?.code, 'tailscale/not-found', '未知接口错误码')
  })

  await t.test('空 endpoint（/tailscale）：not-found', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { url: '/tailscale', method: 'POST', body: '{}' })
    assert.equal(response.json?.error?.code, 'tailscale/not-found', '空接口错误码')
    assert.match(response.json?.error?.message || '', /\(empty\)/, '错误信息标注空 interface')
  })

  await t.test('POST health：payload.deep 透传给 service.health', async () => {
    const response = await callRpc(rpc(() => ({ peer: {} })), { url: '/tailscale/health', method: 'POST', body: '{"deep":true}' })
    assert.equal(response.status, 200, '200 状态码')
    assert.equal(response.json?.value?.deep, true, 'deep=true 透传')
  })
})

// ================================================================ 10. dispatch 端点映射
test('index.js · dispatch 端点映射与参数形状', async (t) => {
  const calls = []
  const service = {
    snapshot: async () => ({ from: 'snapshot' }),
    health: async (options) => {
      calls.push(['health', options])
      return { from: 'health' }
    },
    loginUrl: async () => `https://${HOST}/?token=smoke-secret-token`,
    publish: async (options) => {
      calls.push(['publish', options])
      return { from: 'publish' }
    },
    unpublish: async () => {
      calls.push(['unpublish'])
      return { from: 'unpublish' }
    },
    devices: async (options) => {
      calls.push(['devices', options])
      return [{ hostName: 'pixel-7a' }]
    },
  }

  assert.deepEqual(await dispatch('snapshot', {}, service), { from: 'snapshot' }, 'snapshot 透传返回值')
  assert.deepEqual(await dispatch('health', { deep: true }, service), { from: 'health' }, 'health 返回形状')
  assert.deepEqual(calls.at(-1), ['health', { deep: true }], 'health deep=true')
  await dispatch('health', { deep: 'true' }, service)
  assert.deepEqual(calls.at(-1), ['health', { deep: false }], 'deep 只认严格 true')
  assert.deepEqual(await dispatch('login-url', {}, service), { url: `https://${HOST}/?token=smoke-secret-token` }, 'login-url 包成 {url}')
  await dispatch('publish', { path: '/dsh2' }, service)
  assert.deepEqual(calls.at(-1), ['publish', { path: '/dsh2' }], 'publish 透传 path')
  await dispatch('publish', { path: 42 }, service)
  assert.deepEqual(calls.at(-1), ['publish', { path: undefined }], 'path 非字符串 → undefined')
  assert.deepEqual(await dispatch('unpublish', {}, service), { from: 'unpublish' }, 'unpublish 透传')
  assert.deepEqual(await dispatch('devices', { fresh: true, online: true }, service), { devices: [{ hostName: 'pixel-7a' }] }, 'devices 包成 {devices}')
  assert.deepEqual(calls.at(-1), ['devices', { fresh: true, online: true }], 'devices 参数透传')
  await dispatch('devices', { online: false }, service)
  assert.deepEqual(calls.at(-1), ['devices', { fresh: false, online: undefined }], 'online/fresh 只认严格 true')

  await assert.rejects(
    () => dispatch('nope', {}, service),
    (error) => {
      assert.equal(error.code, 'tailscale/not-found', '未知 endpoint → not-found')
      return true
    },
    '未知 endpoint 抛 not-found',
  )
  await assert.rejects(
    () => dispatch('', {}, service),
    (error) => {
      assert.equal(error.code, 'tailscale/not-found', '空 endpoint → not-found')
      assert.match(error.message, /\(empty\)/, '空 endpoint 的错误信息')
      return true
    },
    '空 endpoint 抛 not-found',
  )
})

// ================================================================ 11. apply 装配 / 自动发布 / dispose
test('index.js · apply 注册服务与 RPC 路由、自动发布、dispose 撤回', async () => {
  await withFakeHome({}, async ({ home }) => {
    const provided = new Map()
    const effects = []
    const registered = []
    const scope = {
      connection: { trustedHosts: [], admit: () => ({ peer: {} }) },
      webServer: {
        port: 3080,
        register(definition) {
          registered.push(definition)
          return () => {}
        },
      },
      effect(factory, label) {
        effects.push({ label, return: factory() })
      },
    }
    const ctx = {
      provide(name, value) {
        provided.set(name, value)
      },
      inject(_services, callback) {
        callback(scope)
      },
      get(name) {
        if (name === 'connection') return scope.connection
        if (name === 'webServer') return scope.webServer
        return undefined
      },
    }
    const dshHome = join(home, 'apply-home')
    const stateFile = join(dshHome, 'tailscale.json')
    apply(ctx, { cliPath: FAKE_CLI, dshHome, autoPublish: true, httpsPort: 443, publishPath: '/', unpublishOnExit: true })

    const service = provided.get('tailscale')
    assert.equal(typeof service?.publish, 'function', 'ctx.provide 了 tailscale 服务')
    assert.equal(registered.length, 1, '注册了一条前缀路由')
    assert.equal(registered[0].kind, 'prefix', '路由 kind=prefix')
    assert.equal(registered[0].path, '/tailscale', '路由 path=/tailscale')
    assert.equal(typeof registered[0].handler, 'function', 'handler 是 createHandler 产物')
    assert.deepEqual(
      effects.map((effect) => effect.label),
      ['dsh-tailscale: rpc route', 'dsh-tailscale: auto publish'],
      '两个 effect：RPC 路由 + 自动发布',
    )

    // 自动发布是 fire-and-forget：serve 路由与状态文件是先后写的，等两者都就绪
    await waitFor(
      () =>
        readServe(home).Web?.[AUTHORITY]?.Handlers?.['/']?.Proxy === 'http://127.0.0.1:3080' &&
        existsSync(stateFile),
      'apply 应自动发布 serve 路由并写状态文件（等待超时）',
    )
    assert.equal(existsSync(stateFile), true, '自动发布后写状态文件')

    const cleanup = effects.find((effect) => effect.label === 'dsh-tailscale: auto publish').return
    assert.equal(typeof cleanup, 'function', 'auto publish effect 返回 disposer')
    cleanup()
    await waitFor(() => Object.keys(readServe(home)).length === 0, 'dispose 应撤回 serve 路由（等待超时）')
    await waitFor(() => !existsSync(stateFile), 'dispose 应清掉状态文件（等待超时）')

    const commands = readCalls(home).map((call) => call.argv.join(' '))
    assert.equal(commands.some((command) => command.includes('reset')), false, '绝不能调用 serve reset')
    assert.equal(commands.some((command) => command.startsWith('down')), false, '绝不能调用 tailscale down')
  })
})
