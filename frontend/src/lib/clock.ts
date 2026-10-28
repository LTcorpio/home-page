// 服务端时钟：以一次 HTTP 往返做 NTP 式校时，之后用单调时钟（performance.now）
// 推算当前服务端时间。相比 setInterval 每秒自增，可避开三类漂移：
//   1. 定时器回调「至少间隔」导致的累积误差；
//   2. 后台标签页被浏览器节流（Chrome 可降到每分钟一次）；
//   3. 本机系统时间被手动修改后，已校准的时间立刻失真。
// 展示时按服务端时区偏移渲染，保证与访问者所在时区无关。

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const RESYNC_MS = 5 * 60 * 1000 // 周期校时
const STALE_MS = 60 * 1000 // 回到前台时，超过该时长未校时则补一次

export interface TimePayload {
  now_ms?: number
  tz_offset_sec?: number
}

export interface ServerTime {
  hh: string
  mm: string
  ss: string
  dateStr: string
  weekday: string
}

interface Anchor {
  serverMs: number // 校时时刻的服务端 epoch
  perfMs: number // 对应的单调时钟读数
  wallMs: number // 对应的本机墙上时钟（休眠期间单调时钟可能停走，用它兜底）
}

const localTzOffsetSec = () => -new Date().getTimezoneOffset() * 60

export function useServerClock(): {
  time: ServerTime
  sync: (payload: TimePayload, sentAtPerf: number) => void
} {
  const [initial] = useState(() => ({
    serverMs: Date.now(),
    perfMs: performance.now(),
    tz: localTzOffsetSec(),
  }))
  const anchor = useRef<Anchor>({
    serverMs: initial.serverMs,
    perfMs: initial.perfMs,
    wallMs: initial.serverMs,
  })
  const lastSync = useRef(0)
  const [nowMs, setNowMs] = useState(initial.serverMs)
  const [tzOffsetSec, setTzOffsetSec] = useState(initial.tz)

  // 当前服务端时刻 = 锚点 + 单调时钟增量。休眠唤醒后部分浏览器会暂停
  // performance.now()，此时若墙上时钟明显走得更远则改用它补足。
  const current = useCallback(() => {
    const a = anchor.current
    const mono = performance.now() - a.perfMs
    const wall = Date.now() - a.wallMs
    return a.serverMs + Math.max(0, wall > mono + 1000 ? wall : mono)
  }, [])

  // 用一次往返（sentAt → 收到响应）估算时钟偏移：服务端时间戳约对应往返中点，
  // 故取 now_ms + RTT/2 作为「收到响应这一刻」的服务端时刻
  const sync = useCallback(
    (payload: TimePayload, sentAtPerf: number) => {
      if (typeof payload.now_ms !== 'number' || !Number.isFinite(payload.now_ms)) return
      const recvAt = performance.now()
      const rtt = Math.max(0, recvAt - sentAtPerf)
      anchor.current = {
        serverMs: payload.now_ms + rtt / 2,
        perfMs: recvAt,
        wallMs: Date.now(),
      }
      if (typeof payload.tz_offset_sec === 'number' && Number.isFinite(payload.tz_offset_sec)) {
        setTzOffsetSec(payload.tz_offset_sec)
      }
      lastSync.current = recvAt
      setNowMs(anchor.current.serverMs)
    },
    [],
  )

  const resync = useCallback(async () => {
    const sentAt = performance.now()
    try {
      const data = await api<TimePayload>('/api/time', { timeout: 5000 })
      sync(data, sentAt)
    } catch {
      // 校时失败保留当前时钟继续走，不打断页面
    }
  }, [sync])

  // 周期校时 + 回到前台时立即重算并视情况补校（后台定时器会被节流）
  useEffect(() => {
    const timer = window.setInterval(() => void resync(), RESYNC_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setNowMs(current())
      if (performance.now() - lastSync.current > STALE_MS) void resync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [resync, current])

  // 节拍对齐到下一个整秒，每次重新按锚点计算，避免误差累积
  useEffect(() => {
    let timer = 0
    const tick = () => {
      const ms = current()
      setNowMs(ms)
      timer = window.setTimeout(tick, 1000 - (ms % 1000) + 5)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [current])

  const wall = new Date(nowMs + tzOffsetSec * 1000)
  return {
    time: {
      hh: String(wall.getUTCHours()).padStart(2, '0'),
      mm: String(wall.getUTCMinutes()).padStart(2, '0'),
      ss: String(wall.getUTCSeconds()).padStart(2, '0'),
      dateStr: `${wall.getUTCFullYear()}-${String(wall.getUTCMonth() + 1).padStart(2, '0')}-${String(wall.getUTCDate()).padStart(2, '0')}`,
      weekday: WEEKDAYS[wall.getUTCDay()],
    },
    sync,
  }
}
