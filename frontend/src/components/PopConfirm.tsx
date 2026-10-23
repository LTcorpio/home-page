import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { BTN_MINI, BTN_MINI_PRIMARY, INPUT } from './ui'

type Resolve = (value: boolean | string | null) => void

interface ActivePop {
  mode: 'confirm' | 'prompt'
  message: string
  okLabel?: string
  anchor?: HTMLElement | null
  initialValue?: string
  resolve: Resolve
}

interface ConfirmContextValue {
  askConfirm: (message: string, anchor?: HTMLElement | null, okLabel?: string) => Promise<boolean>
  askPrompt: (message: string, value: string, anchor?: HTMLElement | null) => Promise<string | null>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

// 页面内浮窗（替代浏览器原生 confirm / prompt）：定位在触发元素上方，
// 点浮窗外部 / Esc / 滚动即取消；输入框支持 Enter 确认。
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActivePop | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<ActivePop | null>(null)
  activeRef.current = active

  const askConfirm = useCallback(
    (message: string, anchor?: HTMLElement | null, okLabel?: string) =>
      new Promise<boolean>((resolve) => {
        setActive({ mode: 'confirm', message, anchor, okLabel, resolve: resolve as Resolve })
      }),
    [],
  )

  const askPrompt = useCallback(
    (message: string, value: string, anchor?: HTMLElement | null) =>
      new Promise<string | null>((resolve) => {
        setActive({
          mode: 'prompt',
          message,
          anchor,
          initialValue: value,
          resolve: resolve as Resolve,
        })
      }),
    [],
  )

  // 定位：锚点上方空间不足则落到下方，水平居中并夹在视口内
  useLayoutEffect(() => {
    const pop = popRef.current
    if (!active || !pop) return
    const anchor = active.anchor
    if (!anchor) {
      pop.style.left = '50%'
      pop.style.top = '120px'
      pop.style.transform = 'translateX(-50%)'
      return
    }
    const a = anchor.getBoundingClientRect()
    const r = pop.getBoundingClientRect()
    let top = a.top - r.height - 10
    if (top < 8) top = Math.min(a.bottom + 10, window.innerHeight - r.height - 8)
    const left = Math.max(
      8,
      Math.min(a.left + a.width / 2 - r.width / 2, window.innerWidth - r.width - 8),
    )
    pop.style.left = `${left}px`
    pop.style.top = `${Math.max(8, top)}px`
    pop.style.transform = 'none'
    if (active.mode === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    let closed = false
    const finish = (value: boolean | string | null) => {
      if (closed) return
      closed = true
      active.resolve(value)
      setActive(null)
      document.removeEventListener('click', onOutside)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
    const ok = () => {
      if (active.mode === 'prompt') {
        finish(inputRef.current?.value.trim() || null)
      } else {
        finish(true)
      }
    }
    const cancel = () => finish(active.mode === 'prompt' ? null : false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
      else if (e.key === 'Enter' && active.mode === 'prompt') ok()
    }
    const onScroll = () => cancel()
    // 点浮窗以外任意位置即关闭（等同取消）。延后挂载，避免「打开浮窗的那次点击」立刻把它关掉。
    const onOutside = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) cancel()
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    const t = window.setTimeout(() => {
      if (!closed) document.addEventListener('click', onOutside)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('click', onOutside)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [active])

  return (
    <ConfirmContext.Provider value={{ askConfirm, askPrompt }}>
      {children}
      {active && (
        <div
          ref={popRef}
          className="selectable fixed z-[80] w-[260px] max-w-[calc(100vw-16px)] rounded-xl border border-white/10 bg-[rgba(30,31,38,0.96)] px-3.5 pt-3 pb-2.5 shadow-[0_14px_40px_rgba(0,0,0,0.5)] backdrop-blur-md"
        >
          <div className="text-[13px] leading-normal break-words text-ink">{active.message}</div>
          {active.mode === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              defaultValue={active.initialValue}
              className={`${INPUT} mt-2.5 w-full`}
            />
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className={`${BTN_MINI} px-2.5 py-1`}
              onClick={() => {
                active.resolve(active.mode === 'prompt' ? null : false)
                setActive(null)
              }}
            >
              取消
            </button>
            <button
              type="button"
              className={`${BTN_MINI_PRIMARY} px-2.5 py-1`}
              onClick={() => {
                if (active.mode === 'prompt') {
                  active.resolve(inputRef.current?.value.trim() || null)
                } else {
                  active.resolve(true)
                }
                setActive(null)
              }}
            >
              {active.okLabel || (active.mode === 'prompt' ? '确定' : '确认')}
            </button>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm 必须在 ConfirmProvider 内使用')
  return ctx
}
