export default function PageHeader({ title, children }) {
  return (
    <div className="page-header-wrap">
      <header className="page-header">
        <h1 className="page-header-title">{title}</h1>
        {children}
      </header>
    </div>
  )
}
