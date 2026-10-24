// dsh-tailscale · 设备归一化（纯函数，便于单测）
// 输入 `tailscale status --json`，输出稳定的 TailnetDevice 形状；不包含任何密钥类字段。

export function stripDot(value) {
  return typeof value === 'string' ? value.replace(/\.$/, '') : ''
}

function ipsOf(raw) {
  return Array.isArray(raw?.TailscaleIPs) ? raw.TailscaleIPs.filter((ip) => typeof ip === 'string') : []
}

/** 单个 Self / Peer 节点 → TailnetDevice。 */
export function toDevice(raw, isSelf = false) {
  if (!raw || typeof raw !== 'object') return null
  const dnsName = stripDot(raw.DNSName)
  const hostName = typeof raw.HostName === 'string' && raw.HostName ? raw.HostName : dnsName.split('.')[0] || 'unknown'
  return {
    id: typeof raw.ID === 'string' ? raw.ID : '',
    hostName,
    dnsName,
    ips: ipsOf(raw),
    os: typeof raw.OS === 'string' ? raw.OS : '',
    online: raw.Online === true,
    tags: Array.isArray(raw.Tags) ? raw.Tags.filter((tag) => typeof tag === 'string') : [],
    lastSeen: typeof raw.LastSeen === 'string' ? raw.LastSeen : '',
    direct: typeof raw.CurAddr === 'string' && raw.CurAddr !== '',
    relay: typeof raw.Relay === 'string' ? raw.Relay : '',
    isSelf: isSelf === true,
  }
}

export function compareDevices(a, b) {
  if (a.online !== b.online) return a.online ? -1 : 1
  return String(a.hostName).localeCompare(String(b.hostName), 'en', { sensitivity: 'base' })
}

/** status JSON → { backend, version, dnsName, magicDnsSuffix, certDomains, self, devices }。 */
export function normalizeStatus(status) {
  const raw = status && typeof status === 'object' ? status : {}
  const self = toDevice(raw.Self, true)
  const peers = Object.values(raw.Peer && typeof raw.Peer === 'object' ? raw.Peer : {})
    .map((peer) => toDevice(peer, false))
    .filter(Boolean)
  const devices = [self, ...peers].filter(Boolean).sort(compareDevices)
  return {
    backend: typeof raw.BackendState === 'string' ? raw.BackendState : 'Unknown',
    version: typeof raw.Version === 'string' ? raw.Version : '',
    dnsName: self ? self.dnsName : '',
    magicDnsSuffix: typeof raw.MagicDNSSuffix === 'string' ? raw.MagicDNSSuffix : '',
    certDomains: Array.isArray(raw.CertDomains) ? raw.CertDomains.filter((d) => typeof d === 'string') : [],
    self,
    devices,
  }
}

/** 把 allow 配置编译成 RegExp 列表（非法项忽略）。 */
export function compileAllow(allow) {
  if (!Array.isArray(allow)) return []
  const out = []
  for (const item of allow) {
    if (item instanceof RegExp) {
      out.push(item)
      continue
    }
    if (typeof item !== 'string' || !item) continue
    try {
      out.push(new RegExp(item))
    } catch {}
  }
  return out
}

function matchesAllow(device, patterns) {
  if (patterns.length === 0) return true
  const fields = [device.hostName, device.dnsName, ...device.ips, ...device.tags]
  return patterns.some((pattern) => fields.some((field) => field && pattern.test(field)))
}

export function filterDevices(devices, { online, allow } = {}) {
  const patterns = compileAllow(allow)
  return devices.filter((device) => {
    if (online === true && !device.online) return false
    return matchesAllow(device, patterns)
  })
}

/** hostName / dnsName / IP 前缀 / IP 全等匹配一台设备。 */
export function findDevice(devices, ref) {
  const needle = String(ref || '').trim().toLowerCase()
  if (!needle) return null
  return (
    devices.find((device) => device.dnsName.toLowerCase() === needle) ||
    devices.find((device) => device.hostName.toLowerCase() === needle) ||
    devices.find((device) => device.ips.some((ip) => ip.toLowerCase() === needle)) ||
    devices.find((device) => device.ips.some((ip) => ip.toLowerCase().startsWith(needle))) ||
    null
  )
}

/** 某个地址是否落在 tailnet 网段（100.64/10 或 Tailscale IPv6 ULA）。 */
export function isTailnetAddress(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return false
  if (text.includes(':')) return /^fd7a:115c:a1e0:[0-9a-f:]+$/.test(text)
  const parts = text.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => (/^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : NaN))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127
}
