/**
 * The Midnight component kit (specs/design-system.md, section 6).
 * Every component reads colours from tokens.css only; styles live in components.css.
 */
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus, X } from 'lucide-react'

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/* ---------- Buttons ---------- */

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 's' | 'm' | 'l'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind | undefined
  size?: ButtonSize | undefined
  loading?: boolean | undefined
  icon?: ReactNode
}

export function Button({
  kind = 'secondary',
  size = 'm',
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('md-btn', `md-btn-${kind}`, `md-btn-${size}`, className)}
    >
      {loading ? <span className="md-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Spoken name; icon-only buttons must have one. */
  label: string
  kind?: 'plain' | 'primary' | undefined
  small?: boolean | undefined
}

export function IconButton({
  label,
  kind = 'plain',
  small = false,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'md-icon-btn',
        kind === 'primary' && 'md-icon-btn-primary',
        small && 'md-icon-btn-s',
        className,
      )}
    >
      {children}
    </button>
  )
}

/* ---------- Form fields ---------- */

interface FieldProps {
  label: string
  error?: string | null | undefined
  hint?: string | undefined
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** Wraps a control with its label and an error message under it (never colour alone). */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId()
  const msgId = `${id}-msg`
  const message = error ?? hint
  return (
    <div className="md-field">
      <label htmlFor={id} className="md-field-label">
        {label}
      </label>
      {children({ id, describedBy: message ? msgId : undefined, invalid: Boolean(error) })}
      {message ? (
        <span id={msgId} className={error ? 'md-field-error' : 'md-field-hint'}>
          {message}
        </span>
      ) : null}
    </div>
  )
}

/* ---------- Switch ---------- */

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean | undefined
}

export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <label className={cx('md-switch-row', disabled && 'md-disabled')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="md-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="md-switch-knob" />
      </button>
      <span>{label}</span>
    </label>
  )
}

/* ---------- Tags ---------- */

export type StageType = 'waiting' | 'doing' | 'review' | 'done'
export const STAGE_TYPE_LABEL: Record<StageType, string> = {
  waiting: 'Waiting',
  doing: 'Doing',
  review: 'Review',
  done: 'Done',
}

/** A stage name coloured by its stage type, with a dot; the name is always written. */
export function StatusTag({ type, name }: { type: StageType; name?: string | undefined }) {
  return (
    <span className={cx('md-tag', `md-tag-${type}`)}>
      <span className="md-dot" aria-hidden="true" />
      {name ?? STAGE_TYPE_LABEL[type]}
    </span>
  )
}

export type Priority = 'urgent' | 'high' | 'medium' | 'low'
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const icon =
    priority === 'urgent' ? (
      '!'
    ) : priority === 'high' ? (
      <ArrowUp size={10} strokeWidth={3} />
    ) : priority === 'low' ? (
      <ArrowDown size={10} strokeWidth={3} />
    ) : (
      <Minus size={10} strokeWidth={3} />
    )
  return (
    <span className={cx('md-tag', `md-prio-${priority}`)}>
      <span className="md-prio-icon" aria-hidden="true">
        {icon}
      </span>
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="md-label">{children}</span>
}

export function RunTag({ run }: { run: number }) {
  return <span className="md-run-tag">↻ Run {run}</span>
}

export function OverdueTag({ children }: { children: ReactNode }) {
  return <span className="md-overdue-tag">{children}</span>
}

export function Counter({ value, muted = false }: { value: number; muted?: boolean | undefined }) {
  return <span className={cx('md-counter', muted && 'md-counter-muted')}>{value}</span>
}

/* ---------- Avatars ---------- */

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

interface AvatarProps {
  name: string | null
  size?: 24 | 32 | 40 | undefined
  online?: boolean | undefined
  /** True when the name is written next to the avatar. */
  decorative?: boolean | undefined
}

export function Avatar({ name, size = 32, online = false, decorative = true }: AvatarProps) {
  const label = decorative ? undefined : (name ?? 'Unassigned')
  return (
    <span
      className={cx('md-avatar', `md-avatar-${size}`, !name && 'md-avatar-empty')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {name ? initials(name) : '?'}
      {online ? <span className="md-online" aria-hidden="true" /> : null}
    </span>
  )
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number | undefined }) {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  return (
    <span className="md-avatar-stack" role="img" aria-label={names.join(', ')}>
      {shown.map((n) => (
        <Avatar key={n} name={n} size={32} />
      ))}
      {extra > 0 ? <span className="md-avatar md-avatar-32 md-avatar-more">+{extra}</span> : null}
    </span>
  )
}

/* ---------- Tabs ---------- */

export interface TabOption<T extends string> {
  id: T
  label: string
  count?: number | undefined
}

