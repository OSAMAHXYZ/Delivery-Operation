import * as XLSX from 'xlsx'

function excelStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
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

  const queueRows = allQueue.map((item) => ({
    'Chassis / VIN': item.vin || '',
    Product: item.product || item.model || '',
    GT: item.gt || '',
    Location: item.location || '',
    'Assigned To': item.assignedTo || '',
    Status: item.status || '',
    'Status Label': item.statusLabel || '',
    'Agent Status': item.agentStatus || '',
    Classification:
      item.status === 'available'
        ? 'متاح'
        : item.agentStatus === 'delivered'
          ? 'تم الترحيل'
          : 'محجوز',
    Plate: item.plate || '',
    Customer: item.customerName || '',
    'Added At': item.addedAt || '',
    'Assigned At': item.assignedAt || '',
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(queueRows.length ? queueRows : [{ 'Chassis / VIN': '' }]),
    'Coordinator Queue',
  )

  const draftRows = allDrafts.map((d) => {
    const p = d.payload || {}
    return {
      'Draft ID': d.id || '',
      'Printed At': d.printedAt || '',
      'Chassis / VIN': d.vin || '',
      Product: d.product || d.model || '',
      'Assigned To': d.assignedTo || '',
      'Company Name': p.company_rep || '',
      'Company Rep': p.customer_name || d.customerName || '',
      'Branch To': p.branch_to || '',
      'Branch From': p.branch_from || '',
      Plate: p.plate || d.plate || '',
      GT: p.gt || d.gt || '',
      Location: p.location || d.location || '',
      Remarks: p.remarks || '',
      'Customer ID': p.customer_id || '',
      Phone: p.phone || '',
    }
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(draftRows.length ? draftRows : [{ 'Draft ID': '' }]),
    'Print Drafts',
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

  const summary = [
    {
      'Total Vehicles': lastDashboard.totalVehicles || allVehicles.length,
      'Unique Products': lastDashboard.uniqueProducts || 0,
      'Queue Total': allQueue.length,
      'Drafts Total': allDrafts.length,
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
