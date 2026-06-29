import { useEffect, useRef } from 'react'

export default function AddressAutocomplete({ label, id, value, onChange, onAutocomplete, placeholder, className = '' }) {
  const inputRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    function init() {
      if (!isMounted || !inputRef.current || !window.google?.maps?.places) return

      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address'],
        bounds: new window.google.maps.LatLngBounds(
          new window.google.maps.LatLng(32.2, -97.5),
          new window.google.maps.LatLng(33.4, -96.0)
        ),
        strictBounds: false,
      })

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (place?.formatted_address) {
          if (onAutocomplete) {
            onAutocomplete(place.formatted_address)
          } else {
            onChange(place.formatted_address)
          }
        }
      })
    }

    if (window.google?.maps?.places) {
      init()
    } else {
      const interval = setInterval(() => {
        if (window.google?.maps?.places) {
          clearInterval(interval)
          init()
        }
      }, 100)
      return () => { isMounted = false; clearInterval(interval) }
    }

    return () => { isMounted = false }
  }, [])

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent ${className}`}
      />
    </div>
  )
}
