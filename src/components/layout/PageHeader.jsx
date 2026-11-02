import { ArrowLeft } from 'lucide-react'

export default function PageHeader({ title, subtitle, leading, onBack, sticky = false, centered = false, children }) {
  const hasLeading = !!(leading || onBack)
  return (
    <div className={`page-header-wrap${sticky ? ' page-header-wrap--sticky' : ''}`}>
      <header className={`page-header${hasLeading ? ' page-header--leading' : ''}${sticky ? ' page-header--sticky glass-blur' : ''}`}>
        {onBack && (
          <button type="button" onClick={onBack} className="icon-btn" aria-label="Back">
            <ArrowLeft size={22} />
          </button>
        )}
        {leading}
        {subtitle ? (
          <div className="page-header-titles">
            <h1 className="page-header-title">{title}</h1>
            <p className="page-header-subtitle">{subtitle}</p>
          </div>
        ) : (
          <h1 className={`page-header-title${centered ? ' page-header-title--centered' : ''}`}>{title}</h1>
        )}
        {children}
      </header>
    </div>
  )
}
