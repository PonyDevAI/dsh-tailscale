# dsh-tailscale

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的 Tailscale 插件：

1. **入站**：随 DSH 启动自动把 Web GUI 发布到你的 tailnet（`https://<节点>.<tailnet>.ts.net/`），手机/平板在任何网络下打开一个网址就能用；退出时只撤回自己创建的路由。
2. **出站**：把 tailnet 的设备清单与可达性暴露成 `ctx.tailscale` 服务，供其他插件消费（手机、终端、同步等）。插件本身不认识 adb / hdc / ssh。

> 私网使用，**不会**启用 Tailscale Funnel。

## 安装

```sh
dsh plugin --profile web add @ponydev/dsh-tailscale
# 本地开发
dsh plugin --profile web add link:/Users/pony/deepseek/plugins/dsh-tailscale
```

装完重启 `dsh web`（或让 HMR 重组合），打开 **设置 → 远程访问**。

## 它做什么

启动时（`autoPublish: true`）：

1. 读取 `tailscale status --json`，确认 `BackendState === "Running"`、拿到 `Self.DNSName`。
2. 读取 `tailscale serve status --json`，按四态处理目标路由：
   - `absent` → `tailscale serve --bg --https=<httpsPort> [--set-path=<path>] http://127.0.0.1:<webPort>`；
   - `exact` → 认领（上次崩溃留下的路由），不重建；
   - `stale` → 重建；`conflict` → **只报错，不覆盖**。
3. 把 `<dnsName>` 推进 `connection.trustedHosts`（`serve` 保留 Host 头，不加会被 `/api` 403）。
4. 写 `$DSH_HOME/tailscale.json`（0600，只含 URL/端口/归属，**不存 token**）。

退出时：`tailscale serve --https=<httpsPort> [--set-path=<path>] off`，只撤自己那条；**绝不** `serve reset`、**绝不** `tailscale down`。

## 手机登录

设置页「远程访问」→「生成登录链接」会调用 DSH 的 `connection.authenticatedUrl()`，得到带本次进程 launch token 的链接。
手机打开一次 → DSH 换成持久 cookie（签名密钥存在 credentials，默认 30 天）→ 之后直接打开 `https://<节点>.<tailnet>.ts.net/` 即可，**跨 DSH 重启不用重新登录**。

链接含令牌，属敏感信息：UI 展示 60 秒后自动隐藏，插件不落盘、不打日志。

## 配置（cordis.patch.yml）

```yaml
- insert:
    - id: tailscale
      name: "@ponydev/dsh-tailscale"
      config:
        autoPublish: true      # 启动自动发布
        httpsPort: 443         # serve 的 HTTPS 端口
        publishPath: /         # 单实例用 /；多实例可用 /dsh2
        unpublishOnExit: true  # 退出撤回自己建的路由
        adoptExisting: true    # 认领上次崩溃残留（target 精确匹配）
        trustHost: true        # 自动维护 connection.trustedHosts
        deviceTtlMs: 10000
        probeTimeoutMs: 800
        allow: []              # 设备过滤正则
```

## 给其他插件用：`ctx.tailscale`

```js
// 可选消费：不要写进 inject（服务不存在时插件会整个不启动）
const tailscale = ctx.get('tailscale')
if (tailscale) {
  const peers = await tailscale.devices({ online: true })
  const hit = await tailscale.probe(peers[0].dnsName, 5555) // 单次 TCP connect
  tailscale.subscribe(() => { /* 入口/设备变化 */ })
}
```

服务方法：`status()`、`devices()`、`device(ref)`、`publication()`、`health({deep})`、`snapshot()`、`publish()`、`unpublish()`、`loginUrl()`、`probe(host, port)`、`subscribe(fn)`。

约定：`devices()` 只给 tailnet 事实，不认协议；adb/hdc/ssh 由消费方实现。`probe()` 只接受 tailnet 网段地址或当前设备清单里的主机。

## 安全边界

- `/tailscale/*` 全部经 `connection.admit()`：未认证 401，跨站 Origin 403。
- 不存 token/cookie；状态文件 0600。
- 不执行 `up` / `down` / `login` / `serve reset`；不改 ACL、不启 Funnel。
- 命令一律 `execFile` + 参数数组，不经过 shell。

## 排障

看 **设置 → 远程访问 → 诊断**。常见状态：

| 状态 | 含义 | 处理 |
|---|---|---|
| 未安装 | 找不到 tailscale CLI | macOS 装 standalone 版；或配置 `cliPath` |
| 未运行 / 未登录 | `BackendState` 不是 Running | 打开 Tailscale 并确认登录 |
| HTTPS 未启用 | tailnet 没开 HTTPS/MagicDNS | 管理后台开启 |
| 路由冲突 | 该域名/path 已指向别的服务 | 设置页显示现有路由，先手动处理 |
| 信任未生效 | 远程页面能开、发消息 403 | 重新开启入口；或在 profile patch 里加 trustHosts |

命令行自查（不打印 token）：

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json | head -5
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
curl -sI https://<节点>.<tailnet>.ts.net/   # 401 = 入口可达（正常）
```

## 开发

```sh
npm run check   # node --check
npm run smoke   # 假 CLI + 单元/服务层测试，全部离线
```

Client 半区是手写 `window.__ModuleLoader__.load` bundle，无构建步骤；改 `lib/client.js` 保存后浏览器通常免刷新（`dsh-client-hmr`）。改 Host 文件后 touch 一下 profile 的 `cordis.patch.yml` 触发重组合。

## License

MIT