interface TabsProps<T extends string> {
  options: readonly TabOption<T>[]
  value: T
  onChange: (id: T) => void
  variant?: 'underline' | 'pill' | 'segmented' | undefined
  label: string
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  variant = 'underline',
  label,
}: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={cx('md-tabs', `md-tabs-${variant}`)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          className="md-tab"
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.count !== undefined ? <span className="md-tab-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* ---------- Menus ---------- */

export interface MenuItem {
  id: string
  label: string
  hint?: string | undefined
  disabledReason?: string | undefined
  danger?: boolean | undefined
}

interface MenuProps {
  heading?: string | undefined
  items: readonly MenuItem[]
  onPick: (id: string) => void
}

/** Disabled items stay visible and say why (for example "needs 2 approvals"). */
export function Menu({ heading, items, onPick }: MenuProps) {
  return (
    <div role="menu" className="md-menu">
      {heading ? <span className="md-menu-head">{heading}</span> : null}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={Boolean(item.disabledReason)}
          className={cx('md-menu-item', item.danger && 'md-menu-danger')}
          onClick={() => onPick(item.id)}
        >
          <span>{item.label}</span>
          <span className="md-menu-hint">{item.disabledReason ?? item.hint}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- Stage path ---------- */

export function StagePath({
  stages,
  current,
}: {
  stages: readonly { name: string; type: StageType }[]
  current: number
}) {
  return (
    <ol className="md-path" aria-label="Stages">
      {stages.map((s, i) => (
        <li
          key={s.name}
          className={cx(
            'md-path-step',
            i < current && 'md-path-past',
            i === current && `md-path-current md-tag-${s.type}`,
            i > current && 'md-path-next',
          )}
          aria-current={i === current ? 'step' : undefined}
        >
          {s.name}
        </li>
      ))}
    </ol>
  )
}

/* ---------- Progress ---------- */

export function ProgressBar({
  value,
  max,
  label,
  over = false,
}: {
  value: number
  max: number
  label: string
  over?: boolean | undefined
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="md-progress">
      <div
        className="md-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={cx('md-fill', over && 'md-fill-over')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function SplitBar({ counts }: { counts: Record<StageType, number> }) {
  const order: StageType[] = ['waiting', 'doing', 'review', 'done']
  const text = order.map((t) => `${STAGE_TYPE_LABEL[t]} ${counts[t]}`).join(', ')
  return (
    <div className="md-split">
      <div className="md-split-bar" role="img" aria-label={text}>
        {order
          .filter((t) => counts[t] > 0)
          .map((t) => (
            <span key={t} className={`md-split-seg md-seg-${t}`} style={{ flexGrow: counts[t] }} />
          ))}
      </div>
      <div className="md-legend">
        {order.map((t) => (
          <span key={t} className="md-legend-item">
            <span className={`md-legend-dot md-seg-${t}`} aria-hidden="true" />
            {STAGE_TYPE_LABEL[t]} {counts[t]}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------- Feedback ---------- */

export type ToastKind = 'success' | 'info' | 'error'

export function Toast({
  kind,
  title,
  text,
  onClose,
}: {
  kind: ToastKind
  title: string
  text?: string | undefined
  onClose: () => void
}) {
  useEffect(() => {
    if (kind === 'error') return
    const timer = setTimeout(onClose, 6000)
    return () => clearTimeout(timer)
  }, [kind, onClose])
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className="md-toast">
      <span className={`md-toast-icon md-toast-${kind}`} aria-hidden="true">
        {kind === 'success' ? '✓' : kind === 'info' ? 'i' : '!'}
      </span>
      <span className="md-toast-body">
        <span className="md-strong">{title}</span>
        {text ? <span className="md-meta">{text}</span> : null}
      </span>
      <IconButton label="Dismiss" small onClick={onClose}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

export function Banner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="md-banner" role="note">
      <b>{title}</b> {children}
    </div>
  )
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="md-tooltip-wrap">
      {children}
      <span role="tooltip" className="md-tooltip">
        {text}
      </span>
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="md-empty">
      {icon ? <span className="md-empty-icon">{icon}</span> : null}
      <span className="md-strong">{title}</span>
      <span className="md-meta">{text}</span>
      {action}
    </div>
  )
}

export function Skeleton({ width }: { width: string }) {
  return <span className="md-skeleton" style={{ width }} aria-hidden="true" />
}

/* ---------- Dialog ---------- */

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  actions: ReactNode
}

/** A modal dialog using the browser's own <dialog>, so Esc and focus trapping work. */
export function Dialog({ open, title, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal?.()
    if (!open && el.open) el.close?.()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="md-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id={titleId} className="md-h2">
        {title}
      </h2>
      <div className="md-dialog-body">{children}</div>
      <div className="md-dialog-actions">{actions}</div>
    </dialog>
  )
}

/* ---------- Cards ---------- */

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string | undefined
}) {
  return <section className={cx('md-card', className)}>{children}</section>
}
