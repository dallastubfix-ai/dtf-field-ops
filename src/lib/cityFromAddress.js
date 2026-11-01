// City from a formatted US address ("123 Main St, Rockwall, TX 75087, USA" -> "Rockwall").
// Returns '' when the address does not end in a state (and optional ZIP) after a city part.
// Pure JavaScript: shared by the mileage engine and the collage filenames.
export function cityFromAddress(address) {
  const parts = (address ?? '').split(',').map(p => p.trim()).filter(Boolean)
  if (/^(USA|United States)$/i.test(parts[parts.length - 1] ?? '')) parts.pop()
  if (parts.length < 3) return ''
  return /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[parts.length - 1]) ? parts[parts.length - 2] : ''
}
