export default function Input({ label, id, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="ui-field-label">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`ui-field ui-field-h px-3 py-2.5 w-full ${className}`}
        {...props}
      />
    </div>
  )
}
