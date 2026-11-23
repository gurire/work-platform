import { useEffect, useState } from 'react'
import { FIELD_TYPES, STAGE_TYPES, type FieldType, type StageType } from '@wm/shared'
import { Banner, Button, Card, Field, STAGE_TYPE_LABEL, Switch, Tabs } from '../design/components'
import { coreApi, viewsApi, type CoreTeam, type FormQuestion } from './core-api'
import { useAppData, useLoad } from './data'

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  pick_one: 'Pick one',
  pick_many: 'Pick many',
  person: 'Person',
  link: 'Link',
}

/** Team settings (team admins only): stages, allowed moves and fields. */
export function SettingsPage({ teamId }: { teamId?: string | undefined }) {
  const { teams } = useAppData()
  const configurable = teams.filter((t) => t.canConfigure)
  const team = teams.find((t) => t.id === teamId) ?? configurable[0] ?? teams[0]
  const [tab, setTab] = useState<'stages' | 'fields' | 'forms'>('stages')
  if (!team)
    return (
      <div className="mx-page">
        <p className="md-meta">Loading…</p>
      </div>
    )
  return (
    <div className="mx-page">
      <header className="mx-page-head mx-head-row">
        <div>
          <p className="md-eyebrow">Team settings</p>
          <h1 className="md-h1">{team.name}</h1>
        </div>
        <label className="mx-row md-meta">
          Team
          <select
            className="md-select mx-select-inline"
            value={team.id}
            onChange={(e) =>
              (window.location.hash = `#/m/settings/${encodeURIComponent(e.target.value)}`)
            }
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {!team.canConfigure ? (
        <Banner title="Read only:">only this team’s admins can change its settings.</Banner>
      ) : null}
      <Tabs
        label="Settings sections"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'stages', label: 'Stages and moves' },
          { id: 'fields', label: 'Fields' },
          { id: 'forms', label: 'Request forms' },
        ]}
      />
      {tab === 'stages' ? (
        <StagesSettings team={team} />
      ) : tab === 'fields' ? (
        <FieldsSettings team={team} />
      ) : (
        <FormsSettings team={team} />
      )}
    </div>
  )
}

