export default function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <div className="w-16 h-16 rounded-full bg-[#F3F4F6] flex items-center justify-center mb-4">
          <Icon size={28} className="text-[#9CA3AF]" />
        </div>
      )}
      <h3 className="font-bold text-[#1F2937] text-base mb-1">{title}</h3>
      {subtitle && <p className="text-[#6B7280] text-sm mb-4">{subtitle}</p>}
      {action}
    </div>
  )
}
