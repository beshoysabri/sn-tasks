import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlignLeft, ListTree, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Task, Workspace } from '../lib/model/types'
import { identifier, isClosed, manualOrder, statusOf, subtaskProgress } from '../lib/model/workspace'
import { compareTasks, isOverdue } from '../lib/query'
import type { DisplayOptions } from '../lib/store'
import type { Group } from '../lib/view'
import { useApp } from './context'
import { PriorityIcon, StatusIcon } from './icons'
import { GroupIcon } from './TaskList'
import { Due, Labels } from './ui'

function Card({ task, ws, now, focused, overlay }: { task: Task; ws: Workspace; now: number; focused?: boolean; overlay?: boolean }) {
  const status = statusOf(ws, task.status)
  const progress = subtaskProgress(ws, task)
  const overdue = isOverdue(ws, task, now)
  return (
    <div className="card" data-focused={focused} data-closed={isClosed(ws, task) || !!task.archived} style={overlay ? undefined : undefined}>
      <div className="top">
        <span className="num">{identifier(ws, task)}</span>
        <span className="r">
          <StatusIcon category={status.category} color={status.color} label={status.name} />
          <PriorityIcon priority={task.priority} />
        </span>
      </div>
      <div className="ttl">{task.title}</div>
      {(task.labels.length > 0 || task.due || progress.total > 0 || task.description) && (
        <div className="foot">
          <Labels ws={ws} names={task.labels} small />
          <span className="r">
            {progress.total > 0 && <span className="subcount"><ListTree size={12} aria-hidden />{progress.done}/{progress.total}</span>}
            {task.description && <AlignLeft size={13} aria-label="Has description" />}
            <Due due={task.due} overdue={overdue} now={now} />
          </span>
        </div>
      )}
    </div>
  )
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (t: Task, page: boolean) => void }) {
  const { state, ui, setUi, now } = useApp()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !!task.archived || state.locked })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1, paddingLeft: task.parent ? 16 : 0 }}
      {...attributes}
      {...listeners}
      data-task-row={task.id}
      onClick={() => (setUi({ focus: task.id }), onOpen(task, false))}
      onDoubleClick={() => onOpen(task, true)}
      onContextMenu={(e) => {
        e.preventDefault()
        setUi({ menu: { x: e.clientX, y: e.clientY, ids: [task.id] }, focus: task.id })
      }}
    >
      <Card task={task} ws={state.ws} now={now} focused={ui.focus === task.id || ui.peek === task.id} />
    </div>
  )
}

function Column({ group, tasks, onOpen, onCreate, over }: { group: Group; tasks: Task[]; onOpen: (t: Task, page: boolean) => void; onCreate: (d: Group['defaults']) => void; over: boolean }) {
  const { state } = useApp()
  const { setNodeRef } = useDroppable({ id: `col:${group.key}` })
  return (
    <section ref={setNodeRef} className={`col${over ? ' over' : ''}`} aria-label={group.name}>
      <div className="col-head">
        <GroupIcon group={group} ws={state.ws} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</span>
        <span className="pillcount num">{tasks.length}</span>
      </div>
      {!state.locked && (
        <button className="addtop" aria-label={`New ${group.name} task`} onClick={() => onCreate(group.defaults)}>
          <Plus size={14} />
          Add task
        </button>
      )}
      <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <SortableCard key={t.id} task={t} onOpen={onOpen} />)}
        </SortableContext>
        {!tasks.length && <div className="none">{over ? 'Drop task here' : 'No tasks'}</div>}
      </div>
    </section>
  )
}

export function Board({ columns, display, onOpen, onCreate }: { columns: Group[]; display: DisplayOptions; onOpen: (t: Task, page: boolean) => void; onCreate: (d: Group['defaults']) => void }) {
  const { state, actions, now } = useApp()
  const ws = state.ws
  const [dragging, setDragging] = useState<Task | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const compare = compareTasks(ws, display.ordering, display.direction)
  const sorted = columns.map((c) => ({ ...c, tasks: [...c.tasks].sort(compare) }))
  const columnOf = (id: string) => (id.startsWith('col:') ? id.slice(4) : sorted.find((c) => c.tasks.some((t) => t.id === id))?.key)

  const end = (e: DragEndEvent) => {
    setDragging(null)
    setOverCol(null)
    const task = ws.tasks.find((t) => t.id === e.active.id)
    if (!task || !e.over) return
    const target = columnOf(String(e.over.id))
    const from = columnOf(task.id)
    const col = sorted.find((c) => c.key === target)
    if (!col || !target) return
    if (target !== from) {
      if (target.startsWith('status:')) actions.setStatus([task.id], target.slice(7))
      else actions.setField([task.id], 'bucket', target === 'bucket:none' ? undefined : target.slice(7))
    }
    if (display.ordering !== 'manual') return
    const list = col.tasks.filter((t) => t.id !== task.id).sort((a, b) => manualOrder(a) - manualOrder(b))
    const overIndex = String(e.over.id).startsWith('col:') ? list.length : list.findIndex((t) => t.id === e.over!.id)
    const index = overIndex < 0 ? list.length : overIndex + (target === from && col.tasks.findIndex((t) => t.id === task.id) < col.tasks.findIndex((t) => t.id === e.over!.id) ? 1 : 0)
    actions.reorder(task.id, list[index - 1], list[index])
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setDragging(ws.tasks.find((t) => t.id === e.active.id) ?? null)}
      onDragOver={(e) => setOverCol(e.over ? (columnOf(String(e.over.id)) ?? null) : null)}
      onDragCancel={() => (setDragging(null), setOverCol(null))}
      onDragEnd={end}
    >
      <div className={`board${display.wrap ? ' wrap' : ''}`}>
        {sorted.map((c) => <Column key={c.key} group={c} tasks={c.tasks} onOpen={onOpen} onCreate={onCreate} over={!!dragging && overCol === c.key} />)}
      </div>
      <DragOverlay dropAnimation={null} className="drag-overlay">{dragging && <Card task={dragging} ws={ws} now={now} overlay />}</DragOverlay>
    </DndContext>
  )
}
