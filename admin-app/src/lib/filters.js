/** Pure dashboard filter/calc helpers — ported from admin-Delivery-pdf.html (no DOM). */

export function getSaudiTodayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function draftEventIso(d) {
  if (d && d.printedAt) {
    const dt = new Date(d.printedAt)
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(dt)
    }
  }
  const p = (d && d.payload) || {}
  const fallback = String(p.transfer_date || p.doc_date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(fallback)) return fallback.slice(0, 10)
  return ''
}

export function normVinKey(vin) {
  return String(vin || '').trim().toUpperCase()
}

export function draftCompanyName(d) {
  const p = (d && d.payload) || {}
  return String(p.company_rep || p.customer_name || d.customerName || '').trim()
}

export function isoInRange(iso, from, to) {
  if (!iso) return false
  if (from && iso < from) return false
  if (to && iso > to) return false
  return true
}

export function vehicleDateIso(v, type) {
  if (!v) return ''
  if (type === 'proforma') return String(v.proformaDate || '').slice(0, 10)
  if (type === 'invoice') return String(v.invoiceDate || '').slice(0, 10)
  return String(v.deliveryNoteDate || '').slice(0, 10)
}

export function vehicleByVin(allVehicles) {
  const map = new Map()
  ;(allVehicles || []).forEach((v) => {
    const vin = normVinKey(v.vin)
    if (vin) map.set(vin, v)
  })
  return map
}

/**
 * @param {{ type: string, from: string, to: string, legacyDate?: string, selectedCompany?: string }} filter
 * @param {{ vehicles: any[], queue: any[], drafts: any[] }} data
 */
export function scopedVinSet(filter, data) {
  const { type, from, to } = filter
  if (!from && !to) return null

  if (type === 'delivery_note') {
    const set = new Set()
    ;(data.drafts || []).forEach((d) => {
      const iso = draftEventIso(d)
      if (!iso || !isoInRange(iso, from, to)) return
      const vin = normVinKey(d.vin)
      if (vin) set.add(vin)
    })
    return set
  }

  const set = new Set()
  ;(data.vehicles || []).forEach((v) => {
    const iso = vehicleDateIso(v, type)
    if (!iso || !isoInRange(iso, from, to)) return
    const vin = normVinKey(v.vin)
    if (vin) set.add(vin)
  })
  return set
}

export function dateScopedDrafts(filter, data) {
  const legacy = filter.legacyDate || ''
  let list = data.drafts || []
  if (legacy) {
    list = list.filter((d) => draftEventIso(d) === legacy)
  }

  const { type, from, to } = filter
  if (!from && !to) return list

  if (type === 'delivery_note') {
    return list.filter((d) => {
      const iso = draftEventIso(d)
      return iso && isoInRange(iso, from, to)
    })
  }

  const vins = scopedVinSet(filter, data)
  if (!vins || !vins.size) return []
  return list.filter((d) => vins.has(normVinKey(d.vin)))
}

export function companyVinSet(filter, data) {
  if (!filter.selectedCompany) return null
  const set = new Set()
  dateScopedDrafts(filter, data).forEach((d) => {
    if (draftCompanyName(d) !== filter.selectedCompany) return
    const vin = normVinKey(d.vin)
    if (vin) set.add(vin)
  })
  return set
}

export function filteredDrafts(filter, data) {
  let list = dateScopedDrafts(filter, data)
  if (filter.selectedCompany) {
    list = list.filter((d) => draftCompanyName(d) === filter.selectedCompany)
  }
  return list
}

export function filteredQueue(filter, data) {
  let queue
  const vins = scopedVinSet(filter, data)
  if (!vins) queue = data.queue || []
  else if (!vins.size) queue = []
  else queue = (data.queue || []).filter((q) => vins.has(normVinKey(q.vin)))

  const companyVins = companyVinSet(filter, data)
  if (companyVins) {
    queue = queue.filter((q) => companyVins.has(normVinKey(q.vin)))
  }
  return queue
}

export function vehiclesFromVinSet(vins, data) {
  const byVin = vehicleByVin(data.vehicles)
  const list = []
  ;(vins || new Set()).forEach((vin) => {
    const v = byVin.get(vin)
    if (v) {
      list.push(v)
      return
    }
    const draft = (data.drafts || []).find((d) => normVinKey(d.vin) === vin)
    const q = (data.queue || []).find((item) => normVinKey(item.vin) === vin)
    list.push({
      vin,
      product: draft?.product || q?.product || '',
      model: draft?.model || q?.model || '',
      plate: draft?.plate || q?.plate || '',
      customerName: draft?.customerName || q?.customerName || '',
      location: draft?.location || q?.location || '',
      gt: draft?.gt || q?.gt || '',
      imageUrl: '',
      proformaDate: '',
      invoiceDate: '',
      deliveryNoteDate: draft ? draftEventIso(draft) : '',
    })
  })
  return list
}

