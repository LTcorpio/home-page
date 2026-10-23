import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from 'react'
import { api } from '../lib/api'
import { DEFAULT_PREFS, readPrefs, splitList, writePrefs, type Prefs } from '../lib/prefs'
import type {
  BoardData,
  BoardGroup,
  Container,
  ContainerOpResponse,
  ContainersResponse,
  Identity,
  Item,
} from '../lib/types'
import { Icon, type IconName } from '../components/Icons'
import { ItemIcon } from '../components/ItemIcon'
import { Switch } from '../components/Switch'
import { Wallpaper } from '../components/Wallpaper'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/PopConfirm'
import { BTN, BTN_PRIMARY, cx, INPUT } from '../components/ui'

interface ProbeResult {
  online: boolean
  error?: string
  ts: number
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const PROBE_TIMEOUT = 4000
const EMPTY_IDENTITY: Identity = { user: '', name: '', email: '', groups: [] }

// 经域名访问首页（https://example.com，走 SSO）→ 用卡片主地址 url；
// 经 IP 直连访问（http://127.0.0.1/）→ 配了局域网地址的卡片改用 lan_url。
const LAN_MODE = (() => {
  const h = String(location.hostname || '').replace(/^\[|\]$/g, '')
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')
})()

function effURL(it: Item) {
  return LAN_MODE && it.lan_url ? it.lan_url : it.url || ''
}

const isWebURL = (addr: string) => /^https?:\/\//i.test(addr)

// 三级闸门：本机开关 + 站点总闸 + 卡片开关，另要求分组未设为关闭
function probeAllowedFor(
  it: Item,
  prefs: Prefs,
  settings: Record<string, string>,
  groups: BoardGroup[],
) {
  if (!prefs.probeOn || !it || it.hidden || !it.probe) return false
  if (settings.probe_enabled !== '1') return false
  const g = groups.find((x) => x.id === it.group_id)
  return !(g && g.probe === 'off')
}

async function probeCard(it: Item): Promise<ProbeResult | null> {
  const addr = effURL(it)
  if (!addr || !isWebURL(addr)) return null
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT)
  try {
    await fetch(addr, {
      method: 'GET',
      mode: 'no-cors',
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    return { online: true, ts: Date.now() }
  } catch (e) {
    const err =
      e instanceof Error && e.name === 'AbortError'
        ? '请求超时'
        : '无法访问（网络不通 / 连接被拒 / 证书不受信任等）'
    return { online: false, error: err, ts: Date.now() }
  } finally {
    window.clearTimeout(timer)
  }
}

// 卡片绑定容器中「已存在且未运行」的名字；容器缺失不计（接口失败时避免全页误判红）
function downContainers(it: Item | undefined, containers: Record<string, Container>) {
  if (!it || !it.container_name) return []
  const down: string[] = []
  for (const n of splitList(it.container_name)) {
    const c = containers[n]
    if (c && c.state !== 'running') down.push(n)
  }
  return down
}

function containerSummary(containers: Record<string, Container>, names: string[]) {
  if (!names.length) return ''
  const present = names.map((n) => containers[n]).filter(Boolean)
  const running = present.filter((c) => c.state === 'running').length
  const missing = names.length - present.length
  let st: string
  if (running === names.length) st = '运行中'
  else if (running > 0) st = `${running}/${names.length} 运行`
  else st = missing > 0 ? '已停止（含未找到容器）' : '已停止'
  return `${names.length} 个容器 · ${st}`
}

const FLOAT_BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border-none bg-card text-dim backdrop-blur-[6px] transition-colors duration-150 hover:bg-card-hover hover:text-ink'

const DOT_CLASS: Record<string, string> = {
  online: 'bg-ok opacity-100 shadow-[0_0_6px_rgba(74,222,128,0.8)]',
  offline: 'bg-bad opacity-100',
  pending: 'bg-faint opacity-60 dot-pending',
  idle: 'bg-faint opacity-50',
}

export default function HomePage() {
  const { toast } = useToast()
  const { askConfirm } = useConfirm()

  const [settings, setSettings] = useState<Record<string, string>>({})
  const [groups, setGroups] = useState<BoardGroup[]>([])
  const [features, setFeatures] = useState({ docker: false, admin: false })
  const [identity, setIdentity] = useState<Identity>(EMPTY_IDENTITY)
  const [containers, setContainers] = useState<Record<string, Container>>({})
  const [probes, setProbes] = useState<Record<number, ProbeResult>>({})
  const [probing, setProbing] = useState(false)
  const [spin, setSpin] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [draft, setDraft] = useState<Prefs>(prefs)
  const [menu, setMenu] = useState<{ x: number; y: number; itemId: number } | null>(null)
  const [memoItem, setMemoItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())

  const featuresRef = useRef(features)
  featuresRef.current = features
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const probeGen = useRef(0)
  const initialProbeDone = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const prefsBoxRef = useRef<HTMLDivElement>(null)

  const itemById = useMemo(() => {
    const map: Record<number, Item> = {}
    for (const g of groups) for (const it of g.items) map[it.id] = it
    return map
  }, [groups])

  const probeAllowed = (it: Item) => probeAllowedFor(it, prefs, settings, groups)
  const anyProbeAllowed = groups.some((g) => g.items.some(probeAllowed))
  const canShowMenu = (it: Item | undefined) =>
    !!(features.admin && it && !it.hidden && (it.memo || (it.container_name && features.docker)))

  const reachReason = (id: number) => {
    if (!features.admin) return ''
    const down = downContainers(itemById[id], containers)
    if (down.length) return `：容器未运行（${down.join('、')}）`
    const res = probes[id]
    return res?.error ? `：${res.error}` : ''
  }

  const openItem = (it: Item) => {
    if (it.hidden) {
      toast(`「${it.name}」已禁用`)
      return
    }
    const res = probes[it.id]
    if (res && !res.online) {
      toast(`「${it.name}」当前不可达${reachReason(it.id)}`)
      return
    }
    const url = effURL(it)
    if (url) window.open(url, '_blank')
  }

  /* ------------------------------------------------ 探测 */
  const probeAll = useCallback(async (manual = false) => {
    if (!prefsRef.current.probeOn) return
    const gen = ++probeGen.current
    setProbing(true)
    setSpin(manual)
    setProbes({})
    const targets: Item[] = []
    for (const g of groupsRef.current) {
      for (const it of g.items) {
        if (!probeAllowedFor(it, prefsRef.current, settingsRef.current, groupsRef.current)) continue
        if (isWebURL(effURL(it))) targets.push(it)
      }
    }
    await Promise.allSettled(
      targets.map(async (it) => {
        const r = await probeCard(it)
        if (!r || gen !== probeGen.current) return
        setProbes((prev) => ({ ...prev, [it.id]: r }))
      }),
    )
    if (gen !== probeGen.current) return
    setProbing(false)
    setSpin(false)
  }, [])

  const refreshContainers = useCallback(async () => {
    if (!featuresRef.current.docker) return
    try {
      const data = await api<ContainersResponse>('/api/containers', { timeout: 8000 })
      setContainers(data.containers || {})
    } catch {
      // 获取失败保留上次状态，不打断页面
    }
  }, [])

  // 初始加载看板
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<BoardData>('/api/board')
        if (cancelled) return
        setSettings(data.settings || {})
        setGroups(data.groups || [])
        setFeatures(data.features || { docker: false, admin: false })
        setIdentity(data.identity || EMPTY_IDENTITY)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 时钟
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  // 首页禁止选中文本
  useEffect(() => {
    document.body.classList.add('no-select')
    return () => document.body.classList.remove('no-select')
  }, [])

  // 标签页标题
  useEffect(() => {
    document.title = settings.site_title || 'Home'
  }, [settings.site_title])

  // 容器状态：首次拉取后每 10 秒刷新
  useEffect(() => {
    if (loading || !features.docker) return
    void refreshContainers()
    const t = window.setInterval(() => void refreshContainers(), 10000)
    return () => window.clearInterval(t)
  }, [loading, features.docker, refreshContainers])

  // 开页立即探测（仅在三级闸门放行时）
  useEffect(() => {
    if (loading || initialProbeDone.current) return
    initialProbeDone.current = true
    if (prefs.onOpen && groups.some((g) => g.items.some((it) => probeAllowedFor(it, prefs, settings, groups)))) {
      void probeAll(true)
    }
  }, [loading, prefs, settings, groups, probeAll])

  // 自动重探
  useEffect(() => {
    if (!prefs.probeOn || prefs.autoSec <= 0) return
    const t = window.setInterval(() => {
      if (!document.hidden) void probeAll(false)
    }, prefs.autoSec * 1000)
    return () => window.clearInterval(t)
  }, [prefs.probeOn, prefs.autoSec, probeAll])

  /* ------------------------------------------------ 偏好 */
  const applyPrefs = useCallback(
    (next: Prefs, msg: string) => {
      const wasOn = prefsRef.current.probeOn
      writePrefs(next)
      prefsRef.current = next
      setPrefs(next)
      if (!next.probeOn) {
        setProbes({})
      } else if (!wasOn) {
        void probeAll(true)
      }
      toast(msg)
    },
    [probeAll, toast],
  )

  const openPrefs = () => {
    setDraft(prefs)
    setPrefsOpen((v) => !v)
  }

  useEffect(() => {
    if (!prefsOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!prefsBoxRef.current?.contains(e.target as Node)) setPrefsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrefsOpen(false)
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [prefsOpen])

  const savePrefs = () => {
    const sec = Math.max(0, Math.min(86400, Math.round(Number(draft.autoSec) || 0)))
    const next = { ...draft, autoSec: sec }
    setPrefsOpen(false)
    const parts = [
      next.probeOn ? '已启用探测' : '探测器已关闭',
      sec > 0 ? `自动重探每 ${sec} 秒` : '已关闭自动重探',
      next.onOpen ? '开页即探' : '开页不探',
      next.clockSec ? '时间显示秒' : '时间隐藏秒',
    ]
    applyPrefs(next, `已保存：${parts.join('，')}`)
  }

  const resetPrefs = () => {
    setPrefsOpen(false)
    applyPrefs(DEFAULT_PREFS, '已恢复默认：关闭探测器、关闭自动重探、打开页面不立即探测、时间不显示秒')
  }

  /* ------------------------------------------------ 右键菜单 */
  useEffect(() => {
    if (!menu) return
    const opened = Date.now()
    const hide = () => setMenu(null)
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) hide()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    const onScroll = () => {
      if (Date.now() - opened > 250) hide()
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', hide)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', hide)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu])

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const r = menuRef.current.getBoundingClientRect()
    const px = Math.min(menu.x, window.innerWidth - r.width - 8)
    const py = Math.min(menu.y, window.innerHeight - r.height - 8)
    menuRef.current.style.left = `${Math.max(8, px)}px`
    menuRef.current.style.top = `${Math.max(8, py)}px`
  }, [menu])

