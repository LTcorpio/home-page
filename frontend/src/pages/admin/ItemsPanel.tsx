import { useEffect, useMemo, useRef, useState } from 'react'
import { del, post, put } from '../../lib/api'
import type { Group, Item } from '../../lib/types'
import { Icon } from '../../components/Icons'
import { useToast } from '../../components/Toast'
import { BusyLayer } from '../../components/Spinner'
import { useConfirm } from '../../components/PopConfirm'
import { cx } from '../../components/ui'
import {
  BTN_PRIMARY,
  ICON_BTN,
  PANEL,
  PANEL_TITLE,
} from './adminUi'
import ItemEditor from './ItemEditor'
import { AdminIconWell } from './AdminIconWell'

interface Props {
  groups: Group[]
  items: Item[]
  docker: boolean
  knownGroups: string
  probeEnabled: boolean
  onChanged: () => Promise<void>
}

type GroupFilter = 'none' | number
type OpenId = number | 'new' | null

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const GROUP_NAV =
  'relative flex w-full items-center gap-2 rounded-[11px] px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-[#faf7f8] focus-visible:ring-2 focus-visible:ring-[#8c0f30]/15'
const GROUP_NAV_ACTIVE = 'bg-[#f9e9ee]'
const GROUP_ICON =
  'flex h-6 w-6 flex-none items-center justify-center rounded-[8px] bg-[#f4edef] text-[11px] font-bold text-[#7a6c71]'
const GROUP_ICON_ACTIVE = 'bg-white/70 text-[#8c0f30]'
const GROUP_COUNT =
  'flex h-[18px] min-w-5 flex-none items-center justify-center rounded-full bg-[#f4edef] px-1.5 text-[10px] font-bold text-[#7a6c71]'
const GROUP_COUNT_ACTIVE = 'bg-white/80 text-[#8c0f30]'

const STATUS_OK =
  'inline-flex flex-none items-center gap-1 rounded-full bg-ok/[0.12] px-2 py-0.5 text-[10px] font-semibold text-ok'
const STATUS_OFF =
  'inline-flex flex-none items-center gap-1 rounded-full bg-bad/[0.11] px-2 py-0.5 text-[10px] font-semibold text-bad'
const STATUS_DOT = 'h-1 w-1 rounded-full bg-current'

const BADGE_OK =
  'inline-flex flex-none items-center gap-1 rounded-full bg-ok/[0.12] px-2 py-0.5 text-[10px] font-semibold text-ok'
const BADGE_BAD =
  'inline-flex flex-none items-center gap-1 rounded-full bg-bad/[0.11] px-2 py-0.5 text-[10px] font-semibold text-bad'

const SEG_BTN =
  'rounded-[7px] px-2.5 py-1 text-[11.5px] transition-colors duration-150'
const SEG_ON = 'bg-white font-semibold text-[#8c0f30] shadow-[0_1px_2px_rgba(46,26,33,0.1)]'
const SEG_OFF = 'text-[#7a6c71] hover:text-[#241d20]'

/* 探测按钮：开启时实心绯红 + 白字，关闭时灰描边，明确到不用悬停也能分辨 */
const PROBE_BTN =
  'inline-flex h-7 flex-none items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40'
const PROBE_ON =
  'border-[#8c0f30] bg-[#8c0f30] text-white hover:border-[#731028] hover:bg-[#731028]'
const PROBE_OFF =
  'border-[#ddd3d7] bg-white text-[#9a8d91] hover:border-[#c9bcc1] hover:bg-[#f7f2f4] hover:text-[#5f5458]'

/* 宽屏纯图标版探测按钮：开 = 实心绯红，关 = 灰描边 */
const PROBE_ICON_BTN =
  'inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40'
const PROBE_ICON_ON =
  'border-[#8c0f30] bg-[#8c0f30] text-white hover:border-[#731028] hover:bg-[#731028] hover:text-white'
const PROBE_ICON_OFF =
  'border-[#ddd3d7] bg-white text-[#9a8d91] hover:border-[#c9bcc1] hover:bg-[#f7f2f4] hover:text-[#5f5458]'

/* 窄屏折叠面板的操作条：按钮等宽铺满一整行 */
const GROW_BTN =
  'inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[11.5px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40'
