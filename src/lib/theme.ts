// Standard Notes never says whether its theme is dark: infer it from the background's
// luminance (an empty theme list means the default light theme).

function rgb(color: string, doc: Document): [number, number, number] | undefined {
  if (!color) return undefined
  const probe = doc.createElement('div')
  probe.style.color = color
  probe.style.display = 'none'
  doc.body.appendChild(probe)
  const computed = doc.defaultView?.getComputedStyle(probe).color ?? ''
  probe.remove()
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(computed)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

export function isDarkTheme(doc: Document = document): boolean {
  const vars = doc.defaultView?.getComputedStyle(doc.documentElement)
  const bg = rgb(vars?.getPropertyValue('--sn-stylekit-background-color').trim() ?? '', doc)
  return bg ? (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 < 0.5 : false
}

export function applyTheme(root: HTMLElement = document.documentElement): void {
  root.toggleAttribute('data-dark', isDarkTheme(root.ownerDocument))
}
