export default function Textarea({ label, id, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={`border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent resize-none ${className}`}
        {...props}
      />
    </div>
  )
}
