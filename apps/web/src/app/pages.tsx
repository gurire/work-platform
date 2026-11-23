import { CalendarDays, ClipboardList, Inbox, LayoutGrid, Shapes } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, EmptyState } from '../design/components'
import type { MRoute } from './routes'
import { HomePage, ItemFullPage, ProjectPage, TeamBoardPage } from './boards'
import { SettingsPage } from './settings'
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

export function PageFor({ route }: { route: MRoute }) {
  switch (route.page) {
    case 'home':
      return <HomePage />
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
    case 'project':
      return <ProjectPage projectId={route.id} />
    case 'team':
      return <TeamBoardPage teamId={route.id} />
    case 'item':
      return <ItemFullPage itemKey={route.key} />
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
      return <SettingsPage teamId={route.teamId} />
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
