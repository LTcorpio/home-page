import type { ReactNode } from 'react'

export type IconName =
  | 'user'
  | 'refresh'
  | 'gear'
  | 'sliders'
  | 'start'
  | 'stop'
  | 'restart'
  | 'memo'
  | 'open'
  | 'up'
  | 'down'
  | 'enable'
  | 'disable'
  | 'edit'
  | 'del'
  | 'close'
  | 'groups'
  | 'items'
  | 'chevron'
  | 'search'
  | 'folder'
  | 'plus'
  | 'home'
  | 'probe'

interface IconDef {
  sw: number
  node: ReactNode
}

const ICONS: Record<IconName, IconDef> = {
  user: {
    sw: 2,
    node: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  refresh: {
    sw: 2,
    node: (
      <>
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </>
    ),
  },
  gear: {
    sw: 1.8,
    node: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
  sliders: {
    sw: 2,
    node: (
      <>
        <path d="M4 21v-7" />
        <path d="M4 10V3" />
        <path d="M12 21v-9" />
        <path d="M12 8V3" />
        <path d="M20 21v-5" />
        <path d="M20 12V3" />
        <path d="M2 14h4" />
        <path d="M9 8h6" />
        <path d="M17 16h6" />
      </>
    ),
  },
  start: {
    sw: 2.2,
    node: <path d="m8 5.5 11 6.5-11 6.5Z" />,
  },
  stop: {
    sw: 2.2,
    node: <rect x="6" y="6" width="12" height="12" rx="2" />,
  },
  restart: {
    sw: 2,
    node: (
      <>
        <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
  },
  memo: {
    sw: 2,
    node: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </>
    ),
  },
  open: {
    sw: 2,
    node: (
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
      </>
    ),
  },
  up: {
    sw: 2.2,
    node: (
      <>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </>
    ),
  },
  down: {
    sw: 2.2,
    node: (
      <>
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </>
    ),
  },
  enable: {
    sw: 2,
    node: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  disable: {
    sw: 2,
    node: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m5.6 5.6 12.8 12.8" />
      </>
    ),
  },
  edit: {
    sw: 2,
    node: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  },
  del: {
    sw: 2,
    node: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      </>
    ),
  },
  close: {
    sw: 2,
    node: <path d="M18 6 6 18M6 6l12 12" />,
  },
  groups: {
    sw: 2,
    node: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="8" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
      </>
    ),
  },
  items: {
    sw: 2,
    node: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 9h18" />
      </>
    ),
  },
  chevron: {
    sw: 2.2,
    node: <path d="m6 9 6 6 6-6" />,
  },
  search: {
    sw: 2,
    node: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
  },
  folder: {
    sw: 1.8,
    node: (
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v7.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
    ),
  },
  plus: {
    sw: 2,
    node: <path d="M12 5v14M5 12h14" />,
  },
  probe: {
    sw: 2,
    node: <path d="M3 12h3.6l2.4-7 4.6 14 2.4-7H21" />,
  },
  home: {
    sw: 1.8,
    node: (
      <path d="M4 10.4 12 4l8 6.4V19a1.5 1.5 0 0 1-1.5 1.5h-3.7V15H9.2v5.5H5.5A1.5 1.5 0 0 1 4 19z" />
    ),
  },
}

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  const def = ICONS[name]
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={def.sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {def.node}
    </svg>
  )
}
