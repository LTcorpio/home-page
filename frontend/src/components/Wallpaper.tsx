// 全站壁纸：深色渐变兜底 + 可选图片（模糊）+ 黑色遮罩。
// 管理后台只展示壁纸图片（不模糊、不叠遮罩），与旧版 admin 页一致。
export function Wallpaper({
  image,
  blur = 2,
  mask,
}: {
  image?: string
  blur?: number
  mask?: number
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-0 scale-105 overflow-hidden bg-[radial-gradient(1200px_800px_at_30%_20%,#3a2140_0%,#241a2e_45%,#17161c_100%)]"
        style={
          image
            ? {
                backgroundImage: `url(${image})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: mask !== undefined ? `blur(${blur}px)` : undefined,
              }
            : undefined
        }
      />
      {mask !== undefined && (
        <div
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{ background: `rgba(0,0,0,${mask})` }}
        />
      )}
    </>
  )
}
