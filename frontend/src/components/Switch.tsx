import { cx } from './ui'

export function Switch({
  checked,
  onChange,
  title,
  disabled,
  light,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title?: string
  disabled?: boolean
  /** 管理后台亮色主题 */
  light?: boolean
}) {
  return (
    <label
      className={cx('relative inline-flex h-6 w-[42px] items-center', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
      title={title}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cx(
          'absolute inset-0 rounded-full transition-colors duration-150 peer-checked:bg-ok peer-checked:shadow-none',
          light
            ? 'bg-[#d6c9ce] shadow-[inset_0_0_0_1px_rgba(36,29,32,0.06)]'
            : 'bg-white/[0.18] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]',
        )}
      />
      <span
        className={cx(
          'absolute left-[3px] h-[18px] w-[18px] rounded-full bg-white transition-transform duration-150 peer-checked:translate-x-[18px]',
          light ? 'shadow-[0_1px_3px_rgba(36,29,32,0.3)]' : 'shadow-[0_1px_4px_rgba(0,0,0,0.4)]',
        )}
      />
    </label>
  )
}
