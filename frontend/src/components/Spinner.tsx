import { cx } from './ui'

/** 旋转加载环：默认 16px，可传 size / className 调整 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={cx(
        'inline-block flex-none animate-spin rounded-full border-2 border-[#8c0f30]/20 border-t-[#8c0f30]',
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}

/** 覆盖在父容器上的加载遮罩（父容器需 relative）。
 *  mask-in 让遮罩延迟浮现，短请求不会闪一下。 */
export function BusyLayer({
  show,
  label,
  className,
}: {
  show: boolean
  label?: string
  className?: string
}) {
  if (!show) return null
  return (
    <span
      aria-busy="true"
      className={cx(
        'mask-in absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-[inherit] bg-white/70 backdrop-blur-[1px]',
        className,
      )}
    >
      <Spinner />
      {label && <span className="text-[11.5px] text-[#7a6c71]">{label}</span>}
    </span>
  )
}
