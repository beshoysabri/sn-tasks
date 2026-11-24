import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { writeNote } from './lib/format/note'
import { Store } from './lib/store'
import { demoWorkspace } from './sample/demo'
import { FakeStandardNotes } from './test/fakeStandardNotes'

const flags = vi.hoisted(() => ({ explode: true }))
vi.mock('./components/Shell', () => ({
  Shell: () => {
    if (flags.explode) throw new Error('drawing failed')
    return <p>The tasks</p>
  },
}))

describe('when drawing the tasks fails', () => {
  let host: FakeStandardNotes
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    host = new FakeStandardNotes()
    host.register()
  })
  afterEach(() => {
    host.dispose()
    vi.restoreAllMocks()
  })

  it('shows the note’s text instead of a blank editor, and tries again for the next note', () => {
    const store = new Store(host.bridge)
    host.openNote(writeNote(demoWorkspace()))
    render(<App store={store} />)
    expect(screen.getByText(/Something went wrong drawing your tasks/)).toBeInTheDocument()
    expect(document.querySelector('pre')).toHaveTextContent('### WEB-14 Fix broken signup link on the pricing page')
    expect(host.saves()).toHaveLength(0)
    flags.explode = false
    host.openNote(writeNote(demoWorkspace()), { uuid: 'note-2' })
    expect(screen.getByText('The tasks')).toBeInTheDocument()
  })
})
