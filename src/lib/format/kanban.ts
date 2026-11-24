/**
 * Reads a note written by the Kanban Board plugin (both of its formats) into a workspace with one
 * project, so a board note switched to Tasks keeps everything. Nothing is written until the user
 * changes something; then the note is saved in format 1.
 *
 * New format: `@title:`, `@status: Name [color:X] [wip:N]`, `@group:`, `@subgroup:`,
 * `@field: id [type:T] [name:N] [options:a,b] [colors:a=#x]`, then `* Card` blocks with
 * `  * Property: value` lines, `  * Checklist:` and `  * Comments:` sub-lists.
 * Old format: `# Status` headings with the cards under them.
 */
import { emptyWorkspace, PALETTE } from '../model/defaults'
import type { Field, FieldType, Priority, Status, StatusCategory, Task, Workspace } from '../model/types'
import { deriveKey, newId, normaliseLabel } from '../model/workspace'

export interface KanbanResult {
  workspace: Workspace
  /** The board's last view, for opening it the way it was ('board', 'list' or 'table'). */
  view: 'board' | 'list' | 'table'
  warnings: string[]
}

interface OldCard {
  title: string
  description: string
  status: string
  group: string
  subGroup: string
  label: string
  labelColor: string
  due: string
  priority: string
  checklist: { text: string; done: boolean }[]
  comments: string[]
  fields: Record<string, string>
}

const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'url', 'media', 'checkbox']

