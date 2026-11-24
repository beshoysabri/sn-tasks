import { demoWorkspace } from './sample/demo'

/** Placeholder while phase 0 lands: proves the build and the model. */
export default function App() {
  const ws = demoWorkspace()
  return <p>Tasks: {ws.tasks.length} demo tasks in {ws.projects.length} projects.</p>
}
