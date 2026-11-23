import { CalendarDays, ClipboardList, Inbox, LayoutGrid, Settings, Shapes } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, EmptyState } from '../design/components'
import type { MRoute } from './routes'
import { SAMPLE_PROJECTS, SAMPLE_TEAMS } from './nav-data'
import { KitPage } from './KitPage'
import { hrefFor } from './routes'

function Page({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <div className="mx-page">
      <header className="mx-page-head">
        {eyebrow ? <p className="md-eyebrow">{eyebrow}</p> : null}
        <h1 className="md-h1">{title}</h1>
        {intro ? <p className="mx-intro">{intro}</p> : null}
      </header>
      {children}
    </div>
  )
}

/** Placeholder until the phase that builds the page; says what the page will do. */
function Coming({ icon, what, phase }: { icon: ReactNode; what: string; phase: string }) {
  return (
    <Card>
      <EmptyState
        icon={icon}
        title={`Coming in ${phase}`}
        text={what}
        action={<a href={hrefFor({ page: 'kit' })}>See the component kit</a>}
      />
    </Card>
  )
}

function today(): string {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function PageFor({ route }: { route: MRoute }) {
  switch (route.page) {
    case 'home':
      return (
        <Page
          eyebrow={today()}
          title="My work"
          intro="Your items, the reviews waiting on you and your mentions, in one place."
        >
          <Coming
            icon={<ClipboardList size={22} />}
            what="Assigned to me, waiting on my review, mentions; stuck items and milestones on the right."
            phase="phase 2 (Core model)"
          />
        </Page>
      )
    case 'inbox':
      return (
        <Page title="Inbox">
          <Coming
            icon={<Inbox size={22} />}
            what="Mentions, reviews asked of you, items sent back, and runs that could not start."
            phase="phase 3 (Working together)"
          />
        </Page>
      )
    case 'project': {
      const project = SAMPLE_PROJECTS.find((p) => p.id === route.id)
      return (
        <Page eyebrow="Project" title={project?.name ?? 'Project not found'}>
          <Coming
            icon={<LayoutGrid size={22} />}
            what="Shared Waiting / Doing / Review / Done board across teams, list and table views, milestones and the item side panel."
            phase="phase 2 (Core model)"
          />
        </Page>
      )
    }
    case 'team': {
      const team = SAMPLE_TEAMS.find((t) => t.id === route.id)
      return (
        <Page eyebrow="Team board" title={team?.name ?? 'Team not found'}>
          <Coming
            icon={<LayoutGrid size={22} />}
            what="The team's own stages with allowed moves, quick add in each column, review approvals and recurring runs."
            phase="phase 2 (Core model)"
          />
        </Page>
      )
    }
    case 'item':
      return (
        <Page eyebrow="Item" title={route.key}>
          <Coming
            icon={<ClipboardList size={22} />}
            what="Stage path, sub-items, reviews, comments, runs history and fields."
            phase="phases 2 and 3"
          />
        </Page>
      )
    case 'plan':
      return (
        <Page title="Calendar and workload">
          <Coming
            icon={<CalendarDays size={22} />}
            what="Items on their due dates with milestones, and each person's weekly load against capacity."
            phase="phase 4 (Views and live updates)"
          />
        </Page>
      )
    case 'dashboard':
      return (
        <Page title="Dashboard">
          <Coming
            icon={<LayoutGrid size={22} />}
            what="How far along each project is, who has what, and what is stuck."
            phase="phase 4 (Views and live updates)"
          />
        </Page>
      )
    case 'requests':
      return (
        <Page title="Requests">
          <Coming
            icon={<ClipboardList size={22} />}
            what="The request form anyone can fill in, and each team's triage list."
            phase="phase 4 (Views and live updates)"
          />
        </Page>
      )
    case 'settings':
      return (
        <Page eyebrow="Team settings" title="Stages, fields and forms">
          <Coming
            icon={<Settings size={22} />}
            what="Stages with their types and allowed moves, library and team fields, forms and recurring schedules."
            phase="phase 2 (Core model)"
          />
        </Page>
      )
    case 'kit':
      return (
        <Page
          eyebrow="Design system"
          title="Component kit"
          intro="Every Midnight component in its states (specs/design-system.md)."
        >
          <KitPage />
        </Page>
      )
    case 'not-found':
      return (
        <Page title="Page not found">
          <Card>
            <EmptyState
              icon={<Shapes size={22} />}
              title="Nothing at this address"
              text={`#/m${route.path}`}
              action={<a href={hrefFor({ page: 'home' })}>Go to My work</a>}
            />
          </Card>
        </Page>
      )
  }
}