export function filteredVehicleList(filter, data) {
  const { type, from, to } = filter
  const companyVins = companyVinSet(filter, data)

  if (!from && !to) {
    if (companyVins) return vehiclesFromVinSet(companyVins, data)
    return data.vehicles || []
  }

  let vins = scopedVinSet(filter, data) || new Set()
  if (companyVins) {
    vins = new Set([...vins].filter((vin) => companyVins.has(vin)))
  }
  const list = vehiclesFromVinSet(vins, data)

  if (type === 'proforma' || type === 'invoice') {
    return list.sort((a, b) =>
      String(vehicleDateIso(a, type)).localeCompare(String(vehicleDateIso(b, type))),
    )
  }
  return list
}

export function tallyField(rows, getter) {
  const map = new Map()
  ;(rows || []).forEach((row) => {
    const name = String(getter(row) || '').trim()
    if (!name || name === '-' || name.startsWith('—')) return
    map.set(name, (map.get(name) || 0) + 1)
  })
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar'))
}

export function computeQueueStats(queue, draftsCount) {
  const list = queue || []
  const stats = {
    total: list.length,
    available: 0,
    in_stock: 0,
    ready_for_delivery: 0,
    out_of_delivery: 0,
    delivered: 0,
    drafts: draftsCount || 0,
  }
  list.forEach((q) => {
    if (q.status === 'available') stats.available += 1
    if (q.agentStatus === 'in_stock') stats.in_stock += 1
    if (q.agentStatus === 'ready_for_delivery') stats.ready_for_delivery += 1
    if (q.agentStatus === 'out_of_delivery') stats.out_of_delivery += 1
    if (q.agentStatus === 'delivered') stats.delivered += 1
  })
  return stats
}

export function deliveredOfTotalStats(filter, data) {
  const queue = filteredQueue(filter, data)
  const vehicles = filteredVehicleList(filter, data)
  const drafts = filteredDrafts(filter, data)
  const { type, from, to } = filter
  const hasDate = Boolean(from || to)

  let delivered = queue.filter((q) => q.agentStatus === 'delivered').length
  let total = queue.length
  if (!total && (type === 'proforma' || type === 'invoice')) {
    total = vehicles.length
    const vinSet = new Set(vehicles.map((v) => normVinKey(v.vin)))
    delivered = (data.queue || []).filter(
      (q) => vinSet.has(normVinKey(q.vin)) && q.agentStatus === 'delivered',
    ).length
  }
  if (!total && drafts.length) {
    total = drafts.length
    delivered = drafts.length
  }
  if (!total && !hasDate) {
    total = (data.queue || []).length || (data.vehicles || []).length
    delivered = (data.queue || []).filter((q) => q.agentStatus === 'delivered').length
  }

  const pct = total ? Math.round((delivered / total) * 1000) / 10 : 0
  return { delivered, total, pct, remaining: Math.max(0, total - delivered) }
}

export function deliveryStatusRows(filter, data) {
  const queue = filteredQueue(filter, data)
  let delivered = 0
  let still = 0
  queue.forEach((q) => {
    if (q.agentStatus === 'delivered') delivered += 1
    else still += 1
  })
  if (!queue.length && (data.drafts || []).length) {
    const drafts = filteredDrafts(filter, data)
    delivered = drafts.length
    still = 0
  }
  return [
    { name: 'تم الترحيل', count: delivered, color: '#22C55E' },
    { name: 'متبقي', count: still, color: '#F59E0B' },
  ].filter((r) => r.count > 0 || delivered + still > 0)
}

export function draftsByDay(drafts) {
  const map = new Map()
  ;(drafts || []).forEach((d) => {
    const iso = draftEventIso(d)
    if (!iso) return
    map.set(iso, (map.get(iso) || 0) + 1)
  })
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))
}

export function uniqueCompanies(drafts) {
  return new Set((drafts || []).map(draftCompanyName).filter(Boolean)).size
}

export function uniqueBranches(drafts) {
  return new Set(
    (drafts || [])
      .map((d) => String((d.payload || {}).branch_to || '').trim())
      .filter((n) => n && n !== '-'),
  ).size
}
