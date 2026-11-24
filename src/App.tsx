import { FolderKanban } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AppContext, INITIAL_UI, makeActions, type AppValue, type Ui } from './components/context'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Shell } from './components/Shell'
import { writeNote } from './lib/format/note'
import type { Task } from './lib/model/types'
import { THEME_EVENT } from './lib/sn/bridge'
import type { Store } from './lib/store'
import { applyTheme } from './lib/theme'

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function Start({ store, other }: { store: Store; other: string | null }) {
  const [name, setName] = useState('')
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return (
    <div className="center">
      <div className="start">
        <FolderKanban size={22} className="faint" />
        <h2 style={{ margin: 0, fontSize: 16 }}>{other ? 'This note isn’t a task list' : 'Start a task list'}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {other ? 'Turn it into one: its text stays at the top of the note, untouched.' : 'Projects give your tasks a home. Plan in a list or on a board, and see what’s left at a glance.'}
        </p>
        {state.locked ? (
          <p className="faint">This note is locked.</p>
        ) : (
          <form style={{ width: '100%', display: 'flex', gap: 8 }} onSubmit={(e) => (e.preventDefault(), store.start(name || state.title))}>
            <input aria-label="First project" placeholder={state.title || 'First project, e.g. Website'} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" type="submit" style={{ height: 36 }}>Create project</button>
          </form>
        )}
        {other && <pre className="plain" style={{ textAlign: 'left', maxHeight: '40vh', overflow: 'auto', width: '100%', border: '1px solid var(--line)', borderRadius: 8 }}>{other}</pre>}
      </div>
    </div>
  )
}

function Fallback({ store }: { store: Store }) {
  let text = store.noteText()
  if (!text) {
    try {
      text = writeNote(store.getSnapshot().ws)
    } catch {
      text = ''
    }
  }
  return (
    <div className="scroll" style={{ padding: '16px 20px' }}>
      <p className="muted" style={{ marginTop: 0 }}>Something went wrong drawing your tasks. This is the note’s text, read-only; open the note again to retry.</p>
      <pre className="plain" style={{ whiteSpace: 'pre-wrap', border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>{text}</pre>
    </div>
  )
}

export default function App({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [ui, setUiState] = useState<Ui>(INITIAL_UI)
  const setUi = useCallback((patch: Partial<Ui> | ((ui: Ui) => Partial<Ui>)) => {
    setUiState((u) => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) }))
  }, [])
  const actions = useMemo(() => makeActions(store, setUi), [store, setUi])
  const [visible, setVisible] = useState<Task[]>([])
  const now = useNow()

  useEffect(() => {
    const update = () => applyTheme()
    update()
    window.addEventListener(THEME_EVENT, update)
    return () => window.removeEventListener(THEME_EVENT, update)
  }, [])

  const value: AppValue = { store, state, ui, setUi, actions, visible, setVisible, now }
  return (
    <AppContext.Provider value={value}>
      {state.kind === 'loading' ? (
        <div className="center faint">Loading tasks…</div>
      ) : state.kind === 'empty' || state.kind === 'other' ? (
        <Start store={store} other={state.kind === 'other' ? state.otherText : null} />
      ) : (
        <ErrorBoundary resetKey={store.noteId()} fallback={<Fallback store={store} />}>
          <Shell />
        </ErrorBoundary>
      )}
    </AppContext.Provider>
  )
}
