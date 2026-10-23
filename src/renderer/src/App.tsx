import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, useDevhubEvents } from './api'
import { JobsPanel } from './components/Jobs'
import Catalog from './pages/Catalog'
import Projects from './pages/Projects'
import Settings from './pages/Settings'
import Setup from './pages/Setup'

type Page = 'catalog' | 'projects' | 'settings' | 'setup'

const NAV: { id: Page; label: string }[] = [
  { id: 'projects', label: 'Mis proyectos' },
  { id: 'catalog', label: 'Catálogo' },
  { id: 'settings', label: 'Configuración' },
  { id: 'setup', label: 'Puesta en marcha' }
]

export default function App(): JSX.Element {
  useDevhubEvents()
  const [page, setPage] = useState<Page>('projects')
  const checks = useQuery({ queryKey: ['checks'], queryFn: () => api.runChecks() })
  const instances = useQuery({ queryKey: ['instances'], queryFn: () => api.instances() })
  const version = useQuery({ queryKey: ['version'], queryFn: () => api.appVersion() })
  const problems = (checks.data ?? []).filter((c) => c.status === 'error').length

  // Primer arranque: si falta algo esencial, llevar al asistente.
  useEffect(() => {
    if (problems > 0) setPage('setup')
  }, [problems > 0])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          DevHub<small>v{version.data}</small>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item${page === n.id ? ' active' : ''}`} onClick={() => setPage(n.id)}>
              {n.label}
              {n.id === 'projects' && instances.data ? <span className="count">{instances.data.length}</span> : null}
              {n.id === 'setup' && problems > 0 ? <span className="count count-error">{problems}</span> : null}
            </button>
          ))}
        </nav>
        <JobsPanel />
      </aside>
      <main className="main">
        {page === 'catalog' && <Catalog onMounted={() => setPage('projects')} />}
        {page === 'projects' && <Projects goCatalog={() => setPage('catalog')} />}
        {page === 'settings' && <Settings />}
        {page === 'setup' && <Setup />}
      </main>
    </div>
  )
}
