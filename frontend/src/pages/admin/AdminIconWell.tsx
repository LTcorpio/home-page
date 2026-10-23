import { useEffect, useState } from 'react'
import { ItemIcon, itemIconSrc } from '../../components/ItemIcon'
import { cx } from '../../components/ui'
import type { Item } from '../../lib/types'
import { ICON_WELL_DARK, ICON_WELL_LIGHT } from './adminUi'

type Tone = 'dark' | 'light'

const toneCache = new Map<string, Promise<Tone>>()

// 读取图标像素，白色线稿类图标用深槽，彩色 / 深色图标用浅槽
function analyzeTone(src: string): Promise<Tone> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 32
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve('dark')
        ctx.clearRect(0, 0, 32, 32)
        ctx.drawImage(img, 0, 0, 32, 32)
        const data = ctx.getImageData(0, 0, 32, 32).data
        let lum = 0
        let sat = 0
        let weight = 0
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255
          if (a < 0.15) continue
          const r = data[i] / 255
          const g = data[i + 1] / 255
          const b = data[i + 2] / 255
          lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * a
          sat += (Math.max(r, g, b) - Math.min(r, g, b)) * a
          weight += a
        }
        if (!weight) return resolve('dark')
        resolve(sat / weight < 0.15 && lum / weight > 0.55 ? 'dark' : 'light')
      } catch {
        // 画布读不到像素时按最常见的白色图标处理
        resolve('dark')
      }
    }
    img.onerror = () => resolve('dark')
    img.src = src
  })
}

function toneOf(src: string) {
  let promise = toneCache.get(src)
  if (!promise) {
    promise = analyzeTone(src)
    toneCache.set(src, promise)
  }
  return promise
}

export function AdminIconWell({
  item,
  size = 'sm',
}: {
  item: Pick<Item, 'name' | 'url' | 'icon_type' | 'icon_value'>
  /** sm: 卡片行 36px；md: 编辑器预览 44px */
  size?: 'sm' | 'md'
}) {
  const src = itemIconSrc(item)
  const [tone, setTone] = useState<Tone>('dark')

  useEffect(() => {
    if (!src) {
      setTone('dark')
      return
    }
    let alive = true
    void toneOf(src).then((next) => {
      if (alive) setTone(next)
    })
    return () => {
      alive = false
    }
  }, [src])

  return (
    <span
      className={cx(
        'inline-flex flex-none items-center justify-center overflow-hidden',
        size === 'md' ? 'h-11 w-11 rounded-[11px]' : 'h-9 w-9 rounded-[10px]',
        tone === 'dark' ? ICON_WELL_DARK : ICON_WELL_LIGHT,
      )}
    >
      <ItemIcon
        item={item}
        imgClass={size === 'md' ? 'h-[64%] w-[64%]' : 'h-[62%] w-[62%]'}
        textClass={size === 'md' ? 'text-[17px]' : 'text-[13px]'}
      />
    </span>
  )
}
