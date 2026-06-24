export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
