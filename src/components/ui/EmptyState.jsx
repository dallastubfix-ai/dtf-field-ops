export default function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <div className="w-16 h-16 rounded-full bg-[var(--inset-fill)] flex items-center justify-center mb-4">
          <Icon size={28} className="text-[var(--text-secondary)]" />
        </div>
      )}
      <h3 className="font-bold text-[var(--text)] text-base mb-1">{title}</h3>
      {subtitle && <p className="font-medium text-[var(--text-secondary)] text-sm mb-4">{subtitle}</p>}
      {action}
    </div>
  )
}
