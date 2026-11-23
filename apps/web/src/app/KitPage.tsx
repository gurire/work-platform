import { Plus } from 'lucide-react'
import { useState } from 'react'
import {
  Avatar,
  AvatarStack,
  Banner,
  Button,
  Card,
  Counter,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Label,
  Menu,
  OverdueTag,
  PriorityTag,
  ProgressBar,
  RunTag,
  Skeleton,
  SplitBar,
  StagePath,
  StatusTag,
  Switch,
  Tabs,
  Toast,
  Tooltip,
  type ButtonKind,
  type ToastKind,
} from '../design/components'

const KINDS: ButtonKind[] = ['primary', 'secondary', 'ghost', 'danger', 'link']

/** A live gallery of the kit, so the owner can check it in the real app. */
export function KitPage() {
  const [switches, setSwitches] = useState({ popups: true, digest: false })
  const [tab, setTab] = useState<'board' | 'list' | 'table'>('board')
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [toasts, setToasts] = useState<ToastKind[]>(['success', 'info', 'error'])
  const [dialog, setDialog] = useState(false)

  return (
    <div className="mx-kit">
      <Card>
        <h2 className="md-h2">Buttons</h2>
        <div className="mx-row">
          {KINDS.map((k) => (
            <Button key={k} kind={k}>
              {k[0]?.toUpperCase() + k.slice(1)}
            </Button>
          ))}
        </div>
        <div className="mx-row">
          <Button kind="primary" disabled>
            Disabled
          </Button>
          <Button kind="primary" loading>
            Saving
          </Button>
          <Button kind="primary" size="s">
            Small
          </Button>
          <Button kind="primary" size="l" icon={<Plus size={16} aria-hidden="true" />}>
            New item
          </Button>
          <IconButton label="Add" kind="primary">
            <Plus size={18} />
          </IconButton>
        </div>
      </Card>

      <Card>
        <h2 className="md-h2">Inputs and switches</h2>
        <div className="mx-grid-2">
          <Field label="Title">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className="md-input"
                placeholder="Item title"
              />
            )}
          </Field>
          <Field label="Key" error="A key with this name already exists">
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="md-input"
                defaultValue="GST-2026"
              />
            )}
          </Field>
          <Field label="Priority">
            {({ id }) => (
              <select id={id} className="md-select">
                <option>High</option>
                <option>Medium</option>
              </select>
            )}
          </Field>
          <Field label="Quick add">
            {({ id }) => (
              <input
                id={id}
                className="md-input md-input-quick"
                placeholder="+ Add item, press Enter"
              />
            )}
          </Field>
        </div>
        <div className="mx-row">
          <Switch
            label="Desktop pop-ups"
            checked={switches.popups}
            onChange={(v) => setSwitches({ ...switches, popups: v })}
          />
          <Switch
            label="Email digest"
            checked={switches.digest}
            onChange={(v) => setSwitches({ ...switches, digest: v })}
          />
          <Switch label="Locked by admin" checked disabled onChange={() => {}} />
        </div>
      </Card>

      <Card>
        <h2 className="md-h2">Tags, avatars, tabs</h2>
        <div className="mx-row">
          <StatusTag type="waiting" name="Backlog" />
          <StatusTag type="doing" name="In progress" />
          <StatusTag type="review" name="QA review" />
          <StatusTag type="done" name="Published" />
        </div>
        <div className="mx-row">
          <PriorityTag priority="urgent" />
          <PriorityTag priority="high" />
          <PriorityTag priority="medium" />
          <PriorityTag priority="low" />
          <Label>finance</Label>
          <RunTag run={14} />
          <OverdueTag>Overdue 2 days</OverdueTag>
          <Counter value={3} />
          <Counter value={12} muted />
        </div>
        <div className="mx-row">
          <Avatar name="Asha Rao" size={24} />
          <Avatar name="Vikram N" size={32} online />
          <Avatar name="Meera J" size={40} />
          <AvatarStack
            names={['Asha Rao', 'Vikram N', 'Meera J', 'Priya K', 'Rohan D', 'Neha S']}
          />
          <Avatar name={null} decorative={false} />
        </div>
        <Tabs
          label="Views"
          variant="pill"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'board', label: 'Board' },
            { id: 'list', label: 'List' },
            { id: 'table', label: 'Table' },
          ]}
        />
        <Tabs
          label="Period"
          variant="segmented"
          value={period}
          onChange={setPeriod}
          options={[
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
          ]}
        />
      </Card>

      <Card>
        <h2 className="md-h2">Menus, stage path, progress</h2>
        <div className="mx-row mx-align-top">
          <Menu
            heading="Allowed moves"
            onPick={() => {}}
            items={[
              { id: 't', label: 'Transform', hint: 'next' },
              { id: 'b', label: 'Backlog', hint: 'back' },
              { id: 'p', label: 'Published', disabledReason: 'needs 2 approvals' },
            ]}
          />
          <Menu
            onPick={() => {}}
            items={[
              { id: 'c', label: 'Copy link' },
              { id: 'a', label: 'Archive item', danger: true },
            ]}
          />
        </div>
        <StagePath
          current={1}
          stages={[
            { name: 'Backlog', type: 'waiting' },
            { name: 'Ingest', type: 'doing' },
            { name: 'Transform', type: 'doing' },
            { name: 'QA review', type: 'review' },
            { name: 'Published', type: 'done' },
          ]}
        />
        <ProgressBar label="Sub-items done" value={3} max={5} />
        <ProgressBar label="Meera's load" value={36} max={30} over />
        <SplitBar counts={{ waiting: 9, doing: 14, review: 5, done: 18 }} />
      </Card>

      <Card>
        <h2 className="md-h2">Feedback</h2>
        {toasts.map((k) => (
          <Toast
            key={k}
            kind={k}
            title={
              k === 'success'
                ? 'Item moved to Transform'
                : k === 'info'
                  ? 'Run 15 starts tomorrow'
                  : 'Could not save'
            }
            onClose={() => setToasts((t) => t.filter((x) => x !== k))}
          />
        ))}
        {toasts.length === 0 ? (
          <Button size="s" onClick={() => setToasts(['success', 'info', 'error'])}>
            Show again
          </Button>
        ) : null}
        <Banner title="Heads up:">this item is 2 days overdue.</Banner>
        <div className="mx-row">
          <Tooltip text="Copy link · Ctrl L">
            <Button size="s">Hover me</Button>
          </Tooltip>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
        </div>
        <EmptyState title="Nothing waiting on you" text="Reviews and mentions will show up here." />
        <Skeleton width="70%" />
        <Dialog
          open={dialog}
          title="Send back for changes?"
          onClose={() => setDialog(false)}
          actions={
            <>
              <Button onClick={() => setDialog(false)}>Cancel</Button>
              <Button kind="danger" onClick={() => setDialog(false)}>
                Send back
              </Button>
            </>
          }
        >
          <p className="mx-intro">
            It returns to Transform and the owner is told. Add a short note.
          </p>
          <textarea className="md-textarea" aria-label="Note" />
        </Dialog>
      </Card>
    </div>
  )
}
