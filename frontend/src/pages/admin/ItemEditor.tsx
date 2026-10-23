import { useRef, useState } from 'react'
import { post, put } from '../../lib/api'
import type { IconUploadResponse, Item, Group } from '../../lib/types'
import { useToast } from '../../components/Toast'
import { BusyLayer } from '../../components/Spinner'
import { cx } from '../../components/ui'
import {
  BTN,
  BTN_MINI_BASE,
  BTN_MINI_DANGER,
  BTN_PRIMARY,
  FIELD,
  INPUT,
  LABEL,
  SUB,
} from './adminUi'
import { AdminIconWell } from './AdminIconWell'

interface Props {
  item: Item | null
  /** 新增卡片时默认归入的分组（编辑时沿用卡片原分组） */
  defaultGroupId?: number
  groups: Group[]
  knownGroups: string
  onCancel: () => void
  onSaved: () => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const SECTION = 'mt-5 border-t border-[#f0e8ea] pt-4 first:mt-0 first:border-t-0 first:pt-0'
const SECTION_TITLE = 'mb-2.5 text-[11px] font-bold tracking-[0.1em] text-[#8c0f30]'
const GRID = 'grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3'

const ICON_TYPES: { value: Item['icon_type']; label: string }[] = [
  { value: 'auto', label: '自动抓取' },
  { value: 'upload', label: '上传图片' },
  { value: 'text', label: '文字图标' },
]

/** 卡片编辑器：内联在折叠面板中，新增与编辑共用 */
export default function ItemEditor({
  item,
  defaultGroupId,
  groups,
  knownGroups,
  onCancel,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [groupId, setGroupId] = useState(item ? item.group_id : (defaultGroupId ?? 0))
  const [name, setName] = useState(item?.name ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [iconType, setIconType] = useState<Item['icon_type']>(item?.icon_type || 'auto')
  const [iconText, setIconText] = useState(item?.icon_type === 'text' ? item.icon_value : '')
  const [container, setContainer] = useState(item?.container_name ?? '')
  const [lanUrl, setLanUrl] = useState(item?.lan_url ?? '')
  const [acl, setAcl] = useState(item?.acl ?? '')
  const [pendingIcon, setPendingIcon] = useState('')
  const [uploadCleared, setUploadCleared] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 图标区域正在进行的请求文案（空字符串 = 空闲） */
  const [iconBusy, setIconBusy] = useState('')

  // 未选中的图标类型若已有配置，切走后仍保留内容；uploadCleared 防止移除后又被原值复活
  const existingUpload = !uploadCleared && item?.icon_type === 'upload' ? item.icon_value : ''
  const uploadValue = pendingIcon || existingUpload
  const previewValue = iconType === 'upload' ? uploadValue : iconType === 'text' ? iconText : ''
  const aclOptions = knownGroups.split(/[,，\s]+/).filter(Boolean)

  const clearUpload = () => {
    setPendingIcon('')
    setUploadCleared(true)
    toast('已移除上传的图标，保存后生效')
  }

  const uploadIcon = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    setIconBusy('上传中…')
    try {
      const res = await fetch('/api/icons/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          msg = JSON.parse(text).error || text
        } catch {
          // 非 JSON 响应直接用文本
        }
        throw new Error(msg)
      }
      const data = (await res.json()) as IconUploadResponse
      setPendingIcon(data.icon_value)
      setUploadCleared(false)
      setIconType('upload')
      toast('图标已上传，保存后生效')
    } catch (e) {
      toast('上传失败: ' + errText(e))
    } finally {
      setIconBusy('')
    }
  }

  const fetchFavicon = async () => {
    if (!url.trim()) {
      toast('请先填写地址')
      return
    }
    setIconBusy('抓取中…')
    try {
      const data = await post<IconUploadResponse>('/api/icons/fetch', {
        url: url.trim(),
        item_id: item ? item.id : 0,
      })
      setPendingIcon(data.icon_value)
      setUploadCleared(false)
      setIconType('upload')
      toast('favicon 已抓取，保存后生效')
    } catch (e) {
      toast('抓取失败: ' + errText(e))
    } finally {
      setIconBusy('')
    }
  }

  const save = async () => {
    if (!name.trim()) {
      toast('名称不能为空')
      return
    }
    let iconValue = ''
    if (iconType === 'upload') iconValue = uploadValue
    else if (iconType === 'text') iconValue = iconText.trim()

    const payload = {
      name: name.trim(),
      url: url.trim(),
      description: description.trim(),
      group_id: groupId,
      icon_type: iconType,
      icon_value: iconValue,
      container_name: container.trim(),
      lan_url: container.trim() ? lanUrl.trim() : '',
      probe: item ? item.probe : true,
      hidden: item ? item.hidden : false,
      acl: acl.trim(),
      memo: item?.memo ?? '',
      sort: item ? item.sort : 999,
    }

    setSaving(true)
    try {
      if (item) await put(`/api/items/${item.id}`, payload)
      else await post('/api/items', payload)
      toast('已保存')
      await onSaved()
    } catch (e) {
      toast('保存失败: ' + errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <BusyLayer show={saving} label="保存中…" />

      <div className={SECTION}>
        <h4 className={SECTION_TITLE}>基本信息</h4>
        <div className={GRID}>
          <div className={FIELD}>
            <label className={LABEL}>名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>分组</label>
            <select
              value={String(groupId)}
              onChange={(e) => setGroupId(Number(e.target.value))}
              className={cx(INPUT, 'h-[38px] cursor-pointer appearance-none')}
            >
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
              <option value="0">未分组</option>
            </select>
          </div>

          <div className={FIELD}>
            <label className={LABEL}>描述</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={INPUT}
            />
          </div>

          <div className={cx(FIELD, 'xl:col-span-2')}>
            <label className={LABEL}>地址 *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://service.example.com/ 或 http://192.0.2.10:8080"
              className={INPUT}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>绑定容器</label>
            <input
              type="text"
              value={container}
              onChange={(e) => {
                setContainer(e.target.value)
                if (!e.target.value.trim()) setLanUrl('')
              }}
              placeholder="容器名；多个用英文逗号分隔"
              className={INPUT}
            />
          </div>

          <div className={cx(FIELD, 'xl:col-span-2')}>
            <label className={LABEL}>局域网地址（IP:端口）</label>
            <input
              type="text"
              value={lanUrl}
              onChange={(e) => setLanUrl(e.target.value)}
              disabled={!container.trim()}
              placeholder="如 192.0.2.10:8080"
              className={cx(INPUT, 'disabled:cursor-not-allowed disabled:opacity-55')}
            />
            <div className={SUB}>
              经 IP 访问首页时改用此地址，供局域网内成员直连（不经过 SSO）。
            </div>
          </div>
        </div>
      </div>

      <div className={SECTION}>
        <h4 className={SECTION_TITLE}>图标</h4>
        <div
          className="inline-flex w-fit rounded-[10px] border border-[#ddd3d7] bg-[#f7f2f4] p-[3px]"
          role="tablist"
          aria-label="图标类型"
        >
          {ICON_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={iconType === t.value}
              className={cx(
                'rounded-[7px] px-2.5 py-1 text-[11.5px] transition-colors duration-150',
                iconType === t.value
                  ? 'bg-white font-semibold text-[#8c0f30] shadow-[0_1px_2px_rgba(46,26,33,0.1)]'
                  : 'text-[#7a6c71] hover:text-[#241d20]',
              )}
              onClick={() => setIconType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.svg,.ico,.webp,.gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadIcon(f)
            e.target.value = ''
          }}
        />

        <div className="relative mt-2.5 flex flex-wrap items-center gap-3 rounded-[10px] border border-[#f0e8ea] bg-[#fdfbfb] px-3 py-2.5">
          <BusyLayer show={!!iconBusy} label={iconBusy} />
          <AdminIconWell
            size="md"
            item={{ name, url, icon_type: iconType, icon_value: previewValue }}
          />

          <div className="min-w-0 flex-1">
            {iconType === 'auto' && (
              <div className={SUB}>按「地址」自动获取网站 favicon，无需额外配置。</div>
            )}

            {iconType === 'text' && (
              <input
                type="text"
                value={iconText}
                onChange={(e) => setIconText(e.target.value)}
                placeholder="如：状态 / RIDE"
                aria-label="图标文字"
                className={cx(INPUT, 'max-w-[220px]')}
              />
            )}

            {iconType === 'upload' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={BTN_MINI_BASE}
                  onClick={() => fileRef.current?.click()}
                >
                  选择文件
                </button>
                {uploadValue && (
                  <button
                    type="button"
                    className={cx(BTN_MINI_BASE, BTN_MINI_DANGER)}
                    onClick={clearUpload}
                  >
                    移除
                  </button>
                )}
                <span className={SUB}>PNG / JPG / SVG / ICO / WEBP / GIF</span>
              </div>
            )}
          </div>

          <button type="button" className={BTN_MINI_BASE} onClick={() => void fetchFavicon()}>
            抓取 favicon
          </button>
        </div>

        {iconType !== 'upload' && uploadValue && (
          <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-dashed border-[#d8cabd] bg-[#fbf8f6] px-3 py-1.5">
            <AdminIconWell
              size="sm"
              item={{ name, url, icon_type: 'upload', icon_value: uploadValue }}
            />
            <span className="text-xs text-[#7a6c71]">已保留上传的图标（当前未使用）</span>
            <button
              type="button"
              className={cx(BTN_MINI_BASE, BTN_MINI_DANGER)}
              onClick={clearUpload}
            >
              移除
            </button>
          </div>
        )}

        {iconType !== 'text' && iconText.trim() && (
          <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-dashed border-[#d8cabd] bg-[#fbf8f6] px-3 py-1.5">
            <span className="flex h-9 min-w-9 items-center justify-center rounded-[10px] bg-[#f4edef] px-2 font-mono text-xs text-[#4a3f43]">
              {iconText.trim()}
            </span>
            <span className="text-xs text-[#7a6c71]">已保留文字图标（当前未使用）</span>
            <button
              type="button"
              className={cx(BTN_MINI_BASE, BTN_MINI_DANGER)}
              onClick={() => setIconText('')}
            >
              移除
            </button>
          </div>
        )}
      </div>

      <div className={SECTION}>
        <h4 className={SECTION_TITLE}>权限</h4>
        <div className={FIELD}>
          <label className={LABEL}>访问组（SSO 用户组，逗号分隔，留空=所有人可见）</label>
          <input
            type="text"
            value={acl}
            onChange={(e) => setAcl(e.target.value)}
            list="acl-groups"
            placeholder="例如 admins 或 admins,family"
            className={INPUT}
          />
          <datalist id="acl-groups">
            {aclOptions.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <div className={SUB}>
            填写后仅该组成员能看到此卡；管理员始终可见。组名来自 SSO 网关（可在「站点设置 →
            权限」维护候选组）。
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2.5">
        <button type="button" className={BTN} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={saving || !!iconBusy}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
