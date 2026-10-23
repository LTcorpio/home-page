import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { BoardData, Group, Item } from '../../lib/types'
import { Icon, type IconName } from '../../components/Icons'
import { Spinner } from '../../components/Spinner'
import { cx } from '../../components/ui'
import { BADGE, BTN, BTN_PRIMARY } from './adminUi'
import ItemsPanel from './ItemsPanel'
import SettingsPanel from './SettingsPanel'

type Tab = 'cards' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'cards', label: '卡片', icon: 'items' },
  { id: 'settings', label: '站点设置', icon: 'sliders' },
]

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const NAV_BTN =
  'flex items-center gap-2 rounded-[10px] border-none px-3 py-2 text-left text-[13px] text-[#5f5458] transition-colors duration-150 hover:bg-[#f4eef0] hover:text-[#241d20]'

const NAV_ACTIVE = 'bg-[#f9e9ee] font-semibold text-[#8c0f30]'

export default function AdminPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [features, setFeatures] = useState({ docker: false, admin: false })
  const [tab, setTab] = useState<Tab>('cards')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const [board, list] = await Promise.all([
      api<BoardData>('/api/board'),
      api<Item[]>('/api/items'),
    ])
    setSettings(board.settings || {})
    setGroups(
      (board.groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        sort: g.sort,
        probe: g.probe,
      })),
    )
    setItems(list)
    setFeatures(board.features || { docker: false, admin: false })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [board, list] = await Promise.all([
          api<BoardData>('/api/board'),
          api<Item[]>('/api/items'),
        ])
        if (cancelled) return
        setSettings(board.settings || {})
        setGroups(
          (board.groups || []).map((g) => ({
            id: g.id,
            name: g.name,
            sort: g.sort,
            probe: g.probe,
          })),
        )
        setItems(list)
        setFeatures(board.features || { docker: false, admin: false })
      } catch (e) {
        if (!cancelled) setError(errText(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const title = settings.site_title || 'Home'
    document.title = `管理 · ${title}`
  }, [settings.site_title])

  const enabled = items.filter((it) => !it.hidden).length
  const countChip = `${groups.length} 个分组 · ${items.length} 张卡片 · ${enabled} 启用`

  const denied = !loading && (error || !features.admin)

  return (
    <div className="admin-light flex h-dvh flex-col bg-white text-[#241d20] lg:bg-[#f2edef]">
      <header className="hidden h-14 flex-none items-center gap-3 border-b border-[#e7dfe2] bg-white px-4 sm:px-6 lg:flex">
        <h1 className="m-0 flex-none text-[15px] font-bold text-ink">管理后台</h1>
        {!loading && features.admin && (
          <span className={cx(BADGE, 'max-sm:hidden bg-[#f9e9ee] text-[#8c0f30]')}>
            {countChip}
          </span>
        )}
        <div className="flex-1" />
        <a className={BTN} href="/">
          返回首页
        </a>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-dim">
          <Spinner />
          加载中…
        </div>
      ) : denied ? (
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-5">
          <div className="w-[min(520px,100%)] rounded-2xl border border-[#e7dfe2] bg-white px-7 py-8 text-center">
            <h2 className="text-base font-bold text-ink">
              {error ? '加载失败' : '需要管理员权限'}
            </h2>
            <p className="mt-3 text-[13px] leading-[1.7] text-dim">
              {error ||
                `当前账号不属于管理员组（${settings.admin_groups || 'admins'}），无法进入管理后台。请以管理员组账号登录后重试。`}
            </p>
            <div className="mt-5 flex justify-center gap-2.5">
              <a className={BTN} href="/">
                返回首页
              </a>
              {error && (
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  onClick={() => {
                    setLoading(true)
                    setError('')
                    void reload()
                      .catch((e) => setError(errText(e)))
                      .finally(() => setLoading(false))
                  }}
                >
                  重试
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[196px] flex-none flex-col gap-1 border-r border-[#e7dfe2] bg-[#faf7f8] p-2.5 md:flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={cx(NAV_BTN, tab === t.id && NAV_ACTIVE)}
                onClick={() => setTab(t.id)}
              >
                <span className="w-4 text-center opacity-85">
                  <Icon name={t.icon} size={15} />
                </span>
                {t.label}
              </button>
            ))}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <main className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[1280px] lg:p-6">
                <div className={tab === 'cards' ? '' : 'hidden'}>
                  <ItemsPanel
                    groups={groups}
                    items={items}
                    docker={features.docker}
                    knownGroups={settings.known_groups || ''}
                    probeEnabled={settings.probe_enabled === '1'}
                    onChanged={reload}
                  />
                </div>
                <div className={cx('px-4 pb-4 lg:px-0 lg:pb-0', tab === 'settings' ? '' : 'hidden')}>
                  <SettingsPanel settings={settings} onChanged={reload} />
                </div>
              </div>
            </main>

            <nav className="flex flex-none gap-1 border-t border-[#e7dfe2] bg-white px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] md:hidden">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={cx(
                    'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold transition-colors duration-150',
                    tab === t.id ? 'bg-[#f9e9ee] text-[#8c0f30]' : 'text-[#5f5458]',
                  )}
                  onClick={() => setTab(t.id)}
                >
                  <Icon name={t.icon} size={18} />
                  {t.label}
                </button>
              ))}
              <a
                href="/"
                className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold text-[#5f5458] transition-colors duration-150"
              >
                <Icon name="home" size={18} />
                返回首页
              </a>
            </nav>
          </div>
        </div>
      )}
    </div>
  )
}
