// 全站复用的样式常量，保持旧版按钮 / 输入框 / 卡片面板的视觉尺寸。

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export const INPUT =
  'rounded-[10px] border border-white/[0.14] bg-black/[0.22] px-[11px] py-2 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-white/50 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.08)]'

export const BTN =
  'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[10px] border border-white/[0.16] bg-white/[0.06] px-[13px] py-[7px] text-[13px] text-ink transition-colors duration-150 hover:border-white/[0.32] hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40'

export const BTN_PRIMARY =
  'border-transparent bg-white font-semibold text-[#1b1c21] hover:bg-[#f0f1f4]'

export const BTN_DANGER =
  'hover:border-bad/60 hover:bg-bad/[0.08] hover:text-bad'

export const BTN_MINI = 'inline-flex items-center gap-1 rounded-lg border text-xs'

export const BTN_MINI_PRIMARY = 'inline-flex items-center gap-1 rounded-lg border font-semibold'

/* 管理后台复用的面板 / 标签 / 小按钮：尺寸对齐旧版 app.css */

export const PANEL =
  'mb-4 rounded-2xl border border-white/[0.05] bg-card px-5 py-[18px] backdrop-blur-[8px]'

export const PANEL_TITLE = 'mb-3.5 text-sm font-bold text-ink'

export const FIELD = 'mb-3 flex flex-col gap-[5px]'

export const LABEL = 'text-xs text-dim'

export const SUB = 'text-xs leading-[1.55] text-faint'

export const BADGE = 'inline-block rounded-full px-2.5 py-0.5 text-[11px] bg-white/[0.09] text-dim'

export const TAG =
  'mr-1.5 inline-block rounded-md bg-white/[0.08] px-[7px] py-px align-middle text-[10px] text-faint'

export const BTN_MINI_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-white/[0.16] bg-white/[0.06] px-2.5 py-1 text-xs text-ink transition-colors duration-150 hover:border-white/[0.32] hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40'

export const BTN_MINI_DANGER = 'hover:border-bad/60 hover:bg-bad/[0.08] hover:text-bad'

export const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.16] bg-white/[0.06] p-0 text-ink transition-colors duration-150 hover:border-white/[0.32] hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40'
