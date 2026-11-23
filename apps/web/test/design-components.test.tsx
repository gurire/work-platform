// specs/design-system.md section 9, check 3: status and priority are never colour alone.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Avatar,
  Button,
  IconButton,
  Menu,
  PriorityTag,
  SplitBar,
  StatusTag,
} from '../src/design/components'

describe('Midnight components', () => {
  it('status tags write the stage name, or the type when no name is given', () => {
    expect(renderToStaticMarkup(<StatusTag type="review" name="QA review" />)).toContain(
      'QA review',
    )
    expect(renderToStaticMarkup(<StatusTag type="done" />)).toContain('Done')
  })

  it('priority tags write the priority in words', () => {
    for (const p of ['urgent', 'high', 'medium', 'low'] as const) {
      const html = renderToStaticMarkup(<PriorityTag priority={p} />)
      expect(html.toLowerCase()).toContain(`>${p}<`)
    }
  })

  it('icon-only buttons have a spoken name', () => {
    expect(renderToStaticMarkup(<IconButton label="Close">x</IconButton>)).toContain(
      'aria-label="Close"',
    )
  })

  it('a loading button is disabled and busy', () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>)
    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
  })

  it('disabled menu items stay visible and say why', () => {
    const html = renderToStaticMarkup(
      <Menu
        items={[{ id: 'p', label: 'Published', disabledReason: 'needs 2 approvals' }]}
        onPick={() => {}}
      />,
    )
    expect(html).toContain('Published')
    expect(html).toContain('needs 2 approvals')
  })

  it('split bars describe their numbers in words', () => {
    const html = renderToStaticMarkup(
      <SplitBar counts={{ waiting: 9, doing: 14, review: 5, done: 18 }} />,
    )
    expect(html).toContain('aria-label="Waiting 9, Doing 14, Review 5, Done 18"')
  })

  it('an empty avatar reads as unassigned when not decorative', () => {
    expect(renderToStaticMarkup(<Avatar name={null} decorative={false} />)).toContain('Unassigned')
  })
})
