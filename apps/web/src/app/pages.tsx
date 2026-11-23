import { Shapes } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, EmptyState } from '../design/components'
import type { MRoute } from './routes'
import { HomePage, ItemFullPage, ProjectPage, TeamBoardPage } from './boards'
import { SettingsPage } from './settings'
import { InboxPage } from './inbox'
import { DashboardPage, PlanPage, RequestsPage } from './views'
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

export function PageFor({ route }: { route: MRoute }) {
  switch (route.page) {
    case 'home':
      return <HomePage />
    case 'inbox':
      return <InboxPage />
    case 'project':
      return <ProjectPage projectId={route.id} />
    case 'team':
      return <TeamBoardPage teamId={route.id} />
    case 'item':
      return <ItemFullPage itemKey={route.key} />
    case 'plan':
      return <PlanPage />
    case 'dashboard':
      return <DashboardPage />
    case 'requests':
      return <RequestsPage />
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
