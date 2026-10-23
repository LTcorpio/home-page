import { useEffect, useRef, useState } from 'react'
import { put } from '../../lib/api'
import type { IconUploadResponse } from '../../lib/types'
import { useToast } from '../../components/Toast'
import { BusyLayer } from '../../components/Spinner'
import { cx } from '../../components/ui'
import {
  BTN,
  BTN_PRIMARY,
  FIELD,
  INPUT,
  LABEL,
  PANEL,
  PANEL_TITLE,
} from './adminUi'

interface Props {
  settings: Record<string, string>
  onChanged: () => Promise<void>
}

interface Form {
  title: string
  bg: string
  mask: string
  blur: string
  maxWidth: string
  probe: boolean
  docker: boolean
  showDisabled: boolean
  showDisabledGuest: boolean
  adminGroups: string
  knownGroups: string
  authPortal: string
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function toForm(s: Record<string, string>): Form {
  return {
    title: s.site_title || '',
    bg: s.background_image || '',
    mask: s.background_mask ?? '0',
    blur: s.background_blur ?? '2',
    maxWidth: s.max_width || '1200',
    probe: s.probe_enabled === '1',
    docker: s.docker_enabled !== '0',
    showDisabled: s.show_disabled === '1',
    showDisabledGuest: s.show_disabled_guest === '1',
    adminGroups: s.admin_groups || 'admins',
    knownGroups: s.known_groups || '',
    authPortal: s.auth_portal || '',
  }
}

const ROW_FIELD = 'mb-3 flex flex-row items-center gap-2.5'

interface SliderProps {
  label: string
  value: string
  min: number
  max: number
  step: number
  onChange: (v: string) => void
}

function SliderField({ label, value, min, max, step, onChange }: SliderProps) {
  const num = Number(value)
  const safe = Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : min
  return (
    <div className={FIELD}>
      <label className={LABEL}>{label}</label>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 cursor-pointer accent-[#8c0f30]"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const v = Number(e.target.value)
            if (!Number.isFinite(v)) {
              onChange(String(min))
              return
            }
            onChange(String(Math.min(max, Math.max(min, v))))
          }}
          className={cx(INPUT, 'w-[76px] flex-none text-center')}
        />
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 text-left text-[13px] transition-colors duration-150',
        checked
          ? 'border-[#8c0f30]/25 bg-[#f9e9ee] text-[#241d20]'
          : 'border-[#ddd3d7] bg-white text-[#5f5458] hover:border-[#c9bcc1] hover:bg-[#faf7f8]',
      )}
    >
      <span className="font-medium">{label}</span>
      <span
        className={cx(
          'flex-none text-[11px] font-semibold',
          checked ? 'text-[#8c0f30]' : 'text-[#9a8d91]',
        )}
      >
        {checked ? '已开启' : '已关闭'}
      </span>
    </button>
  )
}