function StagesSettings({ team }: { team: CoreTeam }) {
  const { refresh } = useAppData()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const stages = [...team.stages].sort((a, b) => a.position - b.position)
  const [moves, setMoves] = useState<Set<string>>(
    () => new Set(team.transitions.map((t) => `${t.from}>${t.to}`)),
  )
  useEffect(() => setMoves(new Set(team.transitions.map((t) => `${t.from}>${t.to}`))), [team])
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<StageType>('doing')
  const ro = !team.canConfigure

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null)
    setSaved(null)
    try {
      await fn()
      setSaved(done)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-settings-grid">
      <Card className="mx-stack">
        <h2 className="md-h2">Stages, in order</h2>
        <p className="md-meta">
          Each stage has a type; the type decides its shared column on project boards.
        </p>
        {stages.map((s, i) => (
          <div key={s.key} className="mx-stage-row">
            <span className="md-meta mx-num">{i + 1}</span>
            <input
              className="md-input"
              aria-label={`Name of stage ${i + 1}`}
              defaultValue={s.name}
              key={s.name}
              disabled={ro}
              onBlur={(e) =>
                e.currentTarget.value.trim() &&
                e.currentTarget.value.trim() !== s.name &&
                run(
                  () => coreApi.editStage(team.id, s.key, { name: e.currentTarget.value.trim() }),
                  'Stage renamed',
                )
              }
            />
            <select
              className="md-select"
              aria-label={`Type of ${s.name}`}
              value={s.type}
              disabled={ro}
              onChange={(e) =>
                run(
                  () => coreApi.editStage(team.id, s.key, { type: e.target.value as StageType }),
                  'Stage type saved',
                )
              }
            >
              {STAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STAGE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {s.type === 'done' ? (
              <select
                className="md-select"
                aria-label={`Outcome of ${s.name}`}
                value={s.doneOutcome ?? 'completed'}
                disabled={ro}
                onChange={(e) =>
                  run(
                    () =>
                      coreApi.editStage(team.id, s.key, {
                        doneOutcome: e.target.value as 'completed' | 'cancelled',
                      }),
                    'Outcome saved',
                  )
                }
              >
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            ) : (
              <span />
            )}
          </div>
        ))}
        {!ro ? (
          <div className="mx-stage-row">
            <span />
            <input
              className="md-input"
              aria-label="New stage name"
              placeholder="New stage name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <select
              className="md-select"
              aria-label="New stage type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as StageType)}
            >
              {STAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STAGE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <Button
              size="s"
              disabled={!newName.trim()}
              onClick={() =>
                run(async () => {
                  await coreApi.addStage(team.id, newName.trim(), newType)
                  setNewName('')
                }, 'Stage added')
              }
            >
              Add stage
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="mx-stack">
        <h2 className="md-h2">Allowed moves</h2>
        <p className="md-meta">
          Tick where an item may go from each stage. With nothing ticked for a stage, items may go
          to the next stage, the previous one, or any Done stage.
        </p>
        <div className="mx-table-wrap">
          <table className="mx-table mx-matrix">
            <thead>
              <tr>
                <th scope="col">From ↓ / To →</th>
                {stages.map((s) => (
                  <th key={s.key} scope="col" className="mx-num">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stages.map((from) => (
                <tr key={from.key}>
                  <th scope="row">{from.name}</th>
                  {stages.map((to) => (
                    <td key={to.key} className="mx-num">
                      {from.key === to.key ? (
                        <span className="md-meta" aria-label="same stage">
                          —
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          className="md-check"
                          aria-label={`Allow ${from.name} to ${to.name}`}
                          disabled={ro}
                          checked={moves.has(`${from.key}>${to.key}`)}
                          onChange={(e) => {
                            const next = new Set(moves)
                            if (e.target.checked) next.add(`${from.key}>${to.key}`)
                            else next.delete(`${from.key}>${to.key}`)
                            setMoves(next)
                          }}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ro ? (
          <Button
            kind="primary"
            onClick={() =>
              run(
                () =>
                  coreApi.setTransitions(
                    team.id,
                    [...moves].map((m) => {
                      const [from = '', to = ''] = m.split('>')
                      return { from, to }
                    }),
                  ),
                'Allowed moves saved',
              )
            }
          >
            Save moves
          </Button>
        ) : null}
      </Card>
      {error ? (
        <p className="md-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="mx-ok" role="status">
          ✓ {saved}
        </p>
      ) : null}
    </div>
  )
}

function FieldsSettings({ team }: { team: CoreTeam }) {
  const fields = useLoad(() => coreApi.fields(team.id), team.id)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('short_text')
  const [options, setOptions] = useState('')
  const ro = !team.canConfigure
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      fields.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const list = fields.data ?? []
  return (
    <div className="mx-settings-grid">
      <Card className="mx-stack">
        <h2 className="md-h2">From the shared library</h2>
        {list
          .filter((f) => f.scope === 'library')
          .map((f) => (
            <Switch
              key={f.id}
              label={`${f.label} · ${FIELD_TYPE_LABEL[f.type]}`}
              checked={f.enabled}
              disabled={ro}
              onChange={(v) => run(() => coreApi.setField(team.id, f.id, v))}
            />
          ))}
        <p className="md-meta">Priority, due date, labels and estimate are on for every team.</p>
      </Card>
      <Card className="mx-stack">
        <h2 className="md-h2">{team.name}’s own fields</h2>
        {list
          .filter((f) => f.scope === 'team')
          .map((f) => (
            <Switch
              key={f.id}
              label={`${f.label} · ${FIELD_TYPE_LABEL[f.type]}${f.options.length ? ` (${f.options.join(', ')})` : ''}`}
              checked={f.enabled}
              disabled={ro}
              onChange={(v) => run(() => coreApi.setField(team.id, f.id, v))}
            />
          ))}
        {!ro ? (
          <div className="mx-stack">
            <Field label="New field name">
              {({ id }) => (
                <input
                  id={id}
                  className="md-input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              )}
            </Field>
            <Field label="Type">
              {({ id }) => (
                <select
                  id={id}
                  className="md-select"
                  value={type}
                  onChange={(e) => setType(e.target.value as FieldType)}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {type === 'pick_one' || type === 'pick_many' ? (
              <Field label="Options, separated by commas">
                {({ id }) => (
                  <input
                    id={id}
                    className="md-input"
                    value={options}
                    onChange={(e) => setOptions(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <Button
              disabled={!label.trim()}
              onClick={() =>
                run(async () => {
                  await coreApi.addField(
                    team.id,
                    label.trim(),
                    type,
                    options
                      .split(',')
                      .map((o) => o.trim())
                      .filter(Boolean),
                  )
                  setLabel('')
                  setOptions('')
                })
              }
            >
              Add field
            </Button>
          </div>
        ) : null}
      </Card>
      {error ? (
        <p className="md-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

type DraftQuestion = Omit<FormQuestion, 'key' | 'options'> & { options: string }

function FormsSettings({ team }: { team: CoreTeam }) {
  const forms = useLoad(() => viewsApi.forms(), 'forms')
  const stages = [...team.stages]
    .sort((a, b) => a.position - b.position)
    .filter((s) => s.type !== 'done')
  const [name, setName] = useState('')
  const [intro, setIntro] = useState('')
  const [startStage, setStartStage] = useState(stages[0]?.key ?? '')
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { label: 'Details', type: 'long_text', required: true, options: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const ro = !team.canConfigure
  const set = (i: number, patch: Partial<DraftQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  return (
    <div className="mx-settings-grid">
      <Card className="mx-stack">
        <h2 className="md-h2">{team.name}’s forms</h2>
        {(forms.data ?? []).filter((f) => f.teamId === team.id).length === 0 ? (
          <p className="md-meta">No forms yet.</p>
        ) : null}
        {(forms.data ?? [])
          .filter((f) => f.teamId === team.id)
          .map((f) => (
            <div key={f.id} className="mx-file">
              <span className="mx-grow md-strong">{f.name}</span>
              <span className="md-meta">
                {f.questions.length} questions · starts in{' '}
                {team.stages.find((s) => s.key === f.startStage)?.name}
              </span>
            </div>
          ))}
      </Card>
      {!ro ? (
        <Card className="mx-stack">
          <h2 className="md-h2">New form</h2>
          <Field label="Name">
            {({ id }) => (
              <input
                id={id}
                className="md-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Data pull or report"
              />
            )}
          </Field>
          <Field label="Short introduction">
            {({ id }) => (
              <input
                id={id}
                className="md-input"
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
              />
            )}
          </Field>
          <Field label="Accepted requests start in">
            {({ id }) => (
              <select
                id={id}
                className="md-select"
                value={startStage}
                onChange={(e) => setStartStage(e.target.value)}
              >
                {stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <span className="md-field-label">Questions (the title is always asked)</span>
          {questions.map((q, i) => (
            <div key={i} className="mx-question">
              <input
                className="md-input"
                aria-label={`Question ${i + 1}`}
                value={q.label}
                onChange={(e) => set(i, { label: e.target.value })}
              />
              <select
                className="md-select"
                aria-label={`Answer type for question ${i + 1}`}
                value={q.type}
                onChange={(e) => set(i, { type: e.target.value as FormQuestion['type'] })}
              >
                <option value="short_text">Short text</option>
                <option value="long_text">Long text</option>
                <option value="date">Date</option>
                <option value="pick_one">Pick one</option>
              </select>
              <label className="mx-check-pill">
                <input
                  type="checkbox"
                  className="md-check"
                  checked={q.required}
                  onChange={(e) => set(i, { required: e.target.checked })}
                />
                Required
              </label>
              {q.type === 'pick_one' ? (
                <input
                  className="md-input"
                  aria-label="Options, separated by commas"
                  placeholder="Options, separated by commas"
                  value={q.options}
                  onChange={(e) => set(i, { options: e.target.value })}
                />
              ) : null}
            </div>
          ))}
          <Button
            size="s"
            onClick={() =>
              setQuestions((qs) => [
                ...qs,
                { label: '', type: 'short_text', required: false, options: '' },
              ])
            }
          >
            + Add question
          </Button>
          {error ? <span className="md-field-error">{error}</span> : null}
          {saved ? <span className="mx-ok">✓ Form saved</span> : null}
          <Button
            kind="primary"
            disabled={!name.trim() || questions.some((q) => !q.label.trim())}
            onClick={async () => {
              setError(null)
              setSaved(false)
              try {
                await viewsApi.createForm(team.id, {
                  name: name.trim(),
                  ...(intro.trim() ? { intro: intro.trim() } : {}),
                  startStage,
                  questions: questions.map((q) => ({
                    label: q.label.trim(),
                    type: q.type,
                    required: q.required,
                    ...(q.type === 'pick_one'
                      ? {
                          options: q.options
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        }
                      : {}),
                  })),
                })
                setName('')
                setIntro('')
                setSaved(true)
                forms.reload()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            Save form
          </Button>
        </Card>
      ) : null}
    </div>
  )
}
