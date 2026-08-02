import * as XLSX from 'xlsx'

const WAREHOUSE_SPECIAL_NAME = 'مستودع الهاتفية'

function excelStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function isWarehouseDraft(d) {
  const p = (d && d.payload) || {}
  if (p.deliveryMode === 'warehouse' || p.warehouse_group === true) return true
  const branch = String(p.branch_to || '').trim()
  if (branch === 'المستودع' || branch === 'في المستودع') return true
  if (String(p.company_rep || '').includes('مستودع')) return true
  return false
}

function draftCarWeight(d) {
  const p = (d && d.payload) || {}
  const list = [
    ...(Array.isArray(d.vins) ? d.vins : []),
    d.vin,
    ...(Array.isArray(p.vins) ? p.vins : []),
    ...((Array.isArray(p.cars) ? p.cars : []).map((c) => c && (c.chassis || c.vin))),
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
  return Math.max(1, new Set(list).size)
}

function aggregateCompanyCities(drafts) {
  const companies = new Map()
  let warehouseTotal = 0

  ;(drafts || []).forEach((d) => {
    if (isWarehouseDraft(d)) {
      warehouseTotal += draftCarWeight(d)
      return
    }
    const p = d.payload || {}
    const company = String(p.company_rep || p.customer_name || d.customerName || '').trim()
    const city = String(p.branch_to || '').trim()
    if (!company || !city || company === '-' || city === '-' || city === 'المستودع') return
    if (!companies.has(company)) companies.set(company, { total: 0, cities: new Map() })
    const entry = companies.get(company)
    const weight = draftCarWeight(d)
    entry.total += weight
    entry.cities.set(city, (entry.cities.get(city) || 0) + weight)
  })

  const rows = Array.from(companies.entries())
    .map(([company, info]) => ({
      company,
      total: info.total,
      cities: Array.from(info.cities.entries())
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, 'ar')),
    }))
    .sort((a, b) => b.total - a.total || a.company.localeCompare(b.company, 'ar'))

  return {
    rows,
    warehouse: warehouseTotal > 0 ? { company: WAREHOUSE_SPECIAL_NAME, total: warehouseTotal } : null,
  }
}

