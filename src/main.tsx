import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { StandardNotesBridge } from './lib/sn/bridge'
import { Store } from './lib/store'
import { demoWorkspace } from './sample/demo'

// The bridge must exist before React mounts: Standard Notes registers the editor while the iframe
// loads, and a late listener misses that message. Outside Standard Notes the made-up demo opens.
const embedded = window.parent !== window
const bridge = embedded ? new StandardNotesBridge(window) : null
const store = new Store(bridge, embedded ? undefined : demoWorkspace())
if (embedded) document.body.classList.add('sn-embedded')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
)
