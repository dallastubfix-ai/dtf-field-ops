export default function Select({ label, id, options = [], className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent bg-white ${className}`}
        {...props}
      >
        {options.map(opt =>
          typeof opt === 'string'
            ? <option key={opt} value={opt}>{opt}</option>
            : <option key={opt.value} value={opt.value}>{opt.label}</option>
        )}
      </select>
    </div>
  )
}
