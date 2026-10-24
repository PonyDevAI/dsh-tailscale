// dsh-tailscale · Host 半区
// - 提供 ctx.tailscale 服务（其他插件用 ctx.get('tailscale') 可选消费）
// - 挂 /tailscale/* 前缀路由（connection.admit 认证围栏），给设置页 UI 用
// - 启动时按配置自动发布 tailnet 入口；退出时只撤回自己创建/认领的那条 serve 路由
import { TailscaleCli, TailscaleError } from './cli.js'
import { createTailscaleService, DEFAULT_CONFIG } from './service.js'
import { createStateStore } from './state.js'

export const name = '@ponydev/dsh-tailscale'

const MAX_BODY = 256 * 1024

function messageOf(error) {
  const text = error && error.message ? String(error.message) : '未知错误'
  return text.length > 400 ? text.slice(0, 400) : text
}

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function readBody(req, cap = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createHandler({ scope, service }) {
  return async (req, res) => {
    let admission
    try {
      admission = scope.connection.admit(req)
    } catch (error) {
      json(res, 500, { ok: false, error: { code: 'tailscale/admit-failed', message: messageOf(error) } })
      return
    }
    if ('rejection' in admission) {
      res.writeHead(admission.rejection)
      res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    const pathname = String(req.url || '/').split('?')[0]
    const endpoint = pathname.replace(/^\/tailscale\/?/, '').replace(/\/+$/, '')
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: { code: 'tailscale/method', message: '只接受 POST' } })
      return
    }
    let payload = {}
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {}
    } catch {
      json(res, 400, { ok: false, error: { code: 'tailscale/bad-body', message: '请求体不是 JSON' } })
      return
    }
    try {
      json(res, 200, { ok: true, value: await dispatch(endpoint, payload, service) })
    } catch (error) {
      json(res, 200, {
        ok: false,
        error: {
          code: error && typeof error.code === 'string' ? error.code : 'tailscale/error',
          message: messageOf(error),
        },
      })
    }
  }
}

export async function dispatch(endpoint, payload, service) {
  switch (endpoint) {
    case 'snapshot':
      return service.snapshot()
    case 'health':
      return service.health({ deep: payload.deep === true })
    case 'login-url':
      return { url: await service.loginUrl() }
    case 'publish':
      return service.publish({ path: typeof payload.path === 'string' ? payload.path : undefined })
    case 'unpublish':
      return service.unpublish()
    case 'devices':
      return { devices: await service.devices({ fresh: payload.fresh === true, online: payload.online === true || undefined }) }
    default:
      throw new TailscaleError('tailscale/not-found', `未知接口：${endpoint || '(empty)'}`)
  }
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULT_CONFIG, ...(rawConfig || {}) }
  const cli = new TailscaleCli({ cliPath: config.cliPath })
  const state = createStateStore({ dshHome: config.dshHome })
  const service = createTailscaleService({ ctx, config, cli, state })

  // 提供给其他插件：消费方用 ctx.get('tailscale')，不要写进 inject。
  ctx.provide('tailscale', service)

  ctx.inject(['connection', 'webServer'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'prefix',
          path: '/tailscale',
          handler: createHandler({ scope, service }),
        }),
      'dsh-tailscale: rpc route',
    )

    scope.effect(() => {
      let cancelled = false
      let timer = null

      const waitForPort = async (timeoutMs = 10000) => {
        const started = Date.now()
        while (!cancelled && !scope.webServer.port && Date.now() - started < timeoutMs) {
          await new Promise((resolve) => {
            timer = setTimeout(resolve, 100)
          })
        }
        return scope.webServer.port
      }

      const run = async () => {
        const port = await waitForPort()
        if (cancelled || !port || !config.autoPublish) return
        try {
          await service.publish()
        } catch (error) {
          const code = error && typeof error.code === 'string' ? error.code : 'tailscale/error'
          // 预期内的不可用（没装/没跑/没登录）不刷屏，交给设置页的健康检查显示。
          if (code !== 'tailscale/not-installed' && code !== 'tailscale/not-running' && code !== 'tailscale/not-logged-in' && code !== 'tailscale/https-disabled') {
            console.warn(`dsh-tailscale: 自动发布失败（${code}）：${messageOf(error)}`)
          }
        }
      }
      void run()

      return () => {
        cancelled = true
        if (timer) clearTimeout(timer)
        if (config.unpublishOnExit) {
          service.unpublish().catch((error) => {
            console.warn(`dsh-tailscale: 退出时撤回入口失败：${messageOf(error)}`)
          })
        }
      }
    }, 'dsh-tailscale: auto publish')
  })
}
