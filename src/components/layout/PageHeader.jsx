export default function PageHeader({ title, leading, centered = false, children }) {
  return (
    <div className="page-header-wrap">
      <header className={`page-header${leading ? ' page-header--leading' : ''}`}>
        {leading}
        <h1 className={`page-header-title${centered ? ' page-header-title--centered' : ''}`}>{title}</h1>
        {children}
      </header>
    </div>
  )
}
