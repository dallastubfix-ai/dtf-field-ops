export default function Textarea({ label, id, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="ui-field-label">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={`ui-field px-3 py-2.5 w-full resize-none ${className}`}
        {...props}
      />
    </div>
  )
}
