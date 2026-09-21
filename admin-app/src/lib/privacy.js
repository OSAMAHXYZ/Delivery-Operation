/** Privacy — mask customer names; never show phone numbers. */

export function maskPersonName(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s || s === '—' || s === '-' || s === 'N/A' || s === 'n/a') return s || '—'
  return s.replace(/[^\s]+/g, (word) => {
    const chars = Array.from(word)
    if (!chars.length) return word
    return chars[0] + '*'.repeat(Math.max(0, chars.length - 1))
  })
}

export function maskPhone(_value) {
  return '—'
}
