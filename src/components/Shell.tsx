/* eslint-disable react-hooks/preserve-manual-memoization -- the React Compiler isn’t used; these memos only keep list building off hover renders */
import { Archive, CalendarDays, ChevronRight, CircleCheck, CircleSlash, Copy, FolderKanban, Keyboard, Layers, Menu as MenuIcon, MoreHorizontal, PanelLeft, Plus, Search, Settings, Tag, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PROJECT_STATUSES } from '../lib/model/defaults'
import type { Filter, Task } from '../lib/model/types'
import { identifier, isClosed, newId, projectOf, statusOf } from '../lib/model/workspace'
import * as ops from '../lib/ops'
import { filterTasks, upNext } from '../lib/query'
import { resolveDisplay, type Location } from '../lib/store'
import { cycleName, cycleRange, openCount as cycleOpen, readyToClose } from '../lib/cycles'
import { today } from '../lib/model/workspace'
import { boardColumns, listRows, scopeTasks, searchTasks } from '../lib/view'
import { CompleteCycleDialog, CycleIcon, CycleSummary } from './CycleViews'
import { ProjectActivity, ProjectLinks } from './ProjectActivity'
import { useApp, type PickerKind } from './context'
import { EntityIcon, ENTITY_ICONS, PriorityIcon, StatusIcon } from './icons'
import { TaskList } from './TaskList'
import { DisplayMenu, FilterBar } from './Toolbar'
import { ConfirmDialog, copyText, Markdown, ToastView, useDismiss } from './ui'

// Opened on demand, so their code (drag and drop, dates, Markdown) stays out of the first load.
const Board = lazy(() => import('./Board').then((m) => ({ default: m.Board })))
const TableView = lazy(() => import('./TableView').then((m) => ({ default: m.TableView })))
const TaskDetail = lazy(() => import('./TaskDetail').then((m) => ({ default: m.TaskDetail })))
const Picker = lazy(() => import('./Picker').then((m) => ({ default: m.Picker })))
const CreateDialog = lazy(() => import('./CreateDialog').then((m) => ({ default: m.CreateDialog })))
const SpaceOverview = lazy(() => import('./SpaceOverview').then((m) => ({ default: m.SpaceOverview })))
const WorkspaceSettings = lazy(() => import('./WorkspaceSettings').then((m) => ({ default: m.WorkspaceSettings })))

const LETTERS: Record<string, PickerKind> = { s: 'status', p: 'priority', l: 'labels', d: 'due', m: 'project', t: 'type', b: 'bucket', y: 'cycle' }
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

function locKey(loc: Location): string {
  if (loc.kind === 'project') return loc.tab.startsWith('filter:') ? `project:${loc.id}/${loc.tab}` : `project:${loc.id}`
  if (loc.kind === 'filter') return `filter:${loc.id}`
  if (loc.kind === 'space') return `space:${loc.id}`
  if (loc.kind === 'cycle') return `cycle:${loc.id}`
  return loc.kind
}

