export interface Group {
  id: number
  name: string
  sort: number
  probe: '' | 'on' | 'off'
}

export interface Item {
  id: number
  group_id: number
  name: string
  url: string
  description: string
  icon_type: 'auto' | 'upload' | 'text'
  icon_value: string
  container_name: string
  lan_url: string
  probe: boolean
  sort: number
  hidden: boolean
  acl: string
  memo?: string
  created_at: string
  updated_at: string
  icon_url?: string
}

export interface BoardGroup extends Group {
  items: Item[]
}

export interface Identity {
  user: string
  name: string
  email: string
  groups: string[]
}

export interface BoardData {
  settings: Record<string, string>
  groups: BoardGroup[]
  features: { docker: boolean; admin: boolean }
  identity: Identity
  now_ms: number // 服务端当前时刻（epoch 毫秒）
  tz_offset_sec: number // 服务端时区偏移（秒）
}

export interface Container {
  name: string
  image: string
  state: string
  status: string
  id: string
}

export interface ContainersResponse {
  available: boolean
  containers: Record<string, Container>
  error?: string | null
}

export interface ContainerOpResult {
  name: string
  action: string
  ok: boolean
  error?: string
}

export interface ContainerOpResponse {
  ok: boolean
  error: string
  results: ContainerOpResult[]
}

export interface IconUploadResponse {
  icon_type: string
  icon_value: string
  icon_url: string
}
