import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // A new build is waiting — flag it so the in-app UpdateBanner can prompt.
    window.__updateAvailable = true
    window.__needsRefresh?.()
  },
})
// Exposed for UpdateBanner's "Refresh" button: activates the waiting SW + reloads.
window.__updateSW = updateSW

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
