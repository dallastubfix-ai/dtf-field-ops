export function formatEnum(value) {
  if (!value) return ''
  return value
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace('Porcelain Cast Iron', 'Porcelain / Cast Iron')
}
