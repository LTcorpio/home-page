// 管理后台亮色主题的样式常量（首页仍使用深色 ../components/ui）。
// 配色取首页壁纸的深绯红作为唯一强调色，中性色统一偏暖，避免大面积纯白显得发灰、发白。

export const PANEL =
  'mb-4 rounded-2xl border border-[#e7dfe2] bg-white px-4 py-4 shadow-[0_2px_10px_rgba(46,26,33,0.045)] sm:px-5 sm:py-[18px]'

export const PANEL_TITLE = 'mb-3.5 text-sm font-bold text-[#241d20]'

export const FIELD = 'mb-3 flex flex-col gap-[5px]'

export const LABEL = 'text-xs text-[#5f5458]'

export const SUB = 'text-xs leading-[1.55] text-[#9a8d91]'

export const BADGE = 'inline-block rounded-full px-2.5 py-0.5 text-[11px] bg-[#f4edef] text-[#5f5458]'

export const TAG =
  'mr-1.5 inline-block rounded-md bg-[#f4edef] px-[7px] py-px align-middle text-[10px] text-[#7a6c71]'

export const INPUT =
  'rounded-[10px] border border-[#ddd3d7] bg-white px-[11px] py-2 text-[13px] text-[#241d20] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#a99ca0] focus:border-[#8c0f30] focus:shadow-[0_0_0_3px_rgba(140,15,48,0.14)]'

export const BTN =
  'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[10px] border border-[#ddd3d7] bg-white px-[13px] py-[7px] text-[13px] text-[#241d20] transition-colors duration-150 hover:border-[#c9bcc1] hover:bg-[#f7f2f4] disabled:cursor-not-allowed disabled:opacity-40'

export const BTN_PRIMARY =
  'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[10px] border border-transparent bg-[#8c0f30] px-[13px] py-[7px] text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(140,15,48,0.28)] transition-colors duration-150 hover:border-transparent hover:bg-[#731028] disabled:cursor-not-allowed disabled:opacity-40'

export const BTN_MINI_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[#ddd3d7] bg-white px-2.5 py-1 text-xs text-[#241d20] transition-colors duration-150 hover:border-[#c9bcc1] hover:bg-[#f7f2f4] disabled:cursor-not-allowed disabled:opacity-40'

export const BTN_MINI_DANGER = 'hover:border-[#e9b4b4] hover:bg-[#fdf0f0] hover:text-[#b91c1c]'

export const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#ddd3d7] bg-white p-0 text-[#4a3f43] transition-colors duration-150 hover:border-[#c9bcc1] hover:bg-[#f7f2f4] disabled:cursor-not-allowed disabled:opacity-40'

// 图标底槽：单色偏亮的图标用深槽，彩色 / 深色图标用浅槽。
// 深槽比初版提亮一档，避免 36px 小方块在列表里过重。
export const ICON_WELL_DARK =
  'bg-gradient-to-br from-[#6b5861] to-[#52424b] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'

export const ICON_WELL_LIGHT = 'bg-[#f4edef] shadow-[inset_0_0_0_1px_#e7dfe2]'