  /* ------------------------------------------------ 容器操作 */
  const containerAction = async (item: Item, action: 'start' | 'stop' | 'restart') => {
    const names = splitList(item.container_name)
    const label = { start: '启动', stop: '停止', restart: '重启' }[action]
    const target = names.length > 1 ? `${item.name}（${names.length} 个容器）` : names[0]
    if (action !== 'start') {
      const card = document.querySelector<HTMLElement>(`[data-card-id="${item.id}"]`)
      const ok = await askConfirm(`确认${label}「${target}」？`, card, `确认${label}`)
      if (!ok) return
    }
    toast(`正在${label} ${names.length > 1 ? item.name : names[0]}…`)
    try {
      const data = await api<ContainerOpResponse>(`/api/items/${item.id}/containers/${action}`, {
        method: 'POST',
      })
      const failed = (data.results || []).filter((r) => !r.ok)
      if (failed.length) {
        toast(`${label}部分失败：${failed[0].name} ${failed[0].error || ''}`)
      } else {
        toast(`已${label} ${names.length > 1 ? `${names.length} 个容器` : names[0]}`)
      }
      if (prefsRef.current.probeOn && prefsRef.current.autoSec > 0) {
        window.setTimeout(() => void probeAll(false), 900)
      } else {
        setProbes({})
      }
    } catch (e) {
      toast(`${label}失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /* ------------------------------------------------ 渲染辅助 */
  const statusFor = (it: Item) => {
    const addr = effURL(it)
    const web = isWebURL(addr)
    const down = downContainers(it, containers)
    const cDown = down.length > 0
    const res = probes[it.id]
    let dot = 'idle'
    let title = ''
    if (it.hidden) {
      dot = 'idle'
    } else if (res) {
      if (cDown) {
        dot = 'offline'
        title = features.admin ? `离线：容器未运行（${down.join('、')}）` : '离线'
      } else if (res.online) {
        dot = 'online'
        title = '在线'
      } else {
        dot = 'offline'
        title = features.admin && res.error ? `离线：${res.error}` : '离线'
      }
    } else if (probeAllowed(it) && probing && web) {
      dot = 'pending'
    } else if (probeAllowed(it) && !web && addr) {
      dot = 'idle'
      title = '非网页地址，浏览器无法判定可达性'
    }
    const dead = (!it.hidden && !!res && !res.online) || cDown
    return { dot, title, dead }
  }

  const menuItem = menu ? itemById[menu.itemId] : undefined
  const menuNames = menuItem ? splitList(menuItem.container_name) : []
  const menuPresent = menuNames.map((n) => containers[n]).filter(Boolean)
  const menuRunning = menuPresent.filter((c) => c.state === 'running').length
  const menuDocker = !!(menuNames.length && features.docker)
  const menuActions: Array<{ act: IconName | 'memo' | 'open'; label: string; danger?: boolean }> = []
  if (menuDocker && menuRunning < menuNames.length)
    menuActions.push({ act: 'start', label: '启动容器' })
  if (menuDocker && menuRunning > 0) {
    menuActions.push({ act: 'stop', label: '停止容器', danger: true })
    menuActions.push({ act: 'restart', label: '重启容器' })
  }
  if (menuItem?.memo) menuActions.push({ act: 'memo', label: '查看备注' })
  menuActions.push({ act: 'open', label: '打开链接' })

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const weekday = WEEKDAYS[now.getDay()]

  const portal = (settings.auth_portal || '').trim()
  const chipLabel = identity.name || identity.user || ''
  const chipGroups = Array.isArray(identity.groups) ? identity.groups : []
  const chipTitle = chipLabel
    ? `已登录：${identity.user || chipLabel}（组：${chipGroups.length ? chipGroups.join('、') : '无'}）${portal ? '；点击前往认证中心登录 / 切换账号' : ''}`
    : portal
      ? '未登录（匿名访客）：点击前往认证中心登录，当前仅显示公开卡片'
      : '未携带 SSO 身份（匿名访客），仅显示公开卡片'
  const chipClass = cx(
    'inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-[5px] text-xs text-dim backdrop-blur-[6px] transition-colors duration-150',
    chipLabel ? '' : 'text-faint',
    portal ? 'cursor-pointer hover:bg-card-hover hover:text-ink' : 'cursor-default',
  )
  const chipBody = (
    <>
      <Icon name="user" size={13} />
      <span>{chipLabel || '未登录'}</span>
    </>
  )

  const visible = groups.filter((g) => g.items.length > 0)

  return (
    <>
      <Wallpaper
        image={settings.background_image}
        blur={Number(settings.background_blur) || 2}
        mask={Number(settings.background_mask) || 0}
      />

      {/* 右上角浮条：登录身份 + 手动探测 + 管理入口 + 页面偏好 */}
      <div className="fixed right-4 top-3.5 z-30 flex items-center gap-2.5">
        {portal ? (
          <a className={chipClass} href={portal} title={chipTitle} aria-label="前往认证中心">
            {chipBody}
          </a>
        ) : (
          <span className={chipClass} title={chipTitle}>
            {chipBody}
          </span>
        )}

        {prefs.probeOn && anyProbeAllowed && (
          <button
            type="button"
            className={FLOAT_BTN}
            title="立即探测一次并刷新状态"
            onClick={() => {
              if (!prefs.probeOn) {
                toast('本机探测已关闭：可在右上角「页面偏好 → 启用探测」开启')
                return
              }
              if (!anyProbeAllowed) {
                toast('可达性检测未启用：请在后台「站点设置 → 可达性检测」开启')
                return
              }
              void probeAll(true)
            }}
          >
            <Icon name="refresh" size={17} className={spin ? 'spin' : undefined} />
          </button>
        )}

        {features.admin && (
          <a className={FLOAT_BTN} href="/admin" title="管理后台">
            <Icon name="gear" size={18} />
          </a>
        )}

        <div className="relative inline-flex" ref={prefsBoxRef}>
          <button
            type="button"
            className={FLOAT_BTN}
            title="页面偏好设置"
            onClick={(e) => {
              e.stopPropagation()
              openPrefs()
            }}
          >
            <Icon name="sliders" size={16} />
          </button>

          {prefsOpen && (
            <div className="selectable absolute right-0 top-10 z-[60] w-[300px] max-w-[calc(100vw-32px)] rounded-[14px] border border-white/10 bg-[rgba(30,31,38,0.96)] px-4 pt-3.5 pb-3 text-left shadow-[0_14px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
              <div
                className="text-[13px] font-bold text-ink"
                title="偏好保存在本机浏览器，仅对当前设备生效"
              >
                页面偏好
              </div>

              <div className="mt-3 text-[11px] font-bold tracking-[0.6px] text-dim">自动探测</div>

              <div
                className="mt-3 flex items-center gap-2.5"
                title="本机探测器开关（仅当前设备生效）。关闭（默认）时本机永不触发探测：开页、定时重探、容器启停、手动刷新都不探，所有状态点保持灰点；开启后才按下面两项的节奏探测（还需后台「站点设置 → 可达性检测」总闸开启，且该卡片所在分组未被设为关闭）"
              >
                <span className="w-[104px] flex-none text-xs text-dim">启用探测</span>
                <div className="flex flex-1 items-center justify-end">
                  <Switch
                    checked={draft.probeOn}
                    onChange={(v) => setDraft({ ...draft, probeOn: v })}
                  />
                </div>
              </div>

              {draft.probeOn && (
                <>
                  <div
                    className="mt-3 flex items-center gap-2.5"
                    title="页面可见时每隔该秒数自动探测一轮；0 = 关闭自动重探（此时容器启停也不自动探测，旧结果清空回灰点），仅手动刷新可探测"
                  >
                    <span className="w-[104px] flex-none text-xs text-dim">自动重探间隔</span>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-[7px]">
                      <input
                        type="number"
                        min={0}
                        max={86400}
                        step={5}
                        value={draft.autoSec}
                        onChange={(e) => setDraft({ ...draft, autoSec: Number(e.target.value) })}
                        className={`${INPUT} min-w-0 flex-1 px-[9px] py-1.5`}
                      />
                      <span className="flex-none text-xs text-faint">秒</span>
                    </div>
                  </div>
                  <div
                    className="mt-3 flex items-center gap-2.5"
                    title="每次打开首页先立即探测一轮；关闭时仅在自动重探周期（若已开启）或手动刷新时探测"
                  >
                    <span className="w-[104px] flex-none text-xs text-dim">打开页面立即探测</span>
                    <div className="flex flex-1 items-center justify-end">
                      <Switch
                        checked={draft.onOpen}
                        onChange={(v) => setDraft({ ...draft, onOpen: v })}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="mt-[14px] border-t border-white/[0.08] pt-3 text-[11px] font-bold tracking-[0.6px] text-dim">
                时钟显示
              </div>
              <div
                className="mt-3 flex items-center gap-2.5"
                title="时间显示到秒（HH:MM:SS）；关闭仅显示时:分，日期固定完整格式（如 2026-09-08 星期二）"
              >
                <span className="w-[104px] flex-none text-xs text-dim">显示秒</span>
                <div className="flex flex-1 items-center justify-end">
                  <Switch
                    checked={draft.clockSec}
                    onChange={(v) => setDraft({ ...draft, clockSec: v })}
                  />
                </div>
              </div>

              <div className="mt-[14px] flex items-center gap-2">
                <button type="button" className={BTN} onClick={resetPrefs}>
                  恢复默认
                </button>
                <div className="flex-1" />
                <button type="button" className={`${BTN} ${BTN_PRIMARY}`} onClick={savePrefs}>
                  保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="no-scrollbar fixed inset-0 z-10 overflow-x-hidden overflow-y-auto overscroll-none">
        <div
          className="mx-auto max-w-[1200px] px-3 pt-[46px] pb-[90px] max-[860px]:px-2.5 max-[860px]:pt-[68px] max-[860px]:pb-[60px]"
          style={{ maxWidth: `${Number(settings.max_width) || 1200}px` }}
        >
          <div className="mx-auto mb-1.5 text-center">
            <div className="clock inline-block text-center leading-[1.25] text-shadow">
              <div className="clock-time text-[clamp(40px,7vw,68px)] font-semibold tracking-[1px] tabular-nums">
                {hh}
                <span className="clock-colon">:</span>
                {mm}
                {prefs.clockSec && (
                  <>
                    <span className="clock-colon">:</span>
                    {ss}
                  </>
                )}
              </div>
              <div className="mt-0.5 inline-flex items-center text-[clamp(13px,1.6vw,16px)] tracking-[0.5px] text-dim">
                <span>{dateStr}</span>
                <span className="ml-[9px] font-medium text-ink">{weekday}</span>
              </div>
            </div>
          </div>

          <main className="mt-2.5">
            {error ? (
              <div className="py-20 text-center text-sm text-dim">加载失败：{error}</div>
            ) : loading ? (
              <div className="py-20 text-center text-sm text-dim">加载中…</div>
            ) : visible.length === 0 ? (
              <div className="py-20 text-center text-sm text-dim">
                {features.admin ? (
                  <>
                    还没有任何卡片，去{' '}
                    <a href="/admin" className="underline">
                      管理后台
                    </a>{' '}
                    添加吧
                  </>
                ) : (
                  '暂无可用的服务卡片'
                )}
              </div>
            ) : (
              visible.map((g) => (
                <section key={g.id} className="mt-[46px] max-[860px]:mt-[34px]">
                  <h2 className="mb-[18px] pl-2.5 text-xl font-extrabold text-ink text-shadow">
                    {g.name}
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[18px] max-[500px]:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                    {g.items.map((it) => {
                      const st = statusFor(it)
                      return (
                        <Card
                          key={it.id}
                          item={it}
                          dot={st.dot}
                          dotTitle={st.title}
                          dead={st.dead}
                          canMenu={canShowMenu(it)}
                          onOpen={openItem}
                          onMenu={(item, x, y) => setMenu({ x, y, itemId: item.id })}
                        />
                      )
                    })}
                  </div>
                </section>
              ))
            )}
          </main>
        </div>
      </div>

      {/* 卡片右键菜单：容器启停 + 备注（管理员） */}
      {menu && menuItem && (
        <div
          ref={menuRef}
          className="fixed z-[60] min-w-[150px] rounded-xl border border-white/10 bg-[rgba(30,31,38,0.92)] p-1.5 shadow-[0_10px_34px_rgba(0,0,0,0.5)] backdrop-blur-[10px]"
          style={{ left: 0, top: 0 }}
        >
          <div className="mb-1 border-b border-white/[0.08] px-2.5 pt-1 pb-[7px] text-[11px] text-faint">
            {menuItem.name}
            {menuDocker && ` · ${containerSummary(containers, menuNames)}`}
          </div>
          {menuActions.map((a) => (
            <button
              key={a.act}
              type="button"
              className={cx(
                'flex w-full items-center gap-[9px] rounded-lg border-none bg-transparent px-2.5 py-[7px] text-left text-[13px] text-dim hover:bg-white/10 hover:text-white',
                a.danger && 'hover:text-bad',
              )}
              onClick={() => {
                setMenu(null)
                if (a.act === 'memo') {
                  setMemoItem(menuItem)
                  return
                }
                if (a.act === 'open') {
                  openItem(menuItem)
                  return
                }
                void containerAction(menuItem, a.act as 'start' | 'stop' | 'restart')
              }}
            >
              <span className="inline-flex w-4 flex-none items-center justify-center opacity-85">
                <Icon name={a.act as IconName} size={14} />
              </span>
              <span className="leading-snug">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 备注查看浮层 */}
      {memoItem && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMemoItem(null)
          }}
        >
          <div className="selectable w-[min(480px,100%)] max-h-[70vh] overflow-auto rounded-2xl border border-white/10 bg-[#222329] shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-white/10 px-[18px] py-3.5 text-sm font-bold text-ink">
              <span>{memoItem.name} · 备注</span>
              <button
                type="button"
                className="inline-flex rounded-lg border-none bg-transparent p-1 text-dim hover:bg-white/10 hover:text-white"
                title="关闭"
                onClick={() => setMemoItem(null)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="whitespace-pre-wrap break-words px-[18px] py-4 text-[13px] leading-[1.7] text-ink">
              {memoItem.memo || ''}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ 卡片 */

function Card({
  item,
  dot,
  dotTitle,
  dead,
  canMenu,
  onOpen,
  onMenu,
}: {
  item: Item
  dot: string
  dotTitle: string
  dead: boolean
  canMenu: boolean
  onOpen: (item: Item) => void
  onMenu: (item: Item, x: number, y: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const longPressAt = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (!canMenu) return
    const t = e.touches[0]
    if (!t) return
    start.current = { x: t.clientX, y: t.clientY }
    fired.current = false
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      fired.current = true
      longPressAt.current = Date.now()
      if (navigator.vibrate) {
        try {
          navigator.vibrate(15)
        } catch {
          // 部分浏览器不支持振动
        }
      }
      if (start.current) onMenu(item, start.current.x, start.current.y)
    }, 500)
  }

  const cancel = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    start.current = null
  }

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (!start.current) return
    const t = e.touches[0]
    if (!t) return
    if (Math.abs(t.clientX - start.current.x) > 10 || Math.abs(t.clientY - start.current.y) > 10) {
      cancel()
    }
  }

  return (
    <div
      ref={ref}
      data-card-id={item.id}
      className={cx(
        'group relative flex w-full cursor-pointer items-center rounded-card bg-card transition-[background-color,box-shadow,opacity] duration-200 [-webkit-touch-callout:none]',
        !item.hidden &&
          !dead &&
          'hover:bg-card-hover hover:shadow-[0_0_20px_10px_rgba(0,0,0,0.2)]',
        item.hidden && 'cursor-default opacity-[0.45] hover:bg-card hover:shadow-none',
        !item.hidden && dead && 'opacity-60 hover:bg-card hover:shadow-none',
      )}
      title={item.hidden ? '已禁用' : effURL(item)}
      onClick={() => {
        if (Date.now() - longPressAt.current < 600) {
          longPressAt.current = 0
          return
        }
        onOpen(item)
      }}
      onContextMenu={(e) => {
        if (!canMenu) return
        e.preventDefault()
        onMenu(item, e.clientX, e.clientY)
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={(e) => {
        if (fired.current) e.preventDefault()
        cancel()
      }}
      onTouchCancel={cancel}
    >
      <span
        className={cx('absolute right-3 top-3 h-2 w-2 rounded-full', DOT_CLASS[dot])}
        title={dotTitle}
      />
      <div className="flex w-16 flex-none items-center justify-center">
        <div className="flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-xl">
          <ItemIcon item={item} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center py-2.5 pr-3 pl-0">
        <div className="w-full min-w-0">
          <div
            className={cx(
              'overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold text-ink',
              item.hidden && 'text-dim',
            )}
          >
            {item.name}
          </div>
          <div className="mt-[3px] line-clamp-2 text-xs leading-[1.35] text-dim">
            {item.description || ''}
          </div>
        </div>
      </div>
    </div>
  )
}