export default function SettingsPanel({ settings, onChanged }: Props) {
  const { toast } = useToast()
  const [form, setForm] = useState<Form>(() => toForm(settings))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => setForm(toForm(settings)), [settings])

  const uploadBg = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    setUploading(true)
    try {
      const res = await fetch('/api/icons/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('上传失败')
      const data = (await res.json()) as IconUploadResponse
      setForm((f) => ({ ...f, bg: data.icon_url }))
      toast('壁纸已上传，保存设置后生效')
    } catch (e) {
      toast('壁纸上传失败: ' + errText(e))
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await put('/api/settings', {
        site_title: form.title.trim() || 'Home',
        background_image: form.bg.trim(),
        background_mask: form.mask,
        background_blur: form.blur,
        max_width: form.maxWidth,
        probe_enabled: form.probe ? '1' : '0',
        docker_enabled: form.docker ? '1' : '0',
        show_disabled: form.showDisabled ? '1' : '0',
        show_disabled_guest: form.showDisabledGuest ? '1' : '0',
        admin_groups: form.adminGroups.trim() || 'admins',
        known_groups: form.knownGroups.trim(),
        auth_portal: form.authPortal.trim(),
      })
      toast('设置已保存')
      await onChanged()
    } catch (e) {
      toast('保存失败: ' + errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <BusyLayer show={saving || uploading} label={saving ? '保存中…' : '上传中…'} />

      <div className="-mx-4 mb-3 flex items-end gap-3 border-b border-[#ecdde2] bg-[#faf3f5] px-4 pb-2.5 pt-3 lg:mx-0 lg:mb-4 lg:items-center lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-0">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-none text-[#9a8d91] lg:hidden">管理后台</div>
          <h1 className="m-0 mt-1.5 text-[17px] font-bold tracking-[-0.01em] text-[#241d20] lg:mt-0 lg:text-xl">
            站点设置
          </h1>
        </div>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={saving || uploading}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>

      <div className={PANEL}>
        <h3 className={PANEL_TITLE}>外观</h3>

        <div className={ROW_FIELD}>
          <label className="w-[110px] flex-none text-xs text-dim">站点标题</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="浏览器标签页标题"
            className={cx(INPUT, 'min-w-0 flex-1')}
          />
        </div>

        <div className={ROW_FIELD}>
          <label className="w-[110px] flex-none text-xs text-dim">壁纸</label>
          <input
            type="text"
            value={form.bg}
            onChange={(e) => setForm({ ...form, bg: e.target.value })}
            placeholder="/icons/xxx.jpg，留空用深色渐变"
            className={cx(INPUT, 'min-w-0 flex-1')}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadBg(f)
              e.target.value = ''
            }}
          />
          <button type="button" className={BTN} onClick={() => fileRef.current?.click()}>
            上传
          </button>
        </div>

        <div className="mt-1 grid grid-cols-3 gap-x-[18px] max-[860px]:grid-cols-1">
          <SliderField
            label="遮罩透明度"
            value={form.mask}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setForm({ ...form, mask: v })}
          />
          <SliderField
            label="壁纸模糊（px）"
            value={form.blur}
            min={0}
            max={20}
            step={1}
            onChange={(v) => setForm({ ...form, blur: v })}
          />
          <SliderField
            label="内容最大宽度（px）"
            value={form.maxWidth}
            min={800}
            max={2560}
            step={10}
            onChange={(v) => setForm({ ...form, maxWidth: v })}
          />
        </div>
      </div>

      <div className={PANEL}>
        <h3 className={PANEL_TITLE}>检测与控制</h3>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          <ToggleRow
            label="可达性检测"
            checked={form.probe}
            onChange={(v) => setForm({ ...form, probe: v })}
          />
          <ToggleRow
            label="Docker 启停控制"
            checked={form.docker}
            onChange={(v) => setForm({ ...form, docker: v })}
          />
          <ToggleRow
            label="管理员首页显示禁用卡片"
            checked={form.showDisabled}
            onChange={(v) => setForm({ ...form, showDisabled: v })}
          />
          <ToggleRow
            label="访客首页显示禁用卡片"
            checked={form.showDisabledGuest}
            onChange={(v) => setForm({ ...form, showDisabledGuest: v })}
          />
        </div>
      </div>

      <div className={PANEL}>
        <h3 className={PANEL_TITLE}>权限（SSO）</h3>
        <div className="grid grid-cols-1">
          <div className={FIELD}>
            <label className={LABEL}>管理员组</label>
            <input
              type="text"
              value={form.adminGroups}
              onChange={(e) => setForm({ ...form, adminGroups: e.target.value })}
              placeholder="admins"
              className={INPUT}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>候选用户组</label>
            <input
              type="text"
              value={form.knownGroups}
              onChange={(e) => setForm({ ...form, knownGroups: e.target.value })}
              placeholder="admins,family"
              className={INPUT}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>认证中心地址</label>
            <input
              type="text"
              value={form.authPortal}
              onChange={(e) => setForm({ ...form, authPortal: e.target.value })}
              placeholder="https://authelia.home.lan/"
              className={INPUT}
            />
          </div>
        </div>
      </div>

    </div>
  )
}
