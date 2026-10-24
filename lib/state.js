// dsh-tailscale · 状态文件（$DSH_HOME/tailscale.json）
// 只存路由归属信息（url/path/target/host/owned），绝不存 token 或 cookie。
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function resolveDshHome(explicit) {
  if (typeof explicit === 'string' && explicit) return explicit
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return join(homedir(), '.dsh')
}

export function createStateStore({ dshHome, fileName = 'tailscale.json' } = {}) {
  const file = join(resolveDshHome(dshHome), fileName)
  return {
    file,
    async read() {
      try {
        const text = await readFile(file, 'utf8')
        const data = JSON.parse(text)
        return data && typeof data === 'object' && Object.keys(data).length > 0 ? data : null
      } catch {
        return null
      }
    },
    async write(data) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
      // 已有文件的 mode 不会被 writeFile 收紧，这里显式 chmod。
      await chmod(file, 0o600).catch(() => {})
    },
    async clear() {
      try {
        await rm(file, { force: true })
      } catch {}
    },
  }
}
