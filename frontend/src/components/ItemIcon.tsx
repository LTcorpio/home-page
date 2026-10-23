import { useEffect, useState } from 'react'
import type { Item } from '../lib/types'
import { cx } from './ui'

// 图标三种来源：upload → /icons/ 本地文件；auto → 服务端代抓 favicon；text/兜底 → 文字首字。
// 抓取失败时自动退回文字图标。
export function itemIconSrc(item: Pick<Item, 'url' | 'icon_type' | 'icon_value'>) {
  if (item.icon_type === 'upload' && item.icon_value) {
    return `/icons/${encodeURIComponent(item.icon_value)}`
  }
  if (item.icon_type === 'auto' && item.url) {
    // 图标抓取由服务端发起，必须用主地址：容器不在局域网白名单内，改走 lan_url 会被 nginx 403
    return `/api/icons/proxy?url=${encodeURIComponent(item.url)}`
  }
  return ''
}

export function ItemIcon({
  item,
  imgClass = 'h-[30px] w-[30px]',
  textClass,
}: {
  item: Pick<Item, 'name' | 'url' | 'icon_type' | 'icon_value'>
  imgClass?: string
  textClass?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.icon_type, item.icon_value, item.url])

  const text =
    (item.icon_type === 'text' && item.icon_value ? item.icon_value : (item.name || '?').trim().charAt(0)) ||
    '?'

  const src = itemIconSrc(item)

  if (!src || failed) {
    return (
      <span
        className={cx(
          'flex h-full w-full items-center justify-center text-[15px] font-medium tracking-[1px]',
          'text-white text-shadow',
          textClass,
        )}
      >
        {text}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className={cx('block object-contain', imgClass)}
      onError={() => setFailed(true)}
    />
  )
}
