const ADMIN_PASSWORD = '1234'

export function checkPassword(password) {
  return String(password || '') === ADMIN_PASSWORD
}

export async function fetchInventory() {
  const res = await fetch('/api/delivery-inventory')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل تحميل البيانات')
  return data
}

export async function fetchQueueAdmin() {
  const res = await fetch('/api/delivery-coordinator/queue?admin=1')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل تحميل القائمة')
  return data
}

export async function fetchOptions() {
  const res = await fetch('/api/delivery-options')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل تحميل الخيارات')
  return data
}

export async function addOption(kind, name) {
  const res = await fetch(`/api/delivery-options/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل الإضافة')
  return data
}

export async function removeOption(kind, name) {
  const res = await fetch(`/api/delivery-options/${kind}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل الحذف')
  return data
}

export async function releaseVin(vin) {
  const res = await fetch('/api/delivery-coordinator/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل الإتاحة')
  return data
}

export async function clearInventory() {
  const res = await fetch('/api/delivery-inventory', { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل المسح')
  return data
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('فشل قراءة الملف'))
    reader.readAsDataURL(file)
  })
}

export async function restoreExport(file) {
  const fileData = await readFileAsDataUrl(file)
  const res = await fetch('/api/delivery-inventory/restore-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileData, filename: file.name }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل الاستيراد')
  return data
}

export async function mergeDates(file) {
  const fileData = await readFileAsDataUrl(file)
  const res = await fetch('/api/delivery-inventory/merge-dates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileData, filename: file.name }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'فشل دمج التواريخ')
  return data
}

export function draftPdfUrl(id, mode = 'export') {
  const q = mode === 'edit' ? 'adminEdit=1' : 'adminExport=1'
  return `/delivery-hub/Delivery_pdf.html?draft=${encodeURIComponent(id)}&${q}`
}