/** True when the text looks like a Kanban Board note. */
export function isKanbanNote(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.some((l) => /^@(status|title|group|field|view):/i.test(l.trim()))) return true
  // The old format: "# Status" headings with "* Card" lines under them, nothing else.
  const hasHeading = lines.some((l) => /^# \S/.test(l))
  const hasCard = lines.some((l) => /^\* \S/.test(l))
  const foreign = lines.some((l) => l.trim() && !/^(# |\* |\s+\* |\s*$)/.test(l))
  return hasHeading && hasCard && !foreign
}

function colour(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toUpperCase()
  return PALETTE.find((p) => p.name.toLowerCase() === v.toLowerCase())?.hex
}

function stripTags(text: string) {
  const tags: Record<string, string> = {}
  const name = text.replace(/\[(\w+):([^\]]*)\]/g, (_, k: string, v: string) => {
    tags[k.toLowerCase()] = v
    return ''
  })
  return { name: name.trim(), tags }
}

const MEANINGS: [RegExp, StatusCategory, string][] = [
  [/^(back ?log|icebox|someday|ideas?)$/i, 'backlog', 'backlog'],
  [/^(to ?do|todo|open|new|planned|next|ready)$/i, 'unstarted', 'todo'],
  [/(in )?progress|doing|working|started|active|wip|waiting|blocked|on ?hold|paused/i, 'started', 'in-progress'],
  [/review|qa|testing|verify|check/i, 'review', 'in-review'],
  [/^(done|complete(d)?|finished|closed|shipped|resolved)$/i, 'completed', 'done'],
  [/cancel|won'?t|dropped|abandon|rejected/i, 'cancelled', 'cancelled'],
]

function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'status'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

export function readKanban(text: string, now: string): KanbanResult {
  const warnings: string[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const isNew = lines.some((l) => l.trim().toLowerCase().startsWith('@status:'))
  let title = ''
  let description = ''
  let view: KanbanResult['view'] = 'list'
  const oldStatuses: { name: string; color?: string }[] = []
  const groups: { name: string; color?: string }[] = []
  const fieldDefs: Field[] = []
  const fieldLabels: Record<string, string> = {}
  const cards: OldCard[] = []
  let card: OldCard | null = null
  let mode: '' | 'checklist' | 'comments' = ''
  let headingStatus = ''

  const newCard = (t: string): OldCard => ({
    title: t, description: '', status: headingStatus, group: '', subGroup: '', label: '', labelColor: '', due: '', priority: '', checklist: [], comments: [], fields: {},
  })

  for (const line of lines) {
    if (!line.trim()) continue
    const meta = /^@(\w+):\s*(.*)$/.exec(line)
    if (meta) {
      const [, key, value] = meta
      switch (key.toLowerCase()) {
        case 'title': title = value.trim(); break
        case 'description': description = value.trim(); break
        case 'view': if (['board', 'list', 'table'].includes(value.trim())) view = value.trim() as KanbanResult['view']; break
        case 'status': {
          const { name, tags } = stripTags(value)
          if (name) oldStatuses.push({ name, color: colour(tags.color ?? '') })
          break
        }
        case 'group':
        case 'subgroup': {
          const { name, tags } = stripTags(value)
          if (name) groups.push({ name, color: colour(tags.color ?? '') })
          break
        }
        case 'field': {
          const { name: id, tags } = stripTags(value)
          if (!id) break
          const options = (tags.options ?? '').split(',').map((o) => o.trim()).filter(Boolean)
          const colours: Record<string, string> = {}
          for (const pair of (tags.colors ?? '').split(',')) {
            const [k, v] = pair.split('=')
            if (k && v) colours[k.trim()] = v.trim()
          }
          fieldDefs.push({
            id: id.split(/\s+/)[0],
            name: tags.name ?? id,
            type: FIELD_TYPES.includes(tags.type as FieldType) ? (tags.type as FieldType) : 'text',
            options: options.map((o) => ({ value: o, color: colour(colours[o] ?? '') })),
          })
          break
        }
        case 'fieldlabel': {
          const eq = value.indexOf('=')
          if (eq > 0) fieldLabels[value.slice(0, eq).trim()] = value.slice(eq + 1).trim()
          break
        }
      }
      continue
    }
    if (!isNew && /^# /.test(line)) {
      const { name, tags } = stripTags(line.slice(2))
      headingStatus = name
      if (name) oldStatuses.push({ name, color: colour(tags.color ?? '') })
      card = null
      continue
    }
    if (/^\* /.test(line)) {
      card = newCard(line.slice(2).trim())
      cards.push(card)
      mode = ''
      continue
    }
    if (!card) continue
    const trimmed = line.trimStart()
    const indent = line.length - trimmed.length
    if (indent >= 4 && trimmed.startsWith('* ') && mode) {
      const item = trimmed.slice(2)
      if (mode === 'checklist') {
        const done = /^\[x\] /i.test(item)
        card.checklist.push({ text: item.replace(/^\[[ x]\] /i, ''), done })
      } else card.comments.push(item)
      continue
    }
    const prop = /^\* ([^:]+):\s*(.*)$/.exec(trimmed)
    if (!prop) continue
    const key = prop[1].trim().toLowerCase()
    const value = prop[2]
    mode = ''
    switch (key) {
      case 'description': card.description = value.trim(); break
      case 'status': card.status = value.trim(); break
      case 'group': card.group = value.trim(); break
      case 'subgroup': card.subGroup = value.trim(); break
      case 'label': card.label = value.trim(); break
      case 'labelcolor': card.labelColor = value.trim(); break
      case 'duedate': card.due = value.trim(); break
      case 'priority': card.priority = value.trim().toLowerCase(); break
      case 'checklist': mode = 'checklist'; break
      case 'comments': mode = 'comments'; break
      default: {
        const field = fieldDefs.find((f) => f.name.toLowerCase() === key || (fieldLabels[f.id] ?? '').toLowerCase() === key)
        if (field) card.fields[field.id] = field.type === 'media' || field.type === 'textarea' ? value.trim().replace(/\|/g, '\n') : value.trim()
      }
    }
  }

  // The workspace: one project named after the board.
  const ws = emptyWorkspace()
  const name = title || 'Board'
  const projectId = newId()
  const key = deriveKey(name)
  ws.projects.push({
    id: projectId, name, key, next: cards.length + 1, status: 'in-progress', priority: 0, labels: [], description,
    links: [], archived: false, pinned: false,
  })

  // Statuses by meaning; a second status with the same meaning becomes a custom one in that category.
  const statusIds = new Map<string, string>()
  const takenBuiltins = new Set<string>()
  const ids = new Set(ws.statuses.map((s) => s.id))
  for (const old of oldStatuses) {
    if (statusIds.has(old.name.toLowerCase())) continue
    const meaning = MEANINGS.find(([re]) => re.test(old.name))
    const category: StatusCategory = meaning?.[1] ?? 'unstarted'
    const builtin = meaning?.[2]
    if (builtin && !takenBuiltins.has(builtin)) {
      // The first status with a meaning becomes that built-in (Doing → In progress).
      takenBuiltins.add(builtin)
      statusIds.set(old.name.toLowerCase(), builtin)
    } else {
      const status: Status = { id: slug(old.name, ids), name: old.name, category, color: old.color, builtin: false }
      ws.statuses.push(status)
      statusIds.set(old.name.toLowerCase(), status.id)
    }
  }

  // Groups, sub-groups and the one label per card become labels.
  const labelByLower = new Map<string, string>()
  const addLabel = (raw: string, color?: string) => {
    const n = normaliseLabel(raw)
    if (!n) return ''
    if (!labelByLower.has(n.toLowerCase())) {
      labelByLower.set(n.toLowerCase(), n)
      ws.labels.push({ name: n, color })
    }
    return labelByLower.get(n.toLowerCase())!
  }
  for (const g of groups) addLabel(g.name, g.color)

  for (const f of fieldDefs) {
    const display = fieldLabels[f.id]
    ws.fields.push({ ...f, name: display || f.name })
  }

  const PRIORITY: Record<string, Priority> = { critical: 1, high: 2, medium: 3, low: 4 }
  cards.forEach((c, i) => {
    const labels = [c.group, c.subGroup].filter(Boolean).map((g) => addLabel(g))
    if (c.label) labels.push(addLabel(c.label, colour(c.labelColor)))
    const checklist = c.checklist.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n')
    const statusId = statusIds.get(c.status.toLowerCase()) ?? (oldStatuses[0] ? statusIds.get(oldStatuses[0].name.toLowerCase()) : undefined) ?? 'todo'
    if (c.status && !statusIds.has(c.status.toLowerCase())) warnings.push(`“${c.title}” had the unknown status “${c.status}”.`)
    const task: Task = {
      id: newId(),
      number: i + 1,
      project: projectId,
      title: c.title || 'Untitled task',
      description: [c.description, checklist].filter(Boolean).join('\n\n'),
      status: statusId,
      priority: PRIORITY[c.priority] ?? 0,
      labels: [...new Set(labels.filter(Boolean))],
      due: /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : undefined,
      created: now,
      updated: now,
      aliases: [],
      fields: c.fields,
      history: [{ at: now, kind: 'created' }, ...c.comments.map((text) => ({ at: now, kind: 'comment' as const, text }))],
    }
    const category = ws.statuses.find((s) => s.id === statusId)?.category
    if (category === 'completed') task.completed = now
    if (category === 'cancelled') task.cancelled = now
    ws.tasks.push(task)
  })
  return { workspace: ws, view, warnings }
}
