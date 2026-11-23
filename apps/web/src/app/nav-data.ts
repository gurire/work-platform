/**
 * Placeholder navigation until the new projects and teams API exists (phase 2, Core model).
 * Generated sample names only; no real data.
 */
export interface NavProject {
  id: string
  name: string
  /** One of the eight fixed project colours (specs/data-model.md). */
  colour: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

export interface NavTeam {
  id: string
  name: string
}

export const SAMPLE_PROJECTS: readonly NavProject[] = [
  { id: 'census-refresh', name: 'Census data refresh', colour: 1 },
  { id: 'field-app', name: 'Field app v2', colour: 2 },
  { id: 'summit', name: 'Annual summit', colour: 3 },
  { id: 'it-requests', name: 'IT requests', colour: 4 },
]

export const SAMPLE_TEAMS: readonly NavTeam[] = [
  { id: 'data', name: 'Data team' },
  { id: 'software', name: 'Software team' },
  { id: 'ops', name: 'Ops & Events' },
]