export function Shell() {
  const { state, store, ui, setUi, now, setVisible, visible } = useApp()
  const ws = state.ws
  const loc: Location = useMemo(() => {
    const l = state.view.location
    if (l?.kind === 'project' && ws.projects.some((p) => p.id === l.id)) return l
    if (l?.kind === 'filter' && ws.filters.some((f) => f.id === l.id)) return l
    if (l?.kind === 'no-project' || l?.kind === 'settings') return l
    if (l?.kind === 'space' && ws.spaces.some((s) => s.id === l.id)) return l
    if (l?.kind === 'cycle' && ws.cycles.some((c) => c.id === l.id)) return l
    const first = ws.projects.find((p) => !p.archived)
    return first ? { kind: 'project', id: first.id, tab: 'tasks' } : { kind: 'no-project' }
  }, [state.view.location, ws.projects, ws.filters, ws.spaces, ws.cycles])
  const go = (location: Location) => {
    store.setView({ location })
    setUi({ selection: [], focus: null, peek: null, page: null, drawer: false })
  }
  const project = loc.kind === 'project' ? ws.projects.find((p) => p.id === loc.id) : undefined
  const space = loc.kind === 'space' ? ws.spaces.find((s) => s.id === loc.id) : undefined
  const cycle = loc.kind === 'cycle' ? ws.cycles.find((c) => c.id === loc.id) : undefined
  const [completing, setCompleting] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const filter = loc.kind === 'filter' ? ws.filters.find((f) => f.id === loc.id) : loc.kind === 'project' && loc.tab.startsWith('filter:') ? ws.filters.find((f) => f.id === loc.tab.slice(7)) : undefined
  const key = locKey(loc)
  const savedDisplay = state.view.display
  const display = useMemo(() => resolveDisplay(savedDisplay, key), [savedDisplay, key])
  const savedQuery = filter?.query ?? (loc.kind === 'project' && loc.tab === 'tasks' ? (project?.query ?? '') : '')
  const search = ui.search[key] ?? savedQuery
  const setSearch = (q: string) => setUi((u) => ({ search: { ...u.search, [key]: q } }))
  const scope = useMemo(() => scopeTasks(ws, loc), [ws, loc])
  const effective = filter && loc.kind === 'project' ? `${search}` : search

  const collapsed = state.view.collapsed[key]
  const openClosed = ui.openClosed
  const projectId = project?.id
  const { rows, visible: rowsVisible } = useMemo(
    () => listRows({ ws, tasks: scope, search: effective, display, collapsed: collapsed ?? [], openClosed: new Set(openClosed), now, projectId }),
    [ws, scope, effective, display, collapsed, openClosed, now, projectId],
  )
  const boardCols = useMemo(() => (display.layout === 'board' ? boardColumns(ws, searchTasks(ws, scope, effective, now), display.columns, projectId) : []), [display, ws, scope, effective, now, projectId])
  const visibleTasks = useMemo(() => (display.layout === 'board' ? boardCols.flatMap((c) => c.tasks) : rowsVisible), [display.layout, boardCols, rowsVisible])
  useEffect(() => setVisible(visibleTasks), [visibleTasks, setVisible])

  // Fetch the on-demand parts once the list is up, so the first C or Space doesn't wait for them.
  useEffect(() => {
    const timer = setTimeout(() => {
      void import('./CreateDialog')
      void import('./Picker')
      void import('./TaskDetail')
      void import('./Board')
      void import('./TableView')
      void import('./WorkspaceSettings')
    }, 800)
    return () => clearTimeout(timer)
  }, [])

  const createDefaults = (defaults?: Partial<ops.NewTask> | null) => setUi({ creating: { ...(project ? { project: project.id } : space ? { space: space.id } : {}), ...(cycle && cycle.state !== 'ended' ? { cycle: cycle.id } : {}), ...(defaults ?? {}) } })
  const openTask = useCallback((task: Task, page: boolean) => {
    const narrow = window.innerWidth < 900
    if (page || narrow) setUi({ page: task.id, peek: null, focus: task.id })
    else setUi((u) => ({ peek: u.peek === task.id ? null : task.id, focus: task.id }))
  }, [setUi])

  // ───── keys ─────
  const stateRef = useRef({ ui, visible, loc })
  useLayoutEffect(() => {
    stateRef.current = { ui, visible, loc }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ui, visible } = stateRef.current
      if (e.defaultPrevented) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !typing(e.target)) {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setUi({ command: !ui.command })
        return
      }
      if (ui.picker || ui.creating || ui.confirm || ui.menu || ui.command || typing(e.target)) return
      const open = ui.page ?? ui.peek
      const targets = ui.selection.length ? ui.selection : ui.focus ? [ui.focus] : open ? [open] : []
      const move = (delta: number) => {
        if (!visible.length) return
        const at = visible.findIndex((t) => t.id === (open ?? ui.focus))
        const next = visible[Math.max(0, Math.min(visible.length - 1, at < 0 ? 0 : at + delta))]
        setUi((u) => ({ focus: next.id, ...(u.peek ? { peek: next.id } : {}), ...(u.page ? { page: next.id } : {}) }))
        document.querySelector(`[data-task-row="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      let handled = true
      if (mod && e.key === 'Enter' && ui.peek) setUi({ page: ui.peek, peek: null })
      else if (mod && e.key.toLowerCase() === 'a') setUi({ selection: visible.map((t) => t.id) })
      else if (mod || e.altKey) handled = false
      else if (e.key === '/') document.querySelector<HTMLInputElement>('.searchbox input')?.focus()
      else if (e.key === '?') setUi({ help: !ui.help })
      else if (e.key === 'j' || e.key === 'ArrowDown') {
        if (e.shiftKey) extend(1)
        else move(1)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        if (e.shiftKey) extend(-1)
        else move(-1)
      }
      else if (e.key === 'J') extend(1)
      else if (e.key === 'K') extend(-1)
      else if (e.key === 'x' && ui.focus) setUi((u) => ({ selection: u.selection.includes(u.focus!) ? u.selection.filter((s) => s !== u.focus) : [...u.selection, u.focus!] }))
      else if ((e.key === 'Enter' || e.key === 'o') && (ui.focus || ui.peek)) setUi({ page: ui.peek ?? ui.focus, peek: null })
      else if (e.key === ' ' && (ui.focus || ui.peek)) {
        const id = ui.focus ?? ui.peek!
        setUi((u) => ({ peek: u.peek === id ? null : id }))
      } else if (e.key === 'Escape') {
        if (ui.page) setUi({ page: null })
        else if (ui.peek) setUi({ peek: null })
        else if (ui.selection.length) setUi({ selection: [] })
        else if (ui.drawer) setUi({ drawer: false })
        else setUi({ focus: null })
      } else if (e.key === 'c' && open) window.dispatchEvent(new Event('tasks:focus-comment'))
      else if (e.key === 'e' && open) window.dispatchEvent(new Event('tasks:focus-title'))
      else if (e.key === 'c') createDefaults()
      else if (LETTERS[e.key] && targets.length && !state.locked) setUi({ picker: { kind: LETTERS[e.key], ids: targets } })
      else handled = false
      if (handled) e.preventDefault()

      function extend(delta: number) {
        if (!visible.length) return
        const at = visible.findIndex((t) => t.id === ui.focus)
        const next = visible[Math.max(0, Math.min(visible.length - 1, at + delta))]
        setUi((u) => ({ focus: next.id, selection: [...new Set([...u.selection, ...(u.focus ? [u.focus] : []), next.id])] }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, setUi, state.locked])

  const openId = ui.page ?? ui.peek
  const openTaskObj = openId ? ws.tasks.find((t) => t.id === openId) : undefined
  const index = openTaskObj ? visible.findIndex((t) => t.id === openTaskObj.id) : -1
  const step = (delta: 1 | -1) => {
    if (!visible.length) return
    const next = visible[Math.max(0, Math.min(visible.length - 1, (index < 0 ? 0 : index) + delta))]
    setUi((u) => ({ focus: next.id, ...(u.peek ? { peek: next.id } : { page: next.id }) }))
  }
  const title = loc.kind === 'settings' ? 'Settings' : cycle ? cycleName(cycle) : space ? space.name : filter && loc.kind === 'filter' ? filter.name : project?.name ?? (loc.kind === 'no-project' ? 'No project' : 'Tasks')
  const openCount = scope.filter((t) => !t.archived && !isClosed(ws, t)).length
  const showProject = loc.kind !== 'project'

  const content = () => {
    if (loc.kind === 'settings') return <WorkspaceSettings page={loc.page} onPage={(page) => go({ kind: 'settings', page })} />
    if (loc.kind === 'space' && loc.tab === 'overview' && space) return <SpaceOverview spaceId={space.id} onOpenProject={(id) => go({ kind: 'project', id, tab: 'tasks' })} onOpenTask={(t) => setUi({ page: t.id, focus: t.id })} onCreate={(d) => createDefaults(d)} />
    if (loc.kind === 'project' && loc.tab === 'overview' && project) return <Overview projectId={project.id} />
    if (loc.kind === 'project' && loc.tab === 'settings' && project) return <ProjectSettings projectId={project.id} onDeleted={() => go({ kind: 'no-project' })} />
    const empty = !rows.length && display.layout !== 'board'
    return (
      <>
        <div className="toolbar">
          <FilterBar value={search} onChange={setSearch} />
          {search.trim() !== savedQuery.trim() && (loc.kind !== 'no-project') && (
            <span className="save-split">
              <button onClick={() => store.apply('Saved search', (d) => {
                if (filter) ops.saveFilter(d, { ...filter, query: search })
                else if (project) ops.updateProject(d, project.id, { query: search || undefined })
              })}>Save</button>
              <button title="Save as a new filter" aria-label="Save as filter" onClick={() => {
                const id = newId()
                const name = search.replace(/\b\w+:/g, '').trim() || 'New filter'
                store.apply('New filter', (d) => ops.saveFilter(d, { id, name: name.slice(0, 40), query: search, project: project?.id } as Filter))
                if (project) go({ kind: 'project', id: project.id, tab: `filter:${id}` })
              }}><Plus size={13} /></button>
            </span>
          )}
          <DisplayMenu options={display} onChange={(p) => store.setDisplay(key, p)} allowProject={showProject} />
        </div>
        {display.layout === 'board' ? (
          <div className="scroll" style={{ overflowX: display.wrap ? 'hidden' : 'auto' }}>
            <Board columns={boardCols} display={display} onOpen={openTask} onCreate={createDefaults} />
          </div>
        ) : empty ? (
          <Empty searching={!!search.trim()} onClear={() => setSearch('')} onAdd={() => createDefaults()} filter={loc.kind === 'filter'} />
        ) : display.layout === 'table' ? (
          <TableView rows={rows} listKey={key} onOpen={openTask} showProject={showProject} />
        ) : (
          <div className="scroll"><TaskList rows={rows} listKey={key} onOpen={openTask} onCreate={createDefaults} /></div>
        )}
      </>
    )
  }

  return (
    <div className={`app${ui.drawer ? ' drawer' : ''}`}>
      <Suspense fallback={null}>
      {state.view.sidebar !== false && <Sidebar loc={loc} go={go} />}
      <main className="main" onClick={() => ui.drawer && setUi({ drawer: false })}>
        {ui.page && openTaskObj ? (
          <div className="page" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', containerType: 'inline-size', containerName: 'detail' }}>
            <TaskDetail key={openTaskObj.id} task={openTaskObj} mode="page" index={index} total={visible.length} onClose={() => setUi({ page: null })} onStep={step} onOpenPage={() => {}} onOpenTask={(t) => setUi({ page: t.id, focus: t.id })} backLabel={title} />
          </div>
        ) : (
          <>
            <header className="head">
              <button className="icon-btn phone-only" aria-label="Menu" onClick={(e) => (e.stopPropagation(), setUi({ drawer: true }))}><MenuIcon size={18} /></button>
              {state.view.sidebar === false && <button className="icon-btn desk-only" aria-label="Show sidebar" onClick={() => store.setView({ sidebar: true })}><PanelLeft size={15} /></button>}
              {space ? <EntityIcon name={space.icon} color={space.color} size={16} fallback={Layers} /> : project ? <EntityIcon name={project.icon} color={project.color} size={16} /> : loc.kind === 'no-project' ? <CircleSlash size={15} className="faint" /> : <CalendarDays size={15} className="faint" />}
              {renaming !== null && (project || space) ? (
                <input autoFocus aria-label="Name" value={renaming} onChange={(e) => setRenaming(e.target.value)} style={{ font: 'inherit', fontWeight: 600, fontSize: 13.5, border: '1px solid var(--line-2)', borderRadius: 6, padding: '2px 6px', background: 'var(--bg)' }}
                  onBlur={() => {
                    const name = renaming.trim()
                    if (name && project && name !== project.name) store.apply('Renamed project', (d) => ops.updateProject(d, project.id, { name }))
                    if (name && space && name !== space.name && !/[,"]/.test(name)) store.apply('Renamed space', (d) => ops.updateSpace(d, space.id, { name }))
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <h1 onDoubleClick={() => !state.locked && (project || space) && setRenaming((project ?? space)!.name)} title={project || space ? 'Double-click to rename' : undefined}>{title}</h1>
              )}
              {project && <ProjectMenu projectId={project.id} onDeleted={() => go({ kind: 'no-project' })} />}
              {space && <SpaceMenu spaceId={space.id} onDeleted={() => go({ kind: 'no-project' })} />}
              {cycle && <span className="faint" style={{ fontSize: 12 }}>{cycleRange(cycle)}</span>}
              {cycle && readyToClose(cycle, today()) && <span className="badge">Ready to close</span>}
              {cycle?.state === 'ended' && <span className="badge">Ended</span>}
              {cycle?.state === 'active' && !state.locked && <button className="btn" onClick={() => setCompleting(true)}>Complete cycle</button>}
              {loc.kind !== 'settings' && <span className="count num" title={`${openCount} open`}>{openCount}</span>}
              {state.converting && <span className="badge" title="This note was a Kanban board; it is saved in the Tasks format on your first change.">From Kanban Board</span>}
              {state.locked && <span className="badge">Locked</span>}
              <span className="spacer" />
              {!state.locked && <button className="btn desk-only" onClick={() => createDefaults()} title="New task (C)"><Plus size={14} />New task</button>}
            </header>
            {space && (
              <nav className="tabs" role="tablist" aria-label="Space tabs">
                {(['overview', 'tasks'] as const).map((tab) => (
                  <button key={tab} role="tab" className="tab" aria-selected={loc.kind === 'space' && loc.tab === tab} onClick={() => go({ kind: 'space', id: space.id, tab })}>{tab === 'overview' ? 'Overview' : 'Tasks'}</button>
                ))}
              </nav>
            )}
            {project && (
              <nav className="tabs" role="tablist" aria-label="Project tabs">
                {(['overview', 'tasks'] as const).map((tab) => (
                  <button key={tab} role="tab" className="tab" aria-selected={loc.kind === 'project' && loc.tab === tab} onClick={() => go({ kind: 'project', id: project.id, tab })}>{tab === 'overview' ? 'Overview' : 'Tasks'}</button>
                ))}
                {ws.filters.filter((f) => f.project === project.id).map((f) => (
                  <button key={f.id} role="tab" className="tab" aria-selected={loc.kind === 'project' && loc.tab === `filter:${f.id}`} onClick={() => go({ kind: 'project', id: project.id, tab: `filter:${f.id}` })} onContextMenu={(e) => {
                    e.preventDefault()
                    setUi({ confirm: { title: 'Delete filter?', body: `“${f.name}” will be removed. Its tasks are not affected.`, confirm: 'Delete filter', danger: true, run: () => (store.apply('Deleted filter', (d) => ops.deleteFilter(d, f.id), 'undo'), go({ kind: 'project', id: project.id, tab: 'tasks' })) } })
                  }}>
                    <CalendarDays size={13} />{f.name}
                  </button>
                ))}
                <span className="right">
                  <button role="tab" className="tab" aria-selected={loc.kind === 'project' && loc.tab === 'settings'} onClick={() => go({ kind: 'project', id: project.id, tab: 'settings' })}><Settings size={14} />Settings</button>
                </span>
              </nav>
            )}
            {cycle && <CycleSummary cycle={cycle} />}
            <div className="split">
              <div className="pane">{content()}</div>
              {ui.peek && openTaskObj && (
                <aside className="peek" style={{ width: Math.min(state.view.peekWidth, 720) }} aria-label="Task preview">
                  <PeekResize />
                  <TaskDetail key={openTaskObj.id} task={openTaskObj} mode="peek" index={index} total={visible.length} onClose={() => setUi({ peek: null })} onStep={step} onOpenPage={() => setUi({ page: openTaskObj.id, peek: null })} onOpenTask={(t) => setUi({ peek: t.id, focus: t.id })} backLabel={title} />
                </aside>
              )}
            </div>
            {!state.locked && <button className="fab" aria-label="New task" onClick={() => createDefaults()}><Plus size={26} /></button>}
            {ui.selection.length > 0 && <SelectionBar />}
          </>
        )}
      </main>
      <ContextMenu />
      {ui.picker && <Picker key={`${ui.picker.kind}:${ui.picker.ids.join(',')}`} />}
      {ui.creating && <CreateDialog init={ui.creating} />}
      <ConfirmDialog />
      {ui.command && <CommandPalette go={go} />}
      {ui.help && <Help />}
      {completing && cycle && <CompleteCycleDialog cycleId={cycle.id} onClose={() => setCompleting(false)} />}
      <ToastView />
      </Suspense>
    </div>
  )
}

function PeekResize() {
  const { state, store } = useApp()
  return (
    <div
      className="resize"
      role="separator"
      aria-label="Resize preview"
      onDoubleClick={() => store.setView({ peekWidth: 480 })}
      onPointerDown={(e) => {
        const startX = e.clientX
        const start = state.view.peekWidth
        const move = (ev: PointerEvent) => store.setView({ peekWidth: Math.max(380, Math.min(720, start + (startX - ev.clientX))) })
        const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up))
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}

function Empty({ searching, onClear, onAdd, filter }: { searching: boolean; onClear: () => void; onAdd: () => void; filter: boolean }) {
  const { state } = useApp()
  if (searching)
    return (
      <div className="empty"><Search size={20} className="faint" /><h2>Nothing matches</h2><p>Try a different search or filter.</p><button className="btn" onClick={onClear}>Clear filters</button></div>
    )
  return (
    <div className="empty">
      <FolderKanban size={20} className="faint" />
      <h2>{filter ? 'Nothing in this filter' : 'A little room to think'}</h2>
      <p>{filter ? 'Enjoy the quiet.' : 'Start with one task. The rest can follow.'}</p>
      {!state.locked && <button className="btn" onClick={onAdd}>Add a task</button>}
    </div>
  )
}

// ───────────────────────── sidebar ─────────────────────────

function Sidebar({ loc, go }: { loc: Location; go: (l: Location) => void }) {
  const { state, store, setUi, now } = useApp()
  const ws = state.ws
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [addingSpace, setAddingSpace] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const counts = useMemo(() => {
    const open = (t: Task) => !t.archived && !isClosed(ws, t)
    const byProject = new Map<string, number>()
    for (const t of ws.tasks) if (open(t) && t.project) byProject.set(t.project, (byProject.get(t.project) ?? 0) + 1)
    return { byProject, noProject: ws.tasks.filter((t) => open(t) && !t.project).length }
  }, [ws])
  const filterCount = (f: Filter) => filterTasks(ws, ws.tasks.filter((t) => !projectOf(ws, t)?.archived), f.query, now).length
  const current = (l: Location) => JSON.stringify(l) === JSON.stringify(loc) || (l.kind === 'project' && loc.kind === 'project' && l.id === loc.id)
  const projectRow = (id: string, sub = false) => {
    const p = ws.projects.find((x) => x.id === id)!
    return (
      <button key={p.id} className={`sb-item${sub ? ' sub' : ''}`} aria-current={current({ kind: 'project', id: p.id, tab: 'tasks' }) ? 'page' : undefined} onClick={() => go({ kind: 'project', id: p.id, tab: loc.kind === 'project' && loc.id === p.id ? loc.tab : 'tasks' })}>
        <EntityIcon name={p.icon} color={p.color} size={14} />
        <span className="name">{p.name}</span>
        <span className="count num">{counts.byProject.get(p.id) ?? ''}</span>
      </button>
    )
  }
  const shared = ws.filters.filter((f) => !f.project && !f.space)
  const liveSpaces = new Set(ws.spaces.filter((s) => !s.archived).map((s) => s.id))
  const loose = ws.projects.filter((p) => !p.archived && (!p.space || !ws.spaces.some((s) => s.id === p.space)))
  // Archived spaces, archived projects, and the projects of an archived space: out of the way, still reachable.
  const archived = [
    ...ws.spaces.filter((s) => s.archived).map((item) => ({ kind: 'space' as const, item })),
    ...ws.projects.filter((p) => p.archived || (p.space && !liveSpaces.has(p.space) && ws.spaces.some((s) => s.id === p.space))).map((item) => ({ kind: 'project' as const, item })),
  ]
  return (
    <aside className="sidebar" aria-label="Tasks">
      <div className="sb-top">
        <div className="sb-ws"><span className="ws-badge">{(state.title || 'T')[0].toUpperCase()}</span><span>{state.title || 'Tasks'}</span></div>
        <button className="icon-btn desk-only" aria-label="Hide sidebar" onClick={() => store.setView({ sidebar: false })}><PanelLeft size={15} /></button>
        <button className="icon-btn phone-only" aria-label="Close" onClick={() => setUi({ drawer: false })}><X size={16} /></button>
      </div>
      <button className="sb-search" onClick={() => setUi({ command: true })}><Search size={14} /><span>Search or jump to…</span><kbd>⌘K</kbd></button>
      <div className="scroll">
        <div className="sb-section">Filters</div>
        {shared.map((f) => (
          <button key={f.id} className="sb-item" aria-current={current({ kind: 'filter', id: f.id }) ? 'page' : undefined} onClick={() => go({ kind: 'filter', id: f.id })}>
            {f.id === 'recently-completed' ? <CircleCheck size={14} style={{ color: f.color ?? 'var(--review)' }} /> : <CalendarDays size={14} className="faint" />}
            <span className="name">{f.name}</span>
            <span className="count num">{filterCount(f) || ''}</span>
          </button>
        ))}
        {ws.cycleSettings.enabled && ws.cycles.length > 0 && <div className="sb-section">Cycles</div>}
        {ws.cycleSettings.enabled && [...ws.cycles].sort((a, b) => ['active', 'upcoming', 'ended'].indexOf(a.state) - ['active', 'upcoming', 'ended'].indexOf(b.state) || b.start.localeCompare(a.start)).slice(0, 4).map((c) => (
          <button key={c.id} className="sb-item" aria-current={loc.kind === 'cycle' && loc.id === c.id ? 'page' : undefined} onClick={() => go({ kind: 'cycle', id: c.id })}>
            <CycleIcon size={14} className="faint" />
            <span className="name">{cycleName(c)}</span>
            <span className="faint" style={{ fontSize: 11 }}>{cycleRange(c)}</span>
            <span className="count num">{cycleOpen(ws, c.id) || ''}</span>
          </button>
        ))}
        <div className="sb-section">
          Spaces
          <span className="acts">{!state.locked && <button className="icon-btn" aria-label="New space" title="New space" onClick={() => setAddingSpace(true)}><Plus size={14} /></button>}</span>
        </div>
        {!ws.spaces.some((s) => !s.archived) && !addingSpace && <div className="sb-hint">Group projects into ongoing areas</div>}
        {addingSpace && (
          <div className="sb-item">
            <Layers size={14} className="faint" />
            <input autoFocus aria-label="Space name" placeholder="A space you keep up, e.g. Home" value={spaceName} style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, minWidth: 0 }}
              onChange={(e) => setSpaceName(e.target.value)} onBlur={() => !spaceName.trim() && setAddingSpace(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && spaceName.trim()) {
                  const id = newId()
                  if (store.apply(`Created ${spaceName.trim()}`, (d) => void ops.createSpace(d, spaceName, id))) go({ kind: 'space', id, tab: 'overview' })
                  setSpaceName('')
                  setAddingSpace(false)
                }
                if (e.key === 'Escape') {
                  setSpaceName('')
                  setAddingSpace(false)
                }
              }} />
          </div>
        )}
        {ws.spaces.filter((s) => !s.archived).map((s) => (
          <div key={s.id}>
            <button className="sb-item" aria-current={loc.kind === 'space' && loc.id === s.id ? 'page' : undefined} onClick={() => go({ kind: 'space', id: s.id, tab: 'overview' })}><EntityIcon name={s.icon} color={s.color} size={14} fallback={Layers} /><span className="name">{s.name}</span></button>
            {ws.projects.filter((p) => p.space === s.id && !p.archived).map((p) => projectRow(p.id, true))}
          </div>
        ))}
        <div className="sb-section">
          Projects
          <span className="acts">{!state.locked && <button className="icon-btn" aria-label="New project" title="New project" onClick={() => setAdding(true)}><Plus size={14} /></button>}</span>
        </div>
        {loose.map((p) => projectRow(p.id))}
        {adding && (
          <div className="sb-item">
            <FolderKanban size={14} className="faint" />
            <input
              autoFocus
              aria-label="Project name"
              placeholder="Project name"
              value={name}
              style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, minWidth: 0 }}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name.trim() && setAdding(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  const id = newId()
                  store.apply(`Created ${name.trim()}`, (d) => {
                    ops.createProject(d, { name, icon: Object.keys(ENTITY_ICONS)[Math.floor(Math.random() * 20)] }, id)
                  })
                  setName('')
                  setAdding(false)
                  go({ kind: 'project', id, tab: 'tasks' })
                }
                if (e.key === 'Escape') {
                  setName('')
                  setAdding(false)
                }
              }}
            />
          </div>
        )}
        {(counts.noProject > 0 || ws.tasks.some((t) => !t.project)) && (
          <button className="sb-item" aria-current={loc.kind === 'no-project' ? 'page' : undefined} onClick={() => go({ kind: 'no-project' })}>
            <CircleSlash size={14} className="faint" />
            <span className="name">No project</span>
            <span className="count num">{counts.noProject || ''}</span>
          </button>
        )}
        <button className="sb-item" style={{ marginTop: 12 }} aria-current={loc.kind === 'settings' ? 'page' : undefined} onClick={() => go({ kind: 'settings', page: 'general' })}>
          <Settings size={14} className="faint" />
          <span className="name">Settings</span>
        </button>
        {archived.length > 0 && (
          <>
            <button className="sb-item faint" style={{ marginTop: 4 }} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
              <Archive size={14} />
              <span className="name">{archived.length} archived</span>
              <ChevronRight size={13} className={`chev${showArchived ? ' open' : ''}`} aria-hidden />
            </button>
            {showArchived && archived.map((x) => x.kind === 'space' ? (
              <button key={x.item.id} className="sb-item sub" aria-current={loc.kind === 'space' && loc.id === x.item.id ? 'page' : undefined} onClick={() => go({ kind: 'space', id: x.item.id, tab: 'overview' })}><EntityIcon name={x.item.icon} color={x.item.color} size={14} fallback={Layers} /><span className="name">{x.item.name}</span></button>
            ) : projectRow(x.item.id, true))}
          </>
        )}
      </div>
    </aside>
  )
}

function ProjectMenu({ projectId, onDeleted }: { projectId: string; onDeleted: () => void }) {
  const { state, store, setUi } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, () => setOpen(false), open)
  const p = state.ws.projects.find((x) => x.id === projectId)
  if (!p) return null
  const n = state.ws.tasks.filter((t) => t.project === p.id).length
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" aria-label="Project actions" onClick={() => setOpen(!open)}><MoreHorizontal size={15} /></button>
      {open && (
        <div className="menu" style={{ position: 'absolute', top: 32, left: 0 }}>
          <button className="mi" onClick={() => (copyText(`${p.key} · ${p.name}`), setOpen(false), store.toast('Copied'))}><Copy size={14} />Copy key</button>
          <button className="mi" onClick={() => (store.apply(p.status === 'completed' ? `Reopened ${p.name}` : `Completed ${p.name}`, (d) => ops.updateProject(d, p.id, { status: p.status === 'completed' ? 'in-progress' : 'completed' }), 'undo'), setOpen(false))}><CircleCheck size={14} />{p.status === 'completed' ? 'Reopen project' : 'Mark project completed'}</button>
          <div className="msep" />
          <button className="mi" onClick={() => (store.apply(p.archived ? `Restored ${p.name}` : `Archived ${p.name}`, (d) => ops.updateProject(d, p.id, { archived: !p.archived }), 'undo'), setOpen(false))}><Archive size={14} />{p.archived ? 'Restore project' : 'Archive project'}</button>
          <button className="mi danger" onClick={() => {
            setOpen(false)
            setUi({ confirm: { title: `Delete project ${p.name}`, body: `This project${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''} will be deleted. You can undo this until you close the note.`, confirm: 'Delete project', danger: true, run: () => (store.apply(`Deleted ${p.name}`, (d) => ops.deleteProject(d, p.id), 'undo'), onDeleted()) } })
          }}><Trash2 size={14} />Delete project</button>
        </div>
      )}
    </div>
  )
}

function SpaceMenu({ spaceId, onDeleted }: { spaceId: string; onDeleted: () => void }) {
  const { state, store, setUi } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, () => setOpen(false), open)
  const sp = state.ws.spaces.find((x) => x.id === spaceId)
  if (!sp) return null
  const n = state.ws.projects.filter((p) => p.space === sp.id).length
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" aria-label="Space actions" onClick={() => setOpen(!open)}><MoreHorizontal size={15} /></button>
      {open && (
        <div className="menu" style={{ position: 'absolute', top: 32, left: 0 }}>
          <div className="mhead">Icon</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 6px 6px', maxWidth: 230 }}>
            {Object.keys(ENTITY_ICONS).slice(0, 18).map((icon) => (
              <button key={icon} className="icon-btn" aria-label={icon} onClick={() => store.apply('Space icon', (d) => ops.updateSpace(d, sp.id, { icon }))}><EntityIcon name={icon} size={14} /></button>
            ))}
          </div>
          <div className="msep" />
          <button className="mi" onClick={() => (store.apply(sp.archived ? `Restored ${sp.name}` : `Archived ${sp.name}`, (d) => ops.updateSpace(d, sp.id, { archived: !sp.archived }), 'undo'), setOpen(false))}><Archive size={14} />{sp.archived ? 'Restore space' : 'Archive space'}</button>
          <button className="mi danger" onClick={() => {
            setOpen(false)
            setUi({ confirm: { title: `Delete space ${sp.name}`, body: n ? `Its ${n} project(s) move out of any space, and every task stays.` : 'Its tasks stay, outside any space.', confirm: 'Delete space', danger: true, run: () => (store.apply(`Deleted ${sp.name}`, (d) => ops.deleteSpace(d, sp.id), 'undo'), onDeleted()) } })
          }}><Trash2 size={14} />Delete space</button>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── overview and settings ─────────────────────────

function Overview({ projectId }: { projectId: string }) {
  const { state, store, setUi, now } = useApp()
  const ws = state.ws
  const p = ws.projects.find((x) => x.id === projectId)!
  const tasks = ws.tasks.filter((t) => t.project === p.id && !t.archived)
  const counted = tasks.filter((t) => statusOf(ws, t.status).category !== 'cancelled')
  const done = counted.filter((t) => statusOf(ws, t.status).category === 'completed').length
  const pct = counted.length ? Math.round((done / counted.length) * 100) : 0
  const segments = (['completed', 'review', 'started', 'unstarted', 'backlog'] as const).map((c) => ({ c, n: counted.filter((t) => statusOf(ws, t.status).category === c).length })).filter((s) => s.n)
  const colours = { completed: 'var(--done)', review: 'var(--review)', started: 'var(--started)', unstarted: 'color-mix(in srgb, var(--fg) 30%, var(--bg))', backlog: 'color-mix(in srgb, var(--fg) 14%, var(--bg))' }
  const names = { completed: 'done', review: 'in review', started: 'in progress', unstarted: 'to do', backlog: 'backlog' }
  const overdue = tasks.filter((t) => t.due && new Date(`${t.due}T00:00:00`).getTime() < new Date(new Date(now).toDateString()).getTime() && !isClosed(ws, t)).length
  const [desc, setDesc] = useState(p.description)
  const [editing, setEditing] = useState(false)
  const update = (patch: Parameters<typeof ops.updateProject>[2]) => store.apply('Project', (d) => ops.updateProject(d, p.id, patch))
  return (
    <div className="scroll">
      <div style={{ maxWidth: 920, padding: '22px 32px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <EntityIcon name={p.icon} color={p.color} size={28} />
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>{p.name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <select aria-label="Project status" value={p.status} disabled={state.locked} onChange={(e) => update({ status: e.target.value as typeof p.status })} className="btn">
            {PROJECT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="Project priority" value={p.priority} disabled={state.locked} onChange={(e) => update({ priority: Number(e.target.value) as typeof p.priority })} className="btn">
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{['No priority', 'Urgent', 'High', 'Medium', 'Low'][n]}</option>)}
          </select>
          <label className="btn">Start <input type="date" value={p.start ?? ''} disabled={state.locked} onChange={(e) => update({ start: e.target.value || undefined })} style={{ border: 0, background: 'transparent' }} /></label>
          <label className="btn" style={{ color: p.target && p.target < new Date(now).toISOString().slice(0, 10) && !['completed', 'cancelled'].includes(p.status) ? 'var(--attention)' : undefined }}>
            Target <input type="date" value={p.target ?? ''} disabled={state.locked} onChange={(e) => update({ target: e.target.value || undefined })} style={{ border: 0, background: 'transparent', color: 'inherit' }} />
          </label>
        </div>
        {editing ? (
          <textarea className="desc-input" autoFocus value={desc} aria-label="Project description" onChange={(e) => setDesc(e.target.value)} onBlur={() => (update({ description: desc }), setEditing(false))} />
        ) : (
          <div onClick={() => !state.locked && (setDesc(p.description), setEditing(true))}>
            {p.description ? <Markdown className="desc" text={p.description} /> : <div className="desc placeholder">Add a description…</div>}
          </div>
        )}
        <div className="sect" style={{ marginTop: 10 }}>Activity</div>
        <ProjectActivity project={p} now={now} />
        <div className="sect" style={{ marginTop: 10 }}>Progress</div>
        {counted.length ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>{pct}%</span>
              <span className="muted">{done} of {counted.length} task{counted.length === 1 ? '' : 's'} done</span>
              {overdue > 0 && <span style={{ marginLeft: 'auto', color: 'var(--attention)', fontSize: 12.5 }}>{overdue} overdue</span>}
            </div>
            <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 3, overflow: 'hidden' }} role="img" aria-label={segments.map((s) => `${s.n} ${names[s.c]}`).join(', ')}>
              {segments.map((s) => <i key={s.c} style={{ flex: s.n, background: colours[s.c], minWidth: 3 }} title={`${names[s.c]} ${s.n}`} />)}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--fg-3)', fontSize: 12.5 }}>{segments.map((s) => <span key={s.c}><i className="dot" style={{ background: colours[s.c], marginRight: 6 }} />{s.n} {names[s.c]}</span>)}</div>
          </>
        ) : (
          <p className="faint" style={{ margin: 0 }}>No tasks yet</p>
        )}
        <div className="sect" style={{ marginTop: 10 }}>Up next</div>
        <div>
          {upNext(ws, tasks).slice(0, 5).map((t) => {
            const s = statusOf(ws, t.status)
            return (
              <button key={t.id} className="subrow" style={{ width: '100%' }} onClick={() => setUi({ page: t.id })}>
                <PriorityIcon priority={t.priority} />
                <StatusIcon category={s.category} color={s.color} />
                <span className="num faint">{identifier(ws, t)}</span>
                <span className="t">{t.title}</span>
              </button>
            )
          })}
          {!upNext(ws, tasks).length && <p className="faint" style={{ margin: 0 }}>Nothing open here. Enjoy the quiet.</p>}
        </div>
        <div className="sect" style={{ marginTop: 10 }}>Links</div>
        <ProjectLinks project={p} />
      </div>
    </div>
  )
}

function ProjectSettings({ projectId, onDeleted }: { projectId: string; onDeleted: () => void }) {
  const { state, store, setUi } = useApp()
  const p = state.ws.projects.find((x) => x.id === projectId)!
  const [name, setName] = useState(p.name)
  const [key, setKey] = useState(p.key)
  const keyOk = /^[A-Z][A-Z0-9]{1,4}$/.test(key) && !state.ws.projects.some((x) => x.id !== p.id && x.key === key)
  const row = (label: string, hint: string, control: ReactNode) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 200 }}><div>{label}</div><div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>{hint}</div></div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{control}</div>
    </div>
  )
  const input = { height: 30, border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 8px', background: 'var(--bg)' }
  return (
    <div className="scroll">
      <div style={{ maxWidth: 760, padding: '20px 32px 48px' }}>
        <h2 className="faint" style={{ fontSize: 13, fontWeight: 500 }}>General</h2>
        <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)' }}>
          {row('Name and icon', 'How the project appears in the sidebar.', (
            <>
              <select aria-label="Icon" value={p.icon ?? 'folder-kanban'} disabled={state.locked} onChange={(e) => store.apply('Icon', (d) => ops.updateProject(d, p.id, { icon: e.target.value }))} style={input}>
                {Object.keys(ENTITY_ICONS).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input aria-label="Project name" value={name} style={{ ...input, width: 200 }} readOnly={state.locked} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && store.apply('Renamed project', (d) => ops.updateProject(d, p.id, { name: name.trim() }))} />
            </>
          ))}
          {row('Key', `Tasks are numbered ${p.key}-1, ${p.key}-2… Changing it renumbers them; old IDs still find them.`, (
            <input aria-label="Project key" value={key} style={{ ...input, width: 90, fontFamily: 'var(--mono)', borderColor: keyOk ? undefined : 'var(--attention)' }} readOnly={state.locked}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              onBlur={() => (keyOk && key !== p.key ? store.apply('Changed key', (d) => ops.updateProject(d, p.id, { key })) : setKey(p.key))} />
          ))}
          {row('Space', 'Where it sits in the sidebar.', (
            <select aria-label="Project space" value={p.space ?? ''} disabled={state.locked} onChange={(e) => store.apply('Moved project', (d) => ops.updateProject(d, p.id, { space: e.target.value || undefined }))} style={input}>
              <option value="">No space</option>
              {state.ws.spaces.filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          ))}
          {row('Colour', 'Tints the project’s icon.', (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 260 }}>
              {['#A79EF4', '#8C7DA8', '#81B2D9', '#32769B', '#62866C', '#8BA47C', '#D9A54A', '#E0A45E', '#CB7876', '#E39B99'].map((c) => (
                <button key={c} aria-label={`Colour ${c}`} disabled={state.locked} onClick={() => store.apply('Colour', (d) => ops.updateProject(d, p.id, { color: c }))} style={{ width: 20, height: 20, borderRadius: '50%', background: c, outline: p.color === c ? '2px solid var(--fg)' : undefined, outlineOffset: 2 }} />
              ))}
            </div>
          ))}
        </div>
        <h2 className="faint" style={{ fontSize: 13, fontWeight: 500, marginTop: 28 }}>Danger zone</h2>
        <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)' }}>
          {row(p.archived ? 'Restore project' : 'Archive project', p.archived ? 'Bring it back to the sidebar.' : 'It leaves the sidebar; its tasks and history are kept.', (
            <button className="btn" disabled={state.locked} onClick={() => store.apply(p.archived ? 'Restored project' : 'Archived project', (d) => ops.updateProject(d, p.id, { archived: !p.archived }), 'undo')}>{p.archived ? 'Restore' : 'Archive'}</button>
          ))}
          {row('Delete project', `Deletes it and its ${state.ws.tasks.filter((t) => t.project === p.id).length} task(s).`, (
            <button className="btn danger" disabled={state.locked} onClick={() => setUi({ confirm: { title: `Delete project ${p.name}`, body: 'This project and its tasks will be deleted. You can undo this until you close the note.', confirm: 'Delete project', danger: true, run: () => (store.apply(`Deleted ${p.name}`, (d) => ops.deleteProject(d, p.id), 'undo'), onDeleted()) } })}>Delete</button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── menus and bars ─────────────────────────

function ContextMenu() {
  const { state, ui, setUi, actions, store } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setUi({ menu: null }), [setUi])
  useDismiss(ref, close, !!ui.menu)
  if (!ui.menu) return null
  const ws = state.ws
  const { ids } = ui.menu
  const tasks = ids.map((id) => ws.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
  if (!tasks.length) return null
  const one = tasks.length === 1
  const allDone = tasks.every((t) => statusOf(ws, t.status).category === 'completed')
  const archived = tasks.every((t) => t.archived)
  const pick = (kind: PickerKind) => setUi({ menu: null, picker: { kind, ids } })
  const item = (label: ReactNode, icon: ReactNode, run: () => void, hint?: string, danger?: boolean) => (
    <button className={`mi${danger ? ' danger' : ''}`} onClick={() => (close(), run())}>{icon}{label}{hint && <span className="k">{hint}</span>}</button>
  )
  const x = Math.min(ui.menu.x, window.innerWidth - 250)
  const y = Math.min(ui.menu.y, window.innerHeight - 420)
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: Math.max(8, x), top: Math.max(8, y), width: 240 }}>
      {one ? item(`Open ${identifier(ws, tasks[0])}`, <FolderKanban size={14} />, () => setUi({ page: tasks[0].id, peek: null }), '↵') : <div className="mhead">{tasks.length} tasks selected</div>}
      <div className="msep" />
      {!archived && (
        <>
          {item('Status', <StatusIcon category={statusOf(ws, tasks[0].status).category} />, () => pick('status'), 'S')}
          {item('Priority', <PriorityIcon priority={tasks[0].priority} />, () => pick('priority'), 'P')}
          {item('Labels', <Tag size={14} />, () => pick('labels'), 'L')}
          {item('Due date', <CalendarDays size={14} />, () => pick('due'), 'D')}
          {tasks.some((t) => !t.parent) && item('Project', <FolderKanban size={14} />, () => pick('project'), 'M')}
          {ws.types.length > 0 && item('Type', <span style={{ width: 14 }} />, () => pick('type'), 'T')}
          {ws.buckets.length > 0 && item('Bucket', <span style={{ width: 14 }} />, () => pick('bucket'), 'B')}
          {tasks.every((t) => t.parent) ? item(one ? 'Make a regular task' : 'Make regular tasks', <span style={{ width: 14 }} />, () => actions.setParent(ids, undefined)) : item(one ? 'Make subtask of…' : 'Make subtasks of…', <span style={{ width: 14 }} />, () => pick('parent'))}
          <div className="msep" />
          {item(allDone ? 'Reopen' : 'Mark as done', <CircleCheck size={14} />, () => actions.toggleDone(ids))}
        </>
      )}
      {item(one ? 'Copy ID' : 'Copy IDs', <Copy size={14} />, () => store.toast(copyText(tasks.map((t) => identifier(ws, t)).join(', ')) ? (one ? 'ID copied' : 'IDs copied') : 'Could not copy'))}
      {item(one ? 'Copy as text' : 'Copy as text', <Copy size={14} />, () => store.toast(copyText(tasks.map((t) => `${identifier(ws, t)} ${t.title}`).join('\n')) ? 'Copied' : 'Could not copy'))}
      <div className="msep" />
      {item(archived ? (one ? 'Restore task' : `Restore ${tasks.length} tasks`) : one ? 'Archive task' : `Archive ${tasks.length} tasks`, <Archive size={14} />, () => actions.archive(ids, !archived), undefined, !archived)}
      {item(one ? 'Delete task' : `Delete ${tasks.length} tasks`, <Trash2 size={14} />, () => actions.remove(ids), undefined, true)}
    </div>
  )
}

function SelectionBar() {
  const { state, ui, setUi, actions } = useApp()
  const ws = state.ws
  const ids = ui.selection
  const archived = ids.every((id) => ws.tasks.find((t) => t.id === id)?.archived)
  const btn = (label: string, kind: PickerKind, k: string) => <button className="btn" title={`${label} (${k})`} onClick={() => setUi({ picker: { kind, ids } })}>{label}</button>
  return (
    <div className="selbar" role="toolbar" aria-label={`${ids.length} selected tasks`}>
      <button className="icon-btn" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setUi({ selection: [] })}><X size={14} /></button>
      <span className="n num">{ids.length} selected</span>
      <span className="sep" />
      {!archived && (
        <>
          {btn('Status', 'status', 'S')}
          {btn('Priority', 'priority', 'P')}
          {btn('Labels', 'labels', 'L')}
          {btn('Due date', 'due', 'D')}
          {btn('Project', 'project', 'M')}
          {ws.types.length > 0 && btn('Type', 'type', 'T')}
          {ws.buckets.length > 0 && btn('Bucket', 'bucket', 'B')}
        </>
      )}
      <button className="btn danger" onClick={() => actions.archive(ids, !archived)}>{archived ? 'Restore' : 'Archive'}</button>
    </div>
  )
}

function CommandPalette({ go }: { go: (l: Location) => void }) {
  const { state, ui, setUi } = useApp()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const ws = state.ws
  const items = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list: { key: string; label: string; hint?: string; icon: ReactNode; run: () => void }[] = [
      ...ws.projects.filter((p) => !p.archived).map((p) => ({ key: `p:${p.id}`, label: p.name, hint: p.key, icon: <EntityIcon name={p.icon} color={p.color} size={14} />, run: () => go({ kind: 'project', id: p.id, tab: 'tasks' }) })),
      ...ws.filters.filter((f) => !f.project).map((f) => ({ key: `f:${f.id}`, label: f.name, hint: 'Filter', icon: <CalendarDays size={14} />, run: () => go({ kind: 'filter', id: f.id }) })),
      { key: 'np', label: 'No project', icon: <CircleSlash size={14} />, run: () => go({ kind: 'no-project' }) },
      { key: 'new', label: 'New task', hint: 'C', icon: <Plus size={14} />, run: () => setUi({ creating: {} }) },
      { key: 'help', label: 'Keyboard shortcuts', hint: '?', icon: <Keyboard size={14} />, run: () => setUi({ help: true }) },
    ]
    const tasks = query
      ? ws.tasks.filter((t) => !t.archived && (t.title.toLowerCase().includes(query) || identifier(ws, t).toLowerCase() === query || t.aliases.some((a) => a.toLowerCase() === query))).slice(0, 20).map((t) => {
          const s = statusOf(ws, t.status)
          return { key: `t:${t.id}`, label: t.title, hint: identifier(ws, t), icon: <StatusIcon category={s.category} color={s.color} />, run: () => setUi({ page: t.id, focus: t.id }) }
        })
      : []
    return [...list.filter((i) => !query || i.label.toLowerCase().includes(query) || (i.hint ?? '').toLowerCase().includes(query)), ...tasks]
  }, [q, ws, go, setUi])
  if (!ui.command) return null
  const close = () => setUi({ command: false })
  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <div className="palette" role="dialog" aria-label="Search or jump to" onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActive((a) => Math.min(items.length - 1, a + 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActive((a) => Math.max(0, a - 1))
        } else if (e.key === 'Enter' && items[active]) {
          e.preventDefault()
          close()
          items[active].run()
        }
      }}>
        <div className="inp"><Search size={14} className="faint" /><input autoFocus placeholder="Search tasks, projects, filters…" value={q} onChange={(e) => (setQ(e.target.value), setActive(0))} aria-label="Search or jump to" /></div>
        <div className="opts">
          {items.map((i, n) => (
            <button key={i.key} className="mi" data-active={n === active} onMouseMove={() => setActive(n)} onClick={() => (close(), i.run())}>
              {i.icon}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.label}</span>{i.hint && <span className="k">{i.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['Lists', [['Move down / up', 'J / K'], ['Extend selection', '⇧J / ⇧K'], ['Select', 'X'], ['Select all', '⌘A'], ['Preview', 'Space'], ['Open', 'Enter'], ['Search and filter', '/'], ['New task', 'C'], ['Clear, close', 'Esc']]],
  ['Change', [['Status', 'S'], ['Priority', 'P'], ['Labels', 'L'], ['Due date', 'D'], ['Project', 'M'], ['Type', 'T'], ['Bucket', 'B'], ['Cycle', 'Y'], ['Undo / redo', '⌘Z / ⇧⌘Z']]],
  ['A task', [['Edit title', 'E'], ['Comment', 'C'], ['Send comment', '⌘↵'], ['Open full page', '⌘↵'], ['Next / previous', 'J / K']]],
  ['New task', [['Label', '#label'], ['Priority', '!high'], ['Due date', 'fri, tomorrow, Dec 12'], ['Complete a word', 'Tab or →'], ['Keep a word as text', '⌫ after it'], ['Create', '⌘↵']]],
  ['Anywhere', [['Search or jump to', '⌘K'], ['Shortcuts', '?']]],
]

function Help() {
  const { setUi } = useApp()
  const [q, setQ] = useState('')
  const close = () => setUi({ help: false })
  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <div className="palette" role="dialog" aria-label="Keyboard shortcuts" style={{ maxHeight: '76vh', overflow: 'auto' }} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="inp"><Search size={14} className="faint" /><input autoFocus placeholder="Search shortcuts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shortcuts" /></div>
        {SHORTCUTS.map(([title, list]) => {
          const shown = list.filter(([n]) => n.toLowerCase().includes(q.toLowerCase()))
          if (!shown.length) return null
          return (
            <div key={title} style={{ marginTop: 12 }}>
              <div className="mhead">{title}</div>
              {shown.map(([n, k]) => <div key={n} className="mi" style={{ minHeight: 28 }}>{n}<span className="k"><kbd>{k}</kbd></span></div>)}
            </div>
          )
        })}
      </div>
    </>
  )
}
