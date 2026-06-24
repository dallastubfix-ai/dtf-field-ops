const variants = {
  primary:     'bg-[#1E40AF] text-white hover:bg-[#1E3A8A] active:scale-95',
  secondary:   'border border-[#1E40AF] text-[#1E40AF] hover:bg-blue-50 active:scale-95',
  destructive: 'bg-[#EF4444] text-white hover:bg-red-600 active:scale-95',
  gold:        'bg-[#F59E0B] text-white hover:bg-amber-500 active:scale-95',
  ghost:       'text-[#6B7280] hover:bg-gray-100 active:scale-95',
}

export default function Button({
  variant = 'primary',
  className = '',
  disabled = false,
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled}
      className={`
        inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5
        font-semibold text-sm transition-all
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${variants[variant]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  )
}