/** Same sheet structure as legacy exportAllToExcel */
export function exportAllToExcel({ vehicles, queue, drafts, dashboard }) {
  const allVehicles = vehicles || []
  const allQueue = queue || []
  const allDrafts = drafts || []
  const lastDashboard = dashboard || {}

  const hasAny = allVehicles.length || allQueue.length || allDrafts.length
  if (!hasAny) throw new Error('لا توجد بيانات للتصدير')

  const wb = XLSX.utils.book_new()

  const inventoryRows = allVehicles.map((v) => ({
    'Chassis / VIN': v.vin || '',
    Product: v.product || v.model || '',
    Plate: v.plate || '',
    Customer: v.customerName || '',
    Location: v.location || '',
    GT: v.gt || '',
    Model: v.model || '',
    'Image URL': v.imageUrl || '',
    'Proforma Date': v.proformaDate || '',
    'Invoice Date': v.invoiceDate || '',
    'Delivery Note Date': v.deliveryNoteDate || '',
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(inventoryRows.length ? inventoryRows : [{ 'Chassis / VIN': '' }]),
    'Vehicle Inventory',
  )

  const queueRows = allQueue.map((item) => {
    const isWh =
      item.deliveryMode === 'warehouse' || String(item.statusLabel || '').includes('المستودع')
    return {
      'Chassis / VIN': item.vin || '',
      Product: item.product || item.model || '',
      GT: item.gt || '',
      Location: item.location || '',
      'Assigned To': item.assignedTo || '',
      Status: item.status || '',
      'Status Label': item.statusLabel || '',
      'Agent Status': item.agentStatus || '',
      'Delivery Mode': isWh ? 'warehouse' : item.agentStatus === 'delivered' ? 'memo' : '',
      Classification:
        item.status === 'available'
          ? 'متاح'
          : isWh
            ? 'تم التسليم في المستودع'
            : item.statusLabel || (item.agentStatus === 'delivered' ? 'تم الترحيل' : 'محجوز'),
      Plate: item.plate || '',
      Customer: item.customerName || '',
      'Added At': item.addedAt || '',
      'Assigned At': item.assignedAt || '',
    }
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(queueRows.length ? queueRows : [{ 'Chassis / VIN': '' }]),
    'Coordinator Queue',
  )

  const draftRows = allDrafts.map((d) => {
    const p = d.payload || {}
    const isWh = isWarehouseDraft(d)
    const vinList = [
      ...(Array.isArray(d.vins) ? d.vins : []),
      d.vin,
      ...(Array.isArray(p.vins) ? p.vins : []),
      ...((Array.isArray(p.cars) ? p.cars : []).map((c) => c && (c.chassis || c.vin))),
    ]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
    const uniqueVins = [...new Set(vinList)]
    const ownerName =
      p.warehouse?.owner_name || p.customer_name || p.company_rep || d.customerName || ''
    return {
      'Draft ID': d.id || '',
      'Printed At': d.printedAt || '',
      'Chassis / VIN': uniqueVins[0] || d.vin || '',
      'All VINs': uniqueVins.join(', '),
      'Car Count': uniqueVins.length || 1,
      Product: d.product || d.model || '',
      'Assigned To': d.assignedTo || '',
      Section: isWh ? 'في المستودع' : 'شركات النقل',
      'Delivery Type': isWh ? 'warehouse' : 'memo',
      'Company Name': isWh ? WAREHOUSE_SPECIAL_NAME : p.company_rep || '',
      'Company Rep': isWh ? ownerName : p.customer_name || d.customerName || '',
      'Branch To': isWh ? 'في المستودع' : p.branch_to || '',
      'Branch From': p.branch_from || '',
      Plate: p.plate || d.plate || '',
      GT: p.gt || d.gt || '',
      Location: p.location || d.location || '',
      Remarks: p.remarks || '',
      'Customer ID': p.customer_id || '',
      Phone: p.phone || p.warehouse?.user_phone || '',
    }
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(draftRows.length ? draftRows : [{ 'Draft ID': '' }]),
    'Print Drafts',
  )

  const { rows: companyCityAgg, warehouse: whAgg } = aggregateCompanyCities(allDrafts)
  const companyCityRows = []
  if (whAgg) {
    companyCityRows.push({
      Section: 'في المستودع',
      Company: WAREHOUSE_SPECIAL_NAME,
      City: 'في المستودع',
      Cars: whAgg.total,
    })
  }
  companyCityAgg.forEach((row) => {
    ;(row.cities || []).forEach((cityRow) => {
      companyCityRows.push({
        Section: 'شركات النقل',
        Company: row.company,
        City: cityRow.city,
        Cars: cityRow.count,
      })
    })
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      companyCityRows.length ? companyCityRows : [{ Section: '', Company: '', City: '', Cars: 0 }],
    ),
    'Company by City',
  )

  const topProducts = lastDashboard.topProducts || []
  const productRows = topProducts.map((p) => ({
    Product: p.product || '',
    Count: p.count != null ? p.count : 0,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(productRows.length ? productRows : [{ Product: '', Count: 0 }]),
    'Products',
  )

  const warehouseDraftCount = allDrafts.filter(isWarehouseDraft).length
  const warehouseCarCount = whAgg ? whAgg.total : 0
  const summary = [
    {
      'Total Vehicles': lastDashboard.totalVehicles || allVehicles.length,
      'Unique Products': lastDashboard.uniqueProducts || 0,
      'Queue Total': allQueue.length,
      'Drafts Total': allDrafts.length,
      'Warehouse Drafts': warehouseDraftCount,
      'Warehouse Cars': warehouseCarCount,
      'Warehouse Label': WAREHOUSE_SPECIAL_NAME,
      Filename: lastDashboard.filename || '',
      'Sheet Name': lastDashboard.sheetName || '',
      'Uploaded At': lastDashboard.uploadedAt || '',
      'Exported At': new Date().toISOString(),
    },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')

  XLSX.writeFile(wb, `delivery_export_${excelStamp()}.xlsx`)
  return {
    vehicles: allVehicles.length,
    queue: allQueue.length,
    drafts: allDrafts.length,
  }
}
