export default function Select({ label, id, options = [], className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="ui-field-label">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`ui-field ui-field-h px-3 py-2.5 w-full ${className}`}
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
