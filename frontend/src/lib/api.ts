// 统一 API 客户端：相对路径请求，开发期由 Vite 代理到 Go 后端。
// 非 2xx 时优先取后端 JSON 的 error 字段，拿不到再用响应文本 / 状态文本。

interface ApiOptions extends RequestInit {
  timeout?: number
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeout = 15000, ...init } = options
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal })
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        msg = JSON.parse(text).error || text
      } catch {
        // 非 JSON 响应直接使用文本
      }
      throw new Error(msg || res.statusText)
    }
    return res.json() as Promise<T>
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('请求超时')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const put = <T>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })
