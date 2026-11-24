import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { readNote, writeNote } from './lib/format/note'
import type { Priority } from './lib/model/types'
import { Store } from './lib/store'
import { demoWorkspace } from './sample/demo'
import { FakeStandardNotes } from './test/fakeStandardNotes'

const savedText = (host: FakeStandardNotes) => {
  const saves = host.saves()
  const items = saves[saves.length - 1]?.data.items as { content: { text: string } }[] | undefined
  return items?.[0]?.content.text ?? ''
}

const PRIORITIES: Record<string, Priority> = { Urgent: 1, High: 2, Medium: 3, Low: 4 }

/** Opens the priority picker on the first task and picks a priority it doesn't have yet. */
async function changeFirstPriority(user: ReturnType<typeof userEvent.setup>): Promise<Priority> {
  await user.keyboard('j')
  await user.keyboard('p')
  await screen.findByRole('listbox')
  const option = screen.getAllByRole('option').find((o) => !o.querySelector('[aria-label="current"]') && /Urgent|High|Medium|Low/.test(o.textContent ?? ''))!
  const name = Object.keys(PRIORITIES).find((n) => option.textContent?.includes(n))!
  await user.click(option)
  return PRIORITIES[name]
}

describe('the editor inside a fake Standard Notes', () => {
  let host: FakeStandardNotes
  let store: Store
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  beforeEach(() => {
    host = new FakeStandardNotes()
    store = new Store(host.bridge)
    host.register()
  })
  afterEach(() => host.dispose())

  it('starts a task list in an empty note and adds a task with quick add', async () => {
    const user = userEvent.setup()
    host.openNote('')
    render(<App store={store} />)
    await user.type(screen.getByLabelText('First project'), 'Errands')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    await user.keyboard('c')
    await user.type(await screen.findByLabelText('Task title'), 'Buy stamps #post !high{Enter}')
    await waitFor(() => expect(document.querySelector('[data-task-row]')).toHaveTextContent('Buy stamps'))
    await waitFor(() => expect(savedText(host)).toMatch(/### ERR-1 Buy stamps\n- Status: Todo\n- Priority: High\n- Labels: post\n/i))
  })

  it('changes the focused task from the keyboard and saves only that change', async () => {
    const user = userEvent.setup()
    const before = demoWorkspace()
    host.openNote(writeNote(before))
    render(<App store={store} />)
    const priority = await changeFirstPriority(user)
    await waitFor(() => expect(host.saves().length).toBeGreaterThan(0))
    const after = readNote(savedText(host)).workspace
    const changed = after.tasks.filter((t) => t.priority !== before.tasks.find((b) => b.id === t.id)?.priority)
    expect(changed).toHaveLength(1)
    expect(changed[0].priority).toBe(priority)
    expect(after.tasks).toHaveLength(before.tasks.length)
  })

  it('opens a Kanban Board note as it is and converts it on the first change', async () => {
    const user = userEvent.setup()
    host.openNote('@title: Errands\n@status: To Do\n@status: Done\n\n* Buy stamps\n  * Status: To Do\n* Post the letter\n  * Status: Done\n')
    render(<App store={store} />)
    expect(await screen.findByText('From Kanban Board')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(host.saves()).toHaveLength(0)
    await changeFirstPriority(user)
    await waitFor(() => expect(savedText(host)).toMatch(/^---\ntasks: 1\n/))
    expect(savedText(host)).toContain(' Buy stamps\n')
    expect(savedText(host)).toContain(' Post the letter\n')
    await waitFor(() => expect(screen.queryByText('From Kanban Board')).not.toBeInTheDocument())
  })
})
