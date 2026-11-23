import { useMemo, useState } from 'react'
import { STAGE_TYPES, type StageType } from '@wm/shared'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  PriorityTag,
  SplitBar,
  STAGE_TYPE_LABEL,
  StatusTag,
  Tabs,
} from '../design/components'
import { coreApi, workApi, type CoreItem, type CoreTeam } from './core-api'
import { nameOf, plainText, useAppData, useLoad } from './data'
import { isOverdue, ItemCard, ItemDetail, QuickAdd, shortDate } from './work'

function SidePanel({
  itemId,
  onClose,
  onChanged,
}: {
  itemId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  if (!itemId) return null
  return (
    <aside className="mx-panel" aria-label="Item details">
      <ItemDetail itemId={itemId} onClose={onClose} onChanged={onChanged} />
    </aside>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <Card>
      <EmptyState title="Something went wrong" text={text} />
    </Card>
  )
}

/* ---------- Team board: the team's own stages ---------- */

export function TeamBoardPage({ teamId }: { teamId: string }) {
  const { teams, refresh } = useAppData()
  const team = teams.find((t) => t.id === teamId)
  const items = useLoad(() => coreApi.teamItems(teamId), teamId)
  const [selected, setSelected] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const { me } = useAppData()
  if (!team) return <Problem text="This team does not exist or is private." />
  if (items.error) return <Problem text={items.error} />
  const stages = [...team.stages].sort((a, b) => a.position - b.position)
  const top = (items.data ?? []).filter(
    (i) => i.parentId === null && (!mine || i.assigneeId === me?.id),
  )

  return (
    <div className="mx-page mx-page-wide">
      <header className="mx-page-head mx-head-row">
        <div>
          <p className="md-eyebrow">Team board</p>
          <h1 className="md-h1">{team.name}</h1>
          <p className="mx-intro">
            {team.members.length} people · estimates in {team.estimateUnit}
          </p>
        </div>
        <div className="mx-row">
          <Button
            kind={mine ? 'primary' : 'secondary'}
            size="s"
            aria-pressed={mine}
            onClick={() => setMine((m) => !m)}
          >
            Mine
          </Button>
          {team.canConfigure ? (
            <a
              className="md-btn md-btn-secondary md-btn-s"
              href={`#/m/settings/${encodeURIComponent(team.id)}`}
            >
              Edit stages
            </a>
          ) : null}
        </div>
      </header>
      <div className="mx-board-wrap">
        <div
          className="mx-board"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(240px, 1fr))` }}
        >
          {stages.map((stage) => {
            const list = top.filter((i) => i.stageKey === stage.key)
            const over = stage.itemLimit !== null && list.length > stage.itemLimit
            return (
              <section key={stage.key} className="mx-column" aria-label={stage.name}>
                <div className="mx-column-head">
                  <span className="md-strong">{stage.name}</span>
                  <span className={over ? 'md-overdue-tag' : 'md-meta'}>
                    {list.length}
                    {stage.itemLimit !== null ? ` / ${stage.itemLimit}` : ''}
                    {over ? ' over limit' : ''}
                  </span>
                </div>
                <StatusTag type={stage.type} />
                {items.data === null ? <span className="md-skeleton" /> : null}
                {list.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    team={team}
                    selected={selected === item.id}
                    onOpen={() => setSelected(item.id)}
                  />
                ))}
                {team.canCreate ? (
                  <QuickAdd
                    label={`Add an item to ${stage.name}`}
                    onAdd={async (title) => {
                      await coreApi.createItem({ teamId: team.id, title, stageKey: stage.key })
                      items.reload()
                    }}
                  />
                ) : null}
              </section>
            )
          })}
        </div>
      </div>
      <SidePanel
        itemId={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          items.reload()
          refresh()
        }}
      />
    </div>
  )
}

/* ---------- Project page: shared columns across teams ---------- */

type View = 'board' | 'list' | 'table'
type SortKey = 'key' | 'title' | 'team' | 'stage' | 'owner' | 'priority' | 'due' | 'estimate'

export function ProjectPage({ projectId }: { projectId: string }) {
  const { teams, people, refresh } = useAppData()
  const loaded = useLoad(() => coreApi.project(projectId), projectId)
  const [view, setView] = useState<View>('board')
  const [selected, setSelected] = useState<string | null>(null)
  const [addTeam, setAddTeam] = useState<string>('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'key', dir: 1 })
  const teamOf = (id: string): CoreTeam | undefined => teams.find((t) => t.id === id)
  const creatable = teams.filter((t) => t.canCreate)
  const projectTeams = new Set((loaded.data?.items ?? []).map((i) => i.teamId))
  const chosenTeam =
    addTeam || creatable.find((t) => projectTeams.has(t.id))?.id || creatable[0]?.id || ''

  const rows = useMemo(() => {
    const list = (loaded.data?.items ?? []).filter((i) => i.parentId === null)
    const val = (i: CoreItem): string | number => {
      switch (sort.key) {
        case 'team':
          return teamOf(i.teamId)?.name ?? i.teamId
        case 'stage':
          return STAGE_TYPES.indexOf(i.stageType)
        case 'owner':
          return nameOf(people, i.assigneeId) ?? '~'
        case 'priority':
          return -['none', 'low', 'medium', 'high', 'urgent'].indexOf(i.priority)
        case 'due':
          return i.dueOn ?? '9999'
        case 'estimate':
          return i.estimate ?? -1
        case 'title':
          return i.title.toLowerCase()
        default:
          return Number(i.key.split('-')[1] ?? 0) + i.teamId.charCodeAt(0) * 1e6
      }
    }
    return [...list].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0))
  }, [loaded.data, sort, people, teams])

  if (loaded.error) return <Problem text={loaded.error} />
  if (!loaded.data)
    return (
      <div className="mx-page">
        <span className="md-meta">Loading…</span>
      </div>
    )
  const { project, progress, milestones } = loaded.data

  const add = async (title: string, type?: StageType) => {
    const team = teamOf(chosenTeam)
    if (!team) throw new Error('pick a team for the new item')
    const stage = type
      ? [...team.stages].sort((a, b) => a.position - b.position).find((s) => s.type === type)
      : undefined
    await coreApi.createItem({
      teamId: team.id,
      title,
      projectId: project.id,
      ...(stage ? { stageKey: stage.key } : {}),
    })
    loaded.reload()
    refresh()
  }

  const head = (key: SortKey, label: string, numeric = false) => (
    <th
      scope="col"
      className={numeric ? 'mx-num' : undefined}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="mx-th-btn"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )

  return (
    <div className="mx-page mx-page-wide">
      <header className="mx-page-head">
        <p className="md-eyebrow">Project</p>
        <h1 className="md-h1">{project.name}</h1>
        <p className="mx-intro">
          Owner: {nameOf(people, project.ownerId)}
          {project.endsOn ? ` · ends ${shortDate(project.endsOn)}` : ''} · {progress.done} of{' '}
          {progress.total} done ({progress.percent}%)
        </p>
        <SplitBar counts={progress.counts} />
        {milestones.length > 0 ? (
          <div className="mx-row">
            {milestones.map((m) => (
              <span key={m.id} className="mx-milestone">
                <span className="md-meta">
                  {m.left === 0 && m.total > 0 ? '✓ Done' : `${m.left} left`}
                  {m.dueOn ? ` · ${shortDate(m.dueOn)}` : ''}
                </span>
                <span className="md-strong">{m.name}</span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mx-toolbar">
        <Tabs
          label="Views"
          variant="underline"
          value={view}
          onChange={setView}
          options={[
            { id: 'board', label: 'Board' },
            { id: 'list', label: 'List' },
            { id: 'table', label: 'Table' },
          ]}
        />
        {creatable.length > 0 ? (
          <label className="mx-row md-meta">
            New items go to
            <select
              className="md-select mx-select-inline"
              value={chosenTeam}
              onChange={(e) => setAddTeam(e.target.value)}
            >
              {creatable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {view === 'board' ? (
        <div className="mx-board-wrap">
          <div
            className="mx-board"
            style={{ gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))' }}
          >
            {STAGE_TYPES.map((type) => {
              const list = rows.filter((i) => i.stageType === type)
              return (
                <section key={type} className="mx-column" aria-label={STAGE_TYPE_LABEL[type]}>
                  <div className="mx-column-head">
                    <StatusTag type={type} />
                    <span className="md-meta">{list.length}</span>
                  </div>
                  {list.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      team={teamOf(item.teamId)}
                      showTeam
                      selected={selected === item.id}
                      onOpen={() => setSelected(item.id)}
                    />
                  ))}
                  {creatable.length > 0 ? (
                    <QuickAdd
                      label={`Add an item to ${STAGE_TYPE_LABEL[type]}`}
                      onAdd={(t) => add(t, type)}
                    />
                  ) : null}
                </section>
              )
            })}
          </div>
        </div>
      ) : null}

      {view === 'list' ? (
        <div className="mx-list">
          {STAGE_TYPES.map((type) => {
            const list = rows.filter((i) => i.stageType === type)
            return (
              <Card key={type} className="mx-list-group">
                <h2 className="mx-list-head">
                  <StatusTag type={type} /> <span className="md-meta">{list.length}</span>
                </h2>
                {list.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="mx-list-row"
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="md-meta mx-key">{item.key}</span>
                    <span className="mx-grow">{item.title}</span>
                    <span className="md-meta">
                      {teamOf(item.teamId)?.stages.find((s) => s.key === item.stageKey)?.name}
                    </span>
                    <Avatar name={nameOf(people, item.assigneeId)} size={24} />
                    <span className={isOverdue(item) ? 'md-field-error' : 'md-meta'}>
                      {shortDate(item.dueOn)}
                    </span>
                  </button>
                ))}
              </Card>
            )
          })}
          {creatable.length > 0 ? (
            <QuickAdd label="Add an item to this project" onAdd={(t) => add(t)} />
          ) : null}
        </div>
      ) : null}

      {view === 'table' ? (
        <div className="mx-table-wrap">
          <table className="mx-table">
            <thead>
              <tr>
                {head('key', 'Key')}
                {head('title', 'Title')}
                {head('team', 'Team')}
                {head('stage', 'Stage')}
                {head('owner', 'Owner')}
                {head('priority', 'Priority')}
                {head('due', 'Due', true)}
                {head('estimate', 'Estimate', true)}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const team = teamOf(item.teamId)
                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item.id)}
                    className={selected === item.id ? 'mx-row-selected' : undefined}
                  >
                    <td className="md-meta">{item.key}</td>
                    <td>
                      <button
                        type="button"
                        className="mx-link-btn"
                        onClick={() => setSelected(item.id)}
                      >
                        {item.title}
                      </button>
                    </td>
                    <td>{team?.name}</td>
                    <td>
                      <StatusTag
                        type={item.stageType}
                        name={team?.stages.find((s) => s.key === item.stageKey)?.name}
                      />
                    </td>
                    <td>{nameOf(people, item.assigneeId) ?? '—'}</td>
                    <td>
                      {item.priority === 'none' ? '—' : <PriorityTag priority={item.priority} />}
                    </td>
                    <td className={isOverdue(item) ? 'mx-num md-field-error' : 'mx-num'}>
                      {shortDate(item.dueOn) || '—'}
                    </td>
                    <td className="mx-num">{item.estimate ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <SidePanel
        itemId={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          loaded.reload()
          refresh()
        }}
      />
    </div>
  )
}

/* ---------- Home: my work ---------- */

export function HomePage() {
  const { me, teams, people } = useAppData()
  const mine = useLoad(() => coreApi.myItems(), me?.id ?? '')
  const [selected, setSelected] = useState<string | null>(null)
  const items = mine.data ?? []
  const overdue = items.filter(isOverdue).length
  return (
    <div className="mx-page">
      <header className="mx-page-head">
        <p className="md-eyebrow">
          {new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
        <h1 className="md-h1">Hello{me ? `, ${me.name.split(' ')[0]}` : ''}</h1>
        <p className="mx-intro">
          {items.length} open items with you{overdue ? `, ${overdue} overdue` : ''}.
        </p>
      </header>
      <Card className="mx-list-group">
        <h2 className="mx-list-head">Assigned to me</h2>
        {mine.error ? <p className="md-field-error">{mine.error}</p> : null}
        {mine.data && items.length === 0 ? (
          <EmptyState title="Nothing assigned to you" text="Items you own show up here." />
        ) : null}
        {items.map((item) => {
          const team = teams.find((t) => t.id === item.teamId)
          return (
            <button
              key={item.id}
              type="button"
              className="mx-list-row"
              onClick={() => setSelected(item.id)}
            >
              <StatusTag
                type={item.stageType}
                name={team?.stages.find((s) => s.key === item.stageKey)?.name}
              />
              <span className="mx-grow">
                <span className="mx-block">{item.title}</span>
                <span className="md-meta">
                  {item.key} · {team?.name}
                </span>
              </span>
              <span className={isOverdue(item) ? 'md-field-error' : 'md-meta'}>
                {shortDate(item.dueOn)}
              </span>
              <Avatar name={nameOf(people, item.assigneeId)} size={24} />
            </button>
          )
        })}
      </Card>
      <HomeInbox onOpen={setSelected} />
      <SidePanel itemId={selected} onClose={() => setSelected(null)} onChanged={mine.reload} />
    </div>
  )
}

export function ItemFullPage({ itemKey }: { itemKey: string }) {
  const { refresh } = useAppData()
  return (
    <div className="mx-page">
      <ItemDetail itemId={itemKey} fullPage onChanged={refresh} />
    </div>
  )
}

function HomeInbox({ onOpen }: { onOpen: (id: string) => void }) {
  const { people } = useAppData()
  const loaded = useLoad(() => workApi.inbox(), 'home-inbox')
  const unread = (loaded.data?.entries ?? []).filter((e) => !e.read)
  const reviews = unread.filter((e) => e.kind === 'review_requested')
  const mentions = unread.filter((e) => e.kind === 'mentioned')
  return (
    <div className="mx-settings-grid">
      <Card className="mx-list-group">
        <h2 className="mx-list-head">Waiting on my review</h2>
        {reviews.length === 0 ? <p className="mx-pad md-meta">No reviews waiting on you.</p> : null}
        {reviews.map((e) => (
          <button key={e.id} type="button" className="mx-list-row" onClick={() => onOpen(e.itemId)}>
            <span className="mx-grow">
              <span className="mx-block">{e.itemTitle}</span>
              <span className="md-meta">
                {e.itemKey} · asked by {nameOf(people, e.actorId)}
              </span>
            </span>
          </button>
        ))}
      </Card>
      <Card className="mx-list-group">
        <h2 className="mx-list-head">Mentions</h2>
        {mentions.length === 0 ? <p className="mx-pad md-meta">No new mentions.</p> : null}
        {mentions.map((e) => (
          <button key={e.id} type="button" className="mx-list-row" onClick={() => onOpen(e.itemId)}>
            <span className="mx-grow">
              <span className="mx-block">
                {nameOf(people, e.actorId)} on {e.itemTitle}
              </span>
              {e.excerpt ? <span className="md-meta">“{plainText(e.excerpt)}”</span> : null}
            </span>
          </button>
        ))}
      </Card>
    </div>
  )
}
