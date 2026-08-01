import { useMemo, useState } from 'react'

function compare(a, b, key) {
  const av = a[key]
  const bv = b[key]
  if (av == null && bv == null) return 0
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av ?? '').localeCompare(String(bv ?? ''), 'ar')
}

export default function DataTable({
  columns,
  rows,
  searchKeys = [],
  pageSize = 10,
  emptyText = 'لا توجد بيانات',
  searchPlaceholder = 'بحث…',
}) {
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState(columns[0]?.key || '')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    let list = rows || []
    if (s && searchKeys.length) {
      list = list.filter((row) =>
        searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(s)),
      )
    }
    const sorted = [...list].sort((a, b) => {
      const c = compare(a, b, sortKey)
      return sortDir === 'asc' ? c : -c
    })
    return sorted
  }, [rows, q, searchKeys, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const slice = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div>
      <div className="table-toolbar">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} نتيجة</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} onClick={() => toggleSort(col.key)} scope="col">
                  {col.label}
                  {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length ? (
              slice.map((row, i) => (
                <tr key={row.id || row.vin || i}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="empty">{emptyText}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <button type="button" className="btn btn--sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          السابق
        </button>
        <span>
          صفحة {safePage + 1} / {pageCount}
        </span>
        <button
          type="button"
          className="btn btn--sm"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          التالي
        </button>
      </div>
    </div>
  )
}