const GROW_PLAIN =
  'border-[#ddd3d7] bg-white text-[#5f5458] hover:border-[#c9bcc1] hover:bg-[#f7f2f4]'

export default function ItemsPanel({
  groups,
  items,
  docker,
  knownGroups,
  probeEnabled,
  onChanged,
}: Props) {
  const { toast } = useToast()
  const { askConfirm, askPrompt } = useConfirm()
  const [groupFilter, setGroupFilter] = useState<GroupFilter>(() => groups[0]?.id ?? 'none')
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<OpenId>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  /** 正在请求的位置：group = 分组操作，item-<id> = 单张卡片操作 */
  const [busy, setBusy] = useState<string | null>(null)
  const newBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  // 窄屏标签栏：切换分组后把当前项滚到可视区中间
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('[data-tab-active="true"]')
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [groupFilter, groups.length])

  useEffect(() => {
    if (groupFilter === 'none') return
    if (!groups.some((g) => g.id === groupFilter)) setGroupFilter(groups[0]?.id ?? 'none')
  }, [groups, groupFilter])

  useEffect(() => {
    if (typeof openId === 'number' && !items.some((it) => it.id === openId)) setOpenId(null)
  }, [items, openId])

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const timer = window.setTimeout(() => document.addEventListener('click', onOutside), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  /** 分组探测是否生效：分组显式关闭探测时，组内卡片的探测按钮一并禁用 */
  const groupProbeOn = (groupId: number) => {
    if (!groupId) return true
    const g = groups.find((x) => x.id === groupId)
    return !g || g.probe !== 'off'
  }

  const matchesGroup = (it: Item) =>
    groupFilter === 'none' ? !it.group_id : it.group_id === groupFilter

  const scoped = items.filter(matchesGroup)
  const enabled = scoped.filter((it) => !it.hidden).length
  const disabled = scoped.length - enabled
  const keyword = query.trim().toLowerCase()
  const list = scoped.filter((it) => {
    if (status === 'on' && it.hidden) return false
    if (status === 'off' && !it.hidden) return false
    if (!keyword) return true
    return `${it.name} ${it.url}`.toLowerCase().includes(keyword)
  })

  const activeGroup =
    typeof groupFilter === 'number' ? groups.find((g) => g.id === groupFilter) : undefined
  const groupIndex = activeGroup ? groups.findIndex((g) => g.id === activeGroup.id) : -1
  const isVirtual = groupFilter === 'none'
  const title = isVirtual ? '未分组' : activeGroup?.name || '未分组'
  const probeOn = activeGroup?.probe !== 'off'
  const groupItems = activeGroup ? items.filter((it) => it.group_id === activeGroup.id) : []
  const groupAllHidden = groupItems.length > 0 && groupItems.every((it) => it.hidden)
  const newGroupId = groupFilter === 'none' ? 0 : groupFilter

  const counts = useMemo(
    () => ({
      none: items.filter((it) => !it.group_id).length,
      byGroup: new Map(groups.map((g) => [g.id, items.filter((it) => it.group_id === g.id).length])),
      enabledByGroup: new Map(
        groups.map((g) => [
          g.id,
          items.filter((it) => it.group_id === g.id && !it.hidden).length,
        ]),
      ),
    }),
    [groups, items],
  )

  const selectGroup = (next: GroupFilter) => {
    setGroupFilter(next)
    setOpenId(null)
  }

  const moveGroup = async (dir: -1 | 1) => {
    if (!activeGroup || busy) return
    const j = groupIndex + dir
    if (groupIndex < 0 || j < 0 || j >= groups.length) return
    const ids = groups.map((g) => g.id)
    ;[ids[groupIndex], ids[j]] = [ids[j], ids[groupIndex]]
    setBusy('group')
    try {
      await post('/api/groups/sort', { ids })
      await onChanged()
    } catch (e) {
      toast('排序失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const changeProbe = async (next: boolean) => {
    if (!activeGroup || busy) return
    setBusy('group')
    try {
      await put(`/api/groups/${activeGroup.id}`, {
        name: activeGroup.name,
        sort: activeGroup.sort,
        probe: next ? 'on' : 'off',
      })
      await onChanged()
      toast(next ? '分组探测已开启' : '分组探测已关闭')
    } catch (e) {
      toast('更新失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const renameGroup = async (anchor: HTMLElement) => {
    if (!activeGroup || busy) return
    const next = await askPrompt('新的分组名', activeGroup.name, anchor)
    if (!next) return
    setBusy('group')
    try {
      await put(`/api/groups/${activeGroup.id}`, {
        name: next,
        sort: activeGroup.sort,
        probe: activeGroup.probe || '',
      })
      await onChanged()
    } catch (e) {
      toast('重命名失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const removeGroup = async (anchor: HTMLElement) => {
    if (!activeGroup || busy) return
    const ok = await askConfirm(
      `删除分组「${activeGroup.name}」？${scoped.length ? `该分组下 ${scoped.length} 张卡片会一并删除。` : ''}`,
      anchor,
      '删除',
    )
    if (!ok) return
    setBusy('group')
    try {
      await del(`/api/groups/${activeGroup.id}`)
      setGroupFilter(groups.find((g) => g.id !== activeGroup.id)?.id ?? 'none')
      setOpenId(null)
      await onChanged()
    } catch (e) {
      toast('删除失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const addGroup = async () => {
    setMenuOpen(false)
    const name = await askPrompt('新建分组', '', newBtnRef.current)
    if (!name) return
    setBusy('group')
    try {
      const created = await post<Group>('/api/groups', { name })
      await onChanged()
      setGroupFilter(created.id)
      setOpenId(null)
      toast('已创建分组')
    } catch (e) {
      toast('创建失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleGroupHidden = async () => {
    if (!activeGroup || busy || !groupItems.length) return
    const next = !groupAllHidden
    setBusy('group')
    try {
      for (const it of groupItems) {
        await put(`/api/items/${it.id}`, { ...it, hidden: next })
      }
      await onChanged()
      toast(
        next
          ? `已禁用「${activeGroup.name}」的 ${groupItems.length} 张卡片`
          : `已启用「${activeGroup.name}」的 ${groupItems.length} 张卡片`,
      )
    } catch (e) {
      toast('操作失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const moveItem = async (it: Item, dir: -1 | 1) => {
    if (busy) return
    const grp = items.filter((x) => x.group_id === it.group_id)
    const i = grp.findIndex((x) => x.id === it.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= grp.length) return
    ;[grp[i], grp[j]] = [grp[j], grp[i]]
    setBusy(`item-${it.id}`)
    try {
      await post('/api/items/sort', { group_id: it.group_id, ids: grp.map((x) => x.id) })
      await onChanged()
    } catch (e) {
      toast('排序失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (it: Item) => {
    if (busy) return
    setBusy(`item-${it.id}`)
    try {
      await put(`/api/items/${it.id}`, { ...it, hidden: !it.hidden })
      toast(it.hidden ? '已启用' : '已禁用')
      await onChanged()
    } catch (e) {
      toast('操作失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleProbe = async (it: Item) => {
    if (busy) return
    setBusy(`item-${it.id}`)
    try {
      await put(`/api/items/${it.id}`, { ...it, probe: !it.probe })
      toast(it.probe ? '已关闭状态探测' : '已开启状态探测')
      await onChanged()
    } catch (e) {
      toast('操作失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (it: Item, anchor: HTMLElement) => {
    if (busy) return
    const ok = await askConfirm(`删除卡片「${it.name}」？`, anchor, '删除')
    if (!ok) return
    setBusy(`item-${it.id}`)
    try {
      await del(`/api/items/${it.id}`)
      await onChanged()
    } catch (e) {
      toast('删除失败: ' + errText(e))
    } finally {
      setBusy(null)
    }
  }

  const groupBadges = (
    <>
      <span className={BADGE_OK}>
        <span className={STATUS_DOT} />
        {enabled} 启用
      </span>
      {disabled > 0 && (
        <span className={BADGE_BAD}>
          <span className={STATUS_DOT} />
          {disabled} 禁用
        </span>
      )}
    </>
  )

  return (
    <>
      <div className="flex items-end gap-3 border-b border-[#ecdde2] bg-[#faf3f5] px-4 pt-3 pb-2.5 lg:mb-4 lg:items-center lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-0">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-none text-[#9a8d91] lg:hidden">管理后台</div>
          <h1 className="m-0 mt-1.5 text-[17px] font-bold tracking-[-0.01em] text-[#241d20] lg:mt-0 lg:text-xl">
            卡片
          </h1>
        </div>
        <div ref={menuRef} className="relative flex-none">
          <button
            ref={newBtnRef}
            type="button"
            className={BTN_PRIMARY}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="plus" size={14} />
            新建
            <Icon
              name="chevron"
              size={12}
              className={cx('ml-[-1px] opacity-80 transition-transform', menuOpen && 'rotate-180')}
            />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="新建"
              className="absolute top-[calc(100%+6px)] right-0 z-40 min-w-[168px] rounded-xl border border-[#e7dfe2] bg-white p-1.5 shadow-[0_8px_28px_rgba(46,26,33,0.12)]"
            >
              <button
                type="button"
                role="menuitem"
                className="flex h-[34px] w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-[#241d20] transition-colors hover:bg-[#faf7f8]"
                onClick={() => {
                  setMenuOpen(false)
                  setOpenId('new')
                }}
              >
                <Icon name="items" size={14} className="text-[#8c0f30]" />
                新建卡片
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex h-[34px] w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-[#241d20] transition-colors hover:bg-[#faf7f8]"
                onClick={() => void addGroup()}
              >
                <Icon name="folder" size={14} className="text-[#8c0f30]" />
                新建分组
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        ref={tabsRef}
        className="sticky top-0 z-10 border-b border-[#e7dfe2] bg-white/95 backdrop-blur lg:hidden"
      >
        <div className="no-scrollbar flex gap-0.5 overflow-x-auto px-2.5">
          {[
            ...groups.map((g) => ({
              key: g.id as GroupFilter,
              label: g.name,
              count: counts.byGroup.get(g.id) ?? 0,
            })),
            { key: 'none' as GroupFilter, label: '未分组', count: counts.none },
          ].map((tab) => {
            const active = groupFilter === tab.key
            return (
              <button
                key={String(tab.key)}
                type="button"
                data-tab-active={active ? 'true' : undefined}
                aria-current={active ? 'true' : undefined}
                onClick={() => selectGroup(tab.key)}
                className={cx(
                  'flex flex-none items-center gap-1 border-b-2 border-transparent px-2 pt-[10px] pb-[9px] text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150',
                  active
                    ? 'border-[#8c0f30] text-[#8c0f30]'
                    : 'text-[#5f5458] hover:text-[#241d20]',
                )}
              >
                {tab.label}
                <span
                  className={cx(
                    'text-[10px] font-bold',
                    active ? 'text-[#8c0f30]' : 'text-[#9a8d91]',
                  )}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid items-start gap-4 px-4 pb-4 lg:grid-cols-[264px_minmax(0,1fr)] lg:px-0 lg:pb-0">
        <aside className="hidden rounded-2xl border border-[#e7dfe2] bg-white p-2.5 shadow-[0_2px_10px_rgba(46,26,33,0.045)] lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
          <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
            <h2 className="m-0 text-[12px] font-bold tracking-[0.06em] text-[#5f5458]">分组</h2>
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f4edef] px-1.5 text-[10px] font-bold text-[#9a8d91]">
              {groups.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-0.5">
            {groups.map((g) => {
              const active = groupFilter === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  className={cx(GROUP_NAV, active && GROUP_NAV_ACTIVE)}
                  onClick={() => selectGroup(g.id)}
                >
                  {active && (
                    <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r bg-[#8c0f30]" />
                  )}
                  <span className={cx(GROUP_ICON, active && GROUP_ICON_ACTIVE)}>
                    {g.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        'block truncate text-[12.5px] font-semibold',
                        active ? 'text-[#8c0f30]' : 'text-[#241d20]',
                      )}
                    >
                      {g.name}
                    </span>
                    <span className="mt-px block truncate text-[10.5px] text-[#9a8d91]">
                      {counts.byGroup.get(g.id) || 0} 张 · {counts.enabledByGroup.get(g.id) || 0} 启用
                    </span>
                  </span>
                  <span className={cx(GROUP_COUNT, active && GROUP_COUNT_ACTIVE)}>
                    {counts.byGroup.get(g.id) || 0}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mx-1 my-1.5 h-px bg-[#f0e8ea]" />

          <button
            type="button"
            aria-current={groupFilter === 'none' ? 'true' : undefined}
            className={cx(GROUP_NAV, groupFilter === 'none' && GROUP_NAV_ACTIVE)}
            onClick={() => selectGroup('none')}
          >
            {groupFilter === 'none' && (
              <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r bg-[#8c0f30]" />
            )}
            <span className={cx(GROUP_ICON, groupFilter === 'none' && GROUP_ICON_ACTIVE)}>
              <Icon name="folder" size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cx(
                  'block truncate text-[12.5px] font-semibold',
                  groupFilter === 'none' ? 'text-[#8c0f30]' : 'text-[#241d20]',
                )}
              >
                未分组
              </span>
            </span>
            <span className={cx(GROUP_COUNT, groupFilter === 'none' && GROUP_COUNT_ACTIVE)}>
              {counts.none}
            </span>
          </button>
        </aside>

        <section className="relative flex min-w-0 flex-col gap-3">
          <BusyLayer show={busy === 'group'} label="更新中…" />

          <div className="px-0 pt-3 pb-1 lg:rounded-2xl lg:border lg:border-[#e7dfe2] lg:bg-white lg:px-5 lg:py-[18px] lg:shadow-[0_2px_10px_rgba(46,26,33,0.045)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-4 sm:gap-y-3">
              <div className="flex min-w-0 items-center gap-2 sm:block sm:flex-1">
                <h2 className="m-0 min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.01em] text-[#241d20] sm:flex-none sm:text-lg">
                  {title}
                </h2>
                <div className="flex flex-none items-center gap-1.5 sm:hidden">{groupBadges}</div>
                <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 sm:flex">
                  {groupBadges}
                </div>
              </div>

              {!isVirtual && activeGroup && (
                <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:ml-auto sm:w-auto">
                  <button
                    type="button"
                    className={ICON_BTN}
                    title="上移分组"
                    disabled={groupIndex <= 0}
                    onClick={() => void moveGroup(-1)}
                  >
                    <Icon name="up" size={14} />
                  </button>
                  <button
                    type="button"
                    className={ICON_BTN}
                    title="下移分组"
                    disabled={groupIndex >= groups.length - 1}
                    onClick={() => void moveGroup(1)}
                  >
                    <Icon name="down" size={14} />
                  </button>
                  <button
                    type="button"
                    className={cx(
                      ICON_BTN,
                      groupAllHidden
                        ? 'hover:border-[#bfe0c9] hover:bg-[#f2fbf5] hover:text-[#15803d]'
                        : 'hover:border-[#e8c46a] hover:bg-[#fffbeb] hover:text-[#b45309]',
                    )}
                    title={
                      groupAllHidden
                        ? `启用整组卡片（${groupItems.length} 张）`
                        : `禁用整组卡片（${groupItems.length} 张）`
                    }
                    disabled={!groupItems.length}
                    onClick={() => void toggleGroupHidden()}
                  >
                    <Icon name={groupAllHidden ? 'enable' : 'disable'} size={14} />
                  </button>
                  {probeEnabled && (
                    <>
                      <button
                        type="button"
                        className={cx(PROBE_BTN, probeOn ? PROBE_ON : PROBE_OFF, 'sm:hidden')}
                        aria-pressed={probeOn}
                        title={probeOn ? '关闭分组状态探测' : '开启分组状态探测'}
                        onClick={() => void changeProbe(!probeOn)}
                      >
                        <Icon name="probe" size={12} />
                        {probeOn ? '探测开' : '探测关'}
                      </button>
                      <button
                        type="button"
                        className={cx(PROBE_ICON_BTN, 'hidden sm:inline-flex', probeOn ? PROBE_ICON_ON : PROBE_ICON_OFF)}
                        aria-pressed={probeOn}
                        title={probeOn ? '关闭分组状态探测' : '开启分组状态探测'}
                        onClick={() => void changeProbe(!probeOn)}
                      >
                        <Icon name="probe" size={14} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={ICON_BTN}
                    title="重命名分组"
                    onClick={(e) => void renameGroup(e.currentTarget)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    className={cx(
                      ICON_BTN,
                      'hover:border-[#e9b4b4] hover:bg-[#fdf0f0] hover:text-[#b91c1c]',
                    )}
                    title="删除分组"
                    onClick={(e) => void removeGroup(e.currentTarget)}
                  >
                    <Icon name="del" size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-0.5">
            <div className="relative min-w-[180px] flex-1">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[#a99ca0]"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索卡片…"
                aria-label="搜索卡片"
                className="h-8 w-full rounded-[10px] border border-[#ddd3d7] bg-white pr-3 pl-8 text-[12.5px] text-[#241d20] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#a99ca0] focus:border-[#8c0f30] focus:shadow-[0_0_0_3px_rgba(140,15,48,0.12)]"
              />
            </div>

            <div
              className="inline-flex items-center gap-0.5 rounded-[10px] border border-[#ddd3d7] bg-[#f7f2f4] p-[3px]"
              role="group"
              aria-label="启用状态筛选"
            >
              {(
                [
                  ['all', '全部'],
                  ['on', '已启用'],
                  ['off', '已禁用'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cx(SEG_BTN, status === value ? SEG_ON : SEG_OFF)}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {!docker && (
              <span className={cx(BADGE_BAD, 'px-2.5 py-0.5 text-[10px]')}>Docker 未启用</span>
            )}
          </div>

          {openId === 'new' && (
            <div className={cx(PANEL, 'mb-0')}>
              <h3 className={PANEL_TITLE}>新增卡片</h3>
              <ItemEditor
                key="new"
                item={null}
                defaultGroupId={newGroupId}
                groups={groups}
                knownGroups={knownGroups}
                onCancel={() => setOpenId(null)}
                onSaved={async () => {
                  setOpenId(null)
                  await onChanged()
                }}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {list.map((it) => {
              const expanded = openId === it.id
              const grp = items.filter((x) => x.group_id === it.group_id)
              const pos = grp.findIndex((x) => x.id === it.id)
              const probeUsable = groupProbeOn(it.group_id)
              return (
                <article
                  key={it.id}
                  className={cx(
                    'relative overflow-hidden rounded-[14px] border bg-white transition-[border-color,box-shadow] duration-150',
                    expanded
                      ? 'border-[#c98fa2] shadow-[0_3px_16px_rgba(140,15,48,0.08)]'
                      : 'border-[#e7dfe2] hover:border-[#d7cacf] hover:shadow-[0_3px_14px_rgba(46,26,33,0.06)]',
                  )}
                >
                  <BusyLayer show={busy === `item-${it.id}`} label="处理中…" />

                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? null : it.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenId(expanded ? null : it.id)
                      }
                    }}
                    className={cx(
                      'flex cursor-pointer items-center gap-2.5 px-2.5 py-2 outline-none transition-colors duration-150 hover:bg-[#faf7f8] focus-visible:bg-[#faf7f8] sm:px-3 sm:py-2.5',
                      it.hidden && 'opacity-55',
                    )}
                  >
                    <AdminIconWell item={it} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="overflow-hidden text-[13px] font-semibold text-ellipsis whitespace-nowrap">
                          {it.name}
                        </span>
                        <span className={cx(it.hidden ? STATUS_OFF : STATUS_OK, 'hidden sm:inline-flex')}>
                          <span className={STATUS_DOT} />
                          {it.hidden ? '已禁用' : '已启用'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 overflow-hidden text-[10.5px] text-[#9a8d91]">
                        <span
                          className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono"
                          title={it.url || ''}
                        >
                          {it.url || '—'}
                        </span>
                      </div>
                    </div>

                    <div
                      className="hidden flex-none items-center gap-1 sm:flex"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className={ICON_BTN}
                        title="上移"
                        disabled={pos === 0}
                        onClick={() => void moveItem(it, -1)}
                      >
                        <Icon name="up" size={14} />
                      </button>
                      <button
                        type="button"
                        className={ICON_BTN}
                        title="下移"
                        disabled={pos === grp.length - 1}
                        onClick={() => void moveItem(it, 1)}
                      >
                        <Icon name="down" size={14} />
                      </button>
                      <button
                        type="button"
                        className={cx(PROBE_ICON_BTN, it.probe ? PROBE_ICON_ON : PROBE_ICON_OFF)}
                        aria-pressed={it.probe}
                        title={
                          probeUsable
                            ? it.probe
                              ? '关闭状态探测'
                              : '开启状态探测'
                            : '所属分组已关闭探测，需先开启分组探测'
                        }
                        disabled={!probeUsable}
                        onClick={() => void toggleProbe(it)}
                      >
                        <Icon name="probe" size={14} />
                      </button>
                      <button
                        type="button"
                        className={cx(
                          ICON_BTN,
                          it.hidden
                            ? 'hover:border-[#c9bcc1]'
                            : 'hover:border-[#e8c46a] hover:bg-[#fffbeb] hover:text-[#b45309]',
                        )}
                        title={it.hidden ? '启用此卡片' : '禁用此卡片'}
                        onClick={() => void toggle(it)}
                      >
                        <Icon name={it.hidden ? 'enable' : 'disable'} size={14} />
                      </button>
                      <button
                        type="button"
                        className={cx(
                          ICON_BTN,
                          'hover:border-[#e9b4b4] hover:bg-[#fdf0f0] hover:text-[#b91c1c]',
                        )}
                        title="删除"
                        onClick={(e) => void remove(it, e.currentTarget)}
                      >
                        <Icon name="del" size={14} />
                      </button>
                    </div>

                    <span className="inline-flex h-7 w-7 flex-none items-center justify-center text-[#a99ca0]">
                      <Icon
                        name="chevron"
                        size={15}
                        className={cx('transition-transform duration-200', expanded && 'rotate-180')}
                      />
                    </span>
                  </div>

                  {expanded && (
                    <div className="border-t border-[#f0e8ea] bg-[#fdfbfb] px-3 py-3 sm:px-4 sm:py-4">
                      <div className="mb-3 flex flex-wrap items-center gap-1.5 sm:hidden">
                        <div className="flex w-full items-center gap-1.5">
                          <button
                            type="button"
                            className={cx(GROW_BTN, GROW_PLAIN)}
                            disabled={pos === 0}
                            onClick={() => void moveItem(it, -1)}
                          >
                            <Icon name="up" size={12} />
                            上移
                          </button>
                          <button
                            type="button"
                            className={cx(GROW_BTN, GROW_PLAIN)}
                            disabled={pos === grp.length - 1}
                            onClick={() => void moveItem(it, 1)}
                          >
                            <Icon name="down" size={12} />
                            下移
                          </button>
                          <button
                            type="button"
                            className={cx(GROW_BTN, it.probe ? PROBE_ON : PROBE_OFF)}
                            aria-pressed={it.probe}
                            title={
                              probeUsable
                                ? it.probe
                                  ? '关闭状态探测'
                                  : '开启状态探测'
                                : '所属分组已关闭探测，需先开启分组探测'
                            }
                            disabled={!probeUsable}
                            onClick={() => void toggleProbe(it)}
                          >
                            <Icon name="probe" size={12} />
                            {it.probe ? '探测开' : '探测关'}
                          </button>
                          <button
                            type="button"
                            className={cx(GROW_BTN, GROW_PLAIN)}
                            onClick={() => void toggle(it)}
                          >
                            <Icon name={it.hidden ? 'enable' : 'disable'} size={12} />
                            {it.hidden ? '启用' : '禁用'}
                          </button>
                          <button
                            type="button"
                            className={cx(
                              GROW_BTN,
                              'border-[#ddd3d7] bg-white text-[#b91c1c]/80 hover:border-[#e9b4b4] hover:bg-[#fdf0f0] hover:text-[#b91c1c]',
                            )}
                            onClick={(e) => void remove(it, e.currentTarget)}
                          >
                            <Icon name="del" size={12} />
                            删除
                          </button>
                        </div>
                      </div>

                      <ItemEditor
                        key={it.id}
                        item={it}
                        groups={groups}
                        knownGroups={knownGroups}
                        onCancel={() => setOpenId(null)}
                        onSaved={async () => {
                          setOpenId(null)
                          await onChanged()
                        }}
                      />
                    </div>
                  )}
                </article>
              )
            })}

            {list.length === 0 && openId !== 'new' && (
              <div className={cx(PANEL, 'mb-0 py-10 text-center text-sm text-[#7a6c71]')}>
                {keyword || status !== 'all' ? '没有匹配的卡片' : '该分组下没有卡片'}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
