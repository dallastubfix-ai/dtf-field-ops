const variants = {
  primary:     'ui-btn-primary',
  secondary:   'ui-btn-secondary',
  destructive: 'ui-btn-destructive',
  gold:        'ui-btn-gold',
  ghost:       'ui-btn-ghost',
}

export default function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  disabled = false,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`
        ui-btn inline-flex items-center justify-center gap-2 px-4
        ${variants[variant]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  )
}
