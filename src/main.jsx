import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-800.css'
import '@fontsource/inter/latin-900.css'
import './index.css'
import App from './App.jsx'
import { applyTheme } from './lib/theme'

applyTheme()

let updateSW
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // A new build is waiting — flag it so the in-app UpdateBanner can prompt.
        window.__updateAvailable = true
        window.__needsRefresh?.()
      },
    })
    // Exposed for UpdateBanner's "Refresh" button: activates the waiting SW + reloads.
    window.__updateSW = updateSW
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
