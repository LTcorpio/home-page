// 页面偏好：按设备保存在浏览器 localStorage，仅当前设备生效。
// 沿用旧版键名，升级后用户的既有偏好不丢失。

export interface Prefs {
  probeOn: boolean
  autoSec: number
  onOpen: boolean
  clockSec: boolean
}

export const DEFAULT_PREFS: Prefs = {
  probeOn: false,
  autoSec: 0,
  onOpen: false,
  clockSec: false,
}

const KEYS = {
  probeOn: 'hp:probeOn',
  autoSec: 'hp:autoSec',
  onOpen: 'hp:onOpen',
  clockSec: 'hp:clockSec',
}

export function readPrefs(): Prefs {
  const out = { ...DEFAULT_PREFS }
  try {
    const po = localStorage.getItem(KEYS.probeOn)
    if (po !== null) out.probeOn = po === '1'
    const sec = parseInt(localStorage.getItem(KEYS.autoSec) ?? '', 10)
    if (!Number.isNaN(sec)) out.autoSec = Math.max(0, Math.min(86400, sec))
    const on = localStorage.getItem(KEYS.onOpen)
    if (on !== null) out.onOpen = on === '1'
    const cs = localStorage.getItem(KEYS.clockSec)
    if (cs !== null) out.clockSec = cs === '1'
  } catch {
    // localStorage 不可用（隐私模式等）时使用默认值
  }
  return out
}

export function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEYS.probeOn, p.probeOn ? '1' : '0')
    localStorage.setItem(KEYS.autoSec, String(p.autoSec))
    localStorage.setItem(KEYS.onOpen, p.onOpen ? '1' : '0')
    localStorage.setItem(KEYS.clockSec, p.clockSec ? '1' : '0')
  } catch {
    // 忽略存储失败，本次会话内仍生效
  }
}

// 卡片绑定的容器列表：与后端一致，支持英文 / 中文逗号或空格分隔
export function splitList(raw: string): string[] {
  return String(raw || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
