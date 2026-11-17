/**
 * The shared visual kit (docs/research/ui-review): avatars, stage rings, stage chips and
 * priority icons, used on every screen so the app reads as one system.
 */
import type { Stage } from '@wm/shared'
import { SAMPLE_PRIORITIES } from '@wm/shared'
import { isEndStage } from '@wm/shared'
import { Bookmark, Bug, Layers, SquareCheck } from 'lucide-react'

/** Muted background / strong text pairs; every pair passes 4.5:1. */
const AVATAR_TONES: readonly (readonly [string, string])[] = [
  ['#E0F2F1', '#0F5F5E'],
  ['#E8EAF6', '#3949AB'],
  ['#FCE4EC', '#AD1457'],
  ['#FFF3E0', '#9A3412'],
  ['#E8F5E9', '#2E7D32'],
  ['#F3E5F5', '#7B1FA2'],
  ['#E3F2FD', '#1565C0'],
  ['#FBE9E7', '#BF360C'],
]

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** The same person always gets the same colour. */
export function avatarTone(seed: string): readonly [string, string] {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? ['#E0F2F1', '#0F5F5E']
}

interface AvatarProps {
  /** Null means nobody: a dashed empty circle. */
  name: string | null
  id?: string | null
  size?: number
  /** Hide from screen readers when the name is written next to it. */
  decorative?: boolean
}

export function Avatar({ name, id, size = 22, decorative = true }: AvatarProps) {
  const label = decorative ? undefined : (name ?? 'Unassigned')
  if (!name) {
    return (
      <span
        className="avatar avatar-empty"
        style={{ width: size, height: size }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    )
  }
  const [bg, fg] = avatarTone(id ?? name)
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.42),
      }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {initials(name)}
    </span>
  )
}

export interface StageLook {
  readonly name: string
  /** How far along the working stages this stage is, 0 to 1. */
  readonly fraction: number
  readonly state: 'open' | 'done' | 'dropped'
}

/** Where a stage sits in its team's workflow, for rings and steppers. */
export function stageLook(stages: readonly Stage[], key: string): StageLook {
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const stage = ordered.find((s) => s.key === key)
  if (!stage) return { name: key, fraction: 0, state: 'open' }
  if (stage.category === 'done') return { name: stage.name, fraction: 1, state: 'done' }
  if (stage.category === 'cancelled') return { name: stage.name, fraction: 0, state: 'dropped' }
  const working = ordered.filter((s) => !isEndStage(s))
  const index = working.findIndex((s) => s.key === key)
  return { name: stage.name, fraction: (index + 1) / (working.length + 1), state: 'open' }
}

const RING = 2 * Math.PI * 5.5

/** A small ring that fills as an item moves through its stages; a tick when done. */
export function StageRing({ look, size = 14 }: { look: StageLook; size?: number }) {
  if (look.state === 'done') {
    return (
      <svg className="stage-ring" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
        <circle cx="7" cy="7" r="6.5" fill="var(--good)" />
        <path
          d="M4 7.2l2 2 4-4"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (look.state === 'dropped') {
    return (
      <svg className="stage-ring" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
        <circle cx="7" cy="7" r="6.5" fill="var(--text-subtle)" />
        <path
          d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg className="stage-ring" viewBox="0 0 14 14" width={size} height={size} aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--ring-track)" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeDasharray={`${look.fraction * RING} ${RING}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

export function StageChip({ look }: { look: StageLook }) {
  return (
    <span className="chip stage-chip">
      <StageRing look={look} />
      {look.name}
    </span>
  )
}

/** Signal bars for priority; a red square with "!" for urgent. Always labelled. */
export function PriorityIcon({ level, size = 14 }: { level: number; size?: number }) {
  const label = `${SAMPLE_PRIORITIES[level] ?? 'None'} priority`
  if (level >= 4) {
    return (
      <svg viewBox="0 0 14 14" width={size} height={size} role="img" aria-label={label}>
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="var(--bad)" />
        <path d="M7 3.5v4.2M7 10.2v.1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  const on = 'var(--text-muted)'
  const off = 'var(--ring-track)'
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} role="img" aria-label={label}>
      <rect x="1" y="9" width="3" height="4" rx="1" fill={level >= 1 ? on : off} />
      <rect x="5.5" y="6" width="3" height="7" rx="1" fill={level >= 2 ? on : off} />
      <rect x="10" y="3" width="3" height="10" rx="1" fill={level >= 3 ? on : off} />
    </svg>
  )
}

/** A team's coloured initials tile. */
export function TeamTile({ id, name, size = 18 }: { id: string; name: string; size?: number }) {
  const [bg, fg] = avatarTone(`team:${id}`)
  return (
    <span
      className="team-tile"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.45),
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

const KIND_ICONS = { story: Bookmark, task: SquareCheck, bug: Bug, epic: Layers } as const

/** The item's kind as an icon, labelled for screen readers. */
export function KindIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const Icon = KIND_ICONS[kind as keyof typeof KIND_ICONS] ?? SquareCheck
  return <Icon className="kind-icon" size={size} aria-label={kind} role="img" />
}
