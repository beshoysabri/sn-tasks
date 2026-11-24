/** A made-up workspace for standalone development, tests and screenshots. No real data. */
import { seededWorkspace } from '../lib/model/defaults'
import type { Priority, Task, Workspace } from '../lib/model/types'

function at(daysAgo: number, hour = 9): string {
  const d = new Date(Date.UTC(2026, 10, 24, hour, 0))
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 16) + 'Z'
}

function day(offset: number): string {
  const d = new Date(Date.UTC(2026, 10, 24))
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

let seq = 0
function task(partial: Partial<Task> & Pick<Task, 'title' | 'number'>): Task {
  seq++
  const created = partial.created ?? at(10 - (seq % 9))
  return {
    id: partial.id ?? `demo${String(seq).padStart(2, '0')}`,
    status: 'todo',
    priority: 0 as Priority,
    labels: [],
    description: '',
    created,
    updated: partial.updated ?? created,
    aliases: [],
    fields: {},
    history: [{ at: created, kind: 'created' }],
    ...partial,
  }
}

export function demoWorkspace(): Workspace {
  seq = 0
  const ws = seededWorkspace()
  ws.labels.push({ name: 'Docs', color: '#8C7DA8' }, { name: 'Design', color: '#81B2D9' }, { name: 'Admin', color: '#8BA47C' })
  ws.statuses.push({ id: 'waiting', name: 'Waiting', category: 'started', color: '#D29A3A', builtin: false })
  ws.fields.push({ id: 'effort', name: 'Effort', type: 'select', options: [{ value: 'S' }, { value: 'M' }, { value: 'L' }] })
  ws.spaces.push(
    { id: 'career', name: 'Career', icon: 'briefcase', labels: [], description: 'Work that keeps going.', links: [], archived: false },
    { id: 'home', name: 'Home life', icon: 'leaf', labels: [], description: '', links: [], archived: false },
  )
  ws.projects.push(
    {
      id: 'website', name: 'Website', key: 'WEB', next: 19, icon: 'globe', color: '#A79EF4', status: 'in-progress', priority: 2,
      start: day(-23), target: day(21), labels: [], space: 'career',
      description: 'Relaunch the personal site with the new pricing and blog. Keep scope to what ships before the holidays.',
      links: [{ title: 'Brand guidelines', url: 'https://example.com/brand' }], archived: false, pinned: false,
    },
    {
      id: 'homeproj', name: 'Home', key: 'HOME', next: 7, icon: 'home', color: '#D9A54A', status: 'planned', priority: 0,
      labels: [], space: 'home', description: '', links: [], archived: false, pinned: false,
    },
    {
      id: 'finance', name: 'Finance', key: 'FIN', next: 5, icon: 'wallet', color: '#62A07A', status: 'in-progress', priority: 3,
      labels: [], description: '', links: [], archived: false, pinned: false,
    },
  )
  ws.settings.noProjectNext = 4
  ws.tasks.push(
    task({
      number: 14, project: 'website', title: 'Fix broken signup link on the pricing page', status: 'in-progress', priority: 1, labels: ['Bug'], due: day(1),
      description: 'The “Start free” button on /pricing points at the old signup route and returns a 404 since the relaunch.\n\n- [x] Reproduce on phone and desktop\n- [ ] Check the other CTAs on the page',
      fields: { effort: 'S' },
      history: [
        { at: at(5), kind: 'created' },
        { at: at(2), kind: 'status', from: 'Todo', to: 'In progress' },
        { at: at(0, 7), kind: 'comment', text: 'Support says it also breaks in the app’s webview, so test there too.' },
        { at: at(0, 9), kind: 'priority', from: 'High', to: 'Urgent' },
      ],
      created: at(5),
      updated: at(0, 9),
    }),
    task({ number: 15, project: 'website', parent: 'demo01', title: 'Find every link to /signup', status: 'done', completed: at(0, 8) }),
    task({ number: 17, project: 'website', parent: 'demo01', title: 'Redirect /signup to /start', status: 'in-progress', priority: 2, due: day(1) }),
    task({ number: 12, project: 'website', title: 'Write release notes for the relaunch', status: 'in-review', priority: 2, labels: ['Docs'], due: day(4) }),
    task({ number: 11, project: 'website', title: 'Update pricing page copy', priority: 3, labels: ['Docs', 'Design'], due: day(-2), fields: { effort: 'M' } }),
    task({ number: 16, project: 'website', title: 'Compress images on the blog' }),
    task({ number: 9, project: 'website', title: 'Pick a new hero image', priority: 4, labels: ['Design'], due: day(11) }),
    task({ number: 7, project: 'website', title: 'Move DNS to Cloudflare', status: 'backlog', priority: 3, labels: ['Admin'] }),
    task({ number: 18, project: 'website', title: 'Cookie banner wording', status: 'backlog' }),
    task({ number: 5, project: 'website', title: 'Launch checklist', status: 'done', priority: 2, completed: at(3) }),
    task({ number: 3, project: 'website', title: 'Old analytics script', status: 'cancelled', cancelled: at(6) }),
    task({ number: 4, project: 'homeproj', title: 'Book the boiler service', priority: 2, due: day(2), bucket: 'now' }),
    task({ number: 6, project: 'homeproj', title: 'Fix the balcony door seal', status: 'waiting', bucket: 'next' }),
    task({ number: 2, project: 'finance', title: 'File the November report', status: 'todo', priority: 2, due: day(7), labels: ['Admin'] }),
    task({ number: 4, project: 'finance', title: 'Cancel the unused cloud plan', status: 'done', completed: at(1) }),
    task({ number: 2, space: 'home', title: 'Renew the domain', priority: 3, due: day(5), labels: ['Admin'] }),
    task({ number: 3, title: 'Call the bank about the card', priority: 1, due: day(0) }),
  )
  return ws
}
