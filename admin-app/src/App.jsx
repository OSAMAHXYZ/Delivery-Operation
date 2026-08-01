import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2,
  Car,
  CheckCircle2,
  MapPinned,
  Percent,
  Truck,
} from 'lucide-react'
import LoginGate from './components/LoginGate'
import Header from './components/Header'
import FilterToolbar from './components/FilterToolbar'
import KPICard from './components/KPICard'
import HeroProgress from './components/HeroProgress'
import SectionCard from './components/SectionCard'
import TopCompanyCard from './components/TopCompanyCard'
import DataTable from './components/DataTable'
import StatusBadge from './components/StatusBadge'
import { AreaTrendChart, HorizontalBarChart, StatusDonut } from './components/Charts'
import {
  fetchInventory,
  fetchQueueAdmin,
  fetchOptions,
  releaseVin,
  clearInventory,
  restoreExport,
  mergeDates,
  draftPdfUrl,
  addOption,
  removeOption,
} from './lib/api'
import { exportAllToExcel } from './lib/exportExcel'
import {
  getSaudiTodayIso,
  filteredDrafts,
  filteredQueue,
  filteredVehicleList,
  dateScopedDrafts,
  deliveredOfTotalStats,
  deliveryStatusRows,
  tallyField,
  draftCompanyName,
  draftsByDay,
  uniqueCompanies,
  uniqueBranches,
  computeQueueStats,
  draftEventIso,
} from './lib/filters'

const defaultFilter = {
  type: 'delivery_note',
  from: '',
  to: '',
  selectedCompany: '',
  city: '',
  status: '',
  search: '',
  coordinator: '',
  legacyDate: '',
}

function applyUiFilters(list, filter, kind) {
  let out = list || []
  if (filter.city) {
    out = out.filter((row) => {
      if (kind === 'draft') return String((row.payload || {}).branch_to || '') === filter.city
      return String(row.location || '') === filter.city
    })
  }
  if (filter.status) {
    if (kind === 'queue') {
      out = out.filter((q) => {
        if (filter.status === 'delivered') return q.agentStatus === 'delivered'
        if (filter.status === 'available') return q.status === 'available'
        if (filter.status === 'pending') {
          return q.status !== 'available' && q.agentStatus !== 'delivered'
        }
        return true
      })
    }
  }
  if (filter.search) {
    const s = filter.search.trim().toLowerCase()
    out = out.filter((row) => {
      const p = row.payload || {}
      const hay = [
        row.vin,
        row.product,
        row.model,
        row.plate,
        row.customerName,
        row.location,
        row.assignedTo,
        p.company_rep,
        p.customer_name,
        p.branch_to,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(s)
    })
  }
  if (filter.coordinator) {
    out = out.filter((row) => String(row.assignedTo || '') === filter.coordinator)
  }
  return out
}

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const [vehicles, setVehicles] = useState([])
  const [queue, setQueue] = useState([])
  const [drafts, setDrafts] = useState([])
  const [dashboard, setDashboard] = useState(null)
  const [options, setOptions] = useState({ companies: [], cities: [] })
  const [draftFilter, setDraftFilter] = useState(defaultFilter)
  const [applied, setApplied] = useState(defaultFilter)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activity, setActivity] = useState([])
  const restoreRef = useRef(null)
  const mergeRef = useRef(null)

  const data = useMemo(
    () => ({ vehicles, queue, drafts }),
    [vehicles, queue, drafts],
  )

  const pushActivity = useCallback((text) => {
    setActivity((prev) => [
      { id: `${Date.now()}-${Math.random()}`, text, at: new Date().toISOString() },
      ...prev,
    ].slice(0, 30))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, q] = await Promise.all([fetchInventory(), fetchQueueAdmin()])
      setVehicles(inv.vehicles || [])
      setDashboard(inv.dashboard || null)
      setQueue(q.queue || [])
      setDrafts(q.drafts || [])
      const opt = await fetchOptions().catch(() => ({ companies: [], cities: [] }))
      setOptions({
        companies: opt.companies || [],
        cities: opt.cities || [],
      })
    } catch (err) {
      setToast(err.message || 'خطأ في التحميل')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authed) return undefined
    load()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 45000)
    return () => clearInterval(t)
  }, [authed, load])

  const scopedDrafts = useMemo(() => filteredDrafts(applied, data), [applied, data])
  const scopedQueue = useMemo(() => filteredQueue(applied, data), [applied, data])
  const scopedVehicles = useMemo(() => filteredVehicleList(applied, data), [applied, data])
  const navDrafts = useMemo(() => dateScopedDrafts(applied, data), [applied, data])

  const draftsView = useMemo(
    () => applyUiFilters(scopedDrafts, applied, 'draft'),
    [scopedDrafts, applied],
  )
  const queueView = useMemo(
    () => applyUiFilters(scopedQueue, applied, 'queue'),
    [scopedQueue, applied],
  )
  const vehiclesView = useMemo(
    () => applyUiFilters(scopedVehicles, applied, 'vehicle'),
    [scopedVehicles, applied],
  )

  const progress = useMemo(() => deliveredOfTotalStats(applied, data), [applied, data])
  const statusRows = useMemo(() => deliveryStatusRows(applied, data), [applied, data])
  const companies = useMemo(
    () => tallyField(navDrafts, (d) => draftCompanyName(d)),
    [navDrafts],
  )
  const branches = useMemo(
    () => tallyField(scopedDrafts, (d) => (d.payload || {}).branch_to),
    [scopedDrafts],
  )
  const trend = useMemo(() => draftsByDay(scopedDrafts), [scopedDrafts])
  const qStats = useMemo(
    () => computeQueueStats(scopedQueue, scopedDrafts.length),
    [scopedQueue, scopedDrafts],
  )

  const companyTotal = companies.reduce((s, c) => s + c.count, 0) || 1
  const filterCompanyNames = useMemo(
    () => [...new Set([...companies.map((c) => c.name), ...(options.companies || [])])],
    [companies, options.companies],
  )
  const filterCityNames = useMemo(
    () => [...new Set([...branches.map((b) => b.name), ...(options.cities || [])])],
    [branches, options.cities],
  )

  const metaHtml = useMemo(() => {
    const companyBit = applied.selectedCompany
      ? ` · شركة <strong>${applied.selectedCompany}</strong>`
      : ''
    if (!applied.from && !applied.to) {
      return `عرض الكل${companyBit} · <strong>${draftsView.length}</strong> مسودة · <strong>${vehiclesView.length}</strong> مركبة`
    }
    return `فلتر نشط${companyBit} · <strong>${vehiclesView.length}</strong> سيارة · <strong>${draftsView.length}</strong> مسودة · قائمة <strong>${queueView.length}</strong>`
  }, [applied, draftsView, vehiclesView, queueView])

  function applyFilter() {
    setApplied({ ...draftFilter })
    pushActivity('تم تطبيق الفلتر')
  }

  function resetFilter() {
    setDraftFilter(defaultFilter)
    setApplied(defaultFilter)
    pushActivity('تم إعادة ضبط الفلاتر')
  }

  function todayFilter() {
    const today = getSaudiTodayIso()
    const next = { ...draftFilter, from: today, to: today }
    setDraftFilter(next)
    setApplied(next)
    pushActivity(`فلتر اليوم ${today}`)
  }

  function selectCompany(name) {
    const nextName = applied.selectedCompany === name ? '' : name
    const next = { ...applied, selectedCompany: nextName }
    setDraftFilter(next)
    setApplied(next)
    pushActivity(nextName ? `تصفية الشركة: ${nextName}` : 'إظهار كل الشركات')
  }

  async function handleExport() {
    try {
      const r = exportAllToExcel({ vehicles, queue, drafts, dashboard })
      setToast(`تم التصدير: ${r.vehicles} مركبة · ${r.queue} قائمة · ${r.drafts} مسودة`)
      pushActivity('تصدير Excel')
    } catch (err) {
      setToast(err.message)
    }
  }

  async function handleClear() {
    if (!window.confirm('مسح كل بيانات المخزون؟')) return
    try {
      await clearInventory()
      await load()
      setToast('تم المسح')
      pushActivity('مسح البيانات')
    } catch (err) {
      setToast(err.message)
    }
  }

  async function handleRelease(vin) {
    try {
      await releaseVin(vin)
      await load()
      pushActivity(`إتاحة ${vin}`)
    } catch (err) {
      setToast(err.message)
    }
  }

  if (!authed) {
    return <LoginGate onSuccess={() => setAuthed(true)} />
  }

  const draftCols = [
    {
      key: 'printedAt',
      label: 'التاريخ',
      render: (d) => (d.printedAt ? new Date(d.printedAt).toLocaleString('ar-SA') : '—'),
    },
    { key: 'vin', label: 'VIN' },
    {
      key: 'product',
      label: 'المنتج',
      render: (d) => d.product || d.model || '—',
    },
    { key: 'assignedTo', label: 'الوكيل' },
    {
      key: 'company',
      label: 'الشركة',
      render: (d) => draftCompanyName(d) || '—',
    },
    {
      key: 'branch',
      label: 'الفرع',
      render: (d) => (d.payload || {}).branch_to || '—',
    },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (d) =>
        d.id && d.payload ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <a className="btn btn--sm" href={draftPdfUrl(d.id, 'edit')} target="_blank" rel="noreferrer">
              تعديل
            </a>
            <a className="btn btn--sm btn--primary" href={draftPdfUrl(d.id, 'export')} target="_blank" rel="noreferrer">
              PDF
            </a>
          </span>
        ) : (
          '—'
        ),
    },
  ]

  const queueCols = [
    { key: 'vin', label: 'VIN' },
    { key: 'product', label: 'المنتج', render: (q) => q.product || '—' },
    { key: 'gt', label: 'GT', render: (q) => q.gt || '—' },
    { key: 'location', label: 'الموقع', render: (q) => q.location || '—' },
    { key: 'assignedTo', label: 'الوكيل', render: (q) => q.assignedTo || '—' },
    { key: 'status', label: 'الحالة', render: (q) => <StatusBadge item={q} /> },
    {
      key: 'actions',
      label: 'إجراء',
      render: (q) =>
        q.status === 'available' || q.agentStatus === 'delivered' ? null : (
          <button type="button" className="btn btn--sm" onClick={() => handleRelease(q.vin)}>
            إتاحة
          </button>
        ),
    },
  ]

  const invCols = [
    { key: 'vin', label: 'VIN' },
    { key: 'product', label: 'المنتج', render: (v) => v.product || v.model || '—' },
    { key: 'plate', label: 'اللوحة', render: (v) => v.plate || '—' },
    { key: 'customerName', label: 'العميل', render: (v) => v.customerName || '—' },
    { key: 'location', label: 'الموقع', render: (v) => v.location || '—' },
    { key: 'proformaDate', label: 'Proforma', render: (v) => v.proformaDate || '—' },
    { key: 'invoiceDate', label: 'Invoice', render: (v) => v.invoiceDate || '—' },
    {
      key: 'deliveryNoteDate',
      label: 'Delivery Note',
      render: (v) => v.deliveryNoteDate || draftEventIso(
        drafts.find((d) => d.vin === v.vin),
      ) || '—',
    },
  ]

  return (
    <div className="app-shell" dir="rtl">
      <Header
        onExport={handleExport}
        onLogout={() => setAuthed(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <FilterToolbar
        filter={draftFilter}
        onChange={setDraftFilter}
        companies={filterCompanyNames}
        cities={filterCityNames}
        coordinators={[...new Set(queue.map((q) => q.assignedTo).filter(Boolean))]}
        onApply={applyFilter}
        onReset={resetFilter}
        meta={metaHtml}
        resultCount={vehiclesView.length}
        totalCount={scopedVehicles.length}
      />

      {toast ? (
        <div className="toast glass-card" role="status">
          {toast}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setToast('')}>
            إغلاق
          </button>
        </div>
      ) : null}

      {loading ? <p className="muted" style={{ margin: 0 }}>جاري التحديث…</p> : null}

      <div className="grid-kpi">
        <KPICard icon={Car} label="إجمالي المركبات" value={vehiclesView.length} trend="ضمن النطاق الحالي" accent="primary" />
        <KPICard icon={CheckCircle2} label="تم الترحيل" value={progress.delivered} trend={`${progress.pct}% من الإجمالي`} accent="success" />
        <KPICard icon={Truck} label="متبقي" value={progress.remaining} trend="قيد التنفيذ / غير مرحّل" accent="warning" />
        <KPICard icon={Building2} label="الشركات" value={uniqueCompanies(scopedDrafts)} trend="من المذكرات المصفّاة" accent="primary" />
        <KPICard icon={MapPinned} label="الفروع" value={uniqueBranches(scopedDrafts)} trend="وجهات التحويل" accent="muted" />
        <KPICard icon={Percent} label="نسبة الترحيل" value={`${progress.pct}%`} trend={`${qStats.available} متاح في القائمة`} accent="success" />
      </div>

      <HeroProgress
        pct={progress.pct}
        delivered={progress.delivered}
        remaining={progress.remaining}
        total={progress.total}
        caption={
          progress.total
            ? `${progress.delivered} مُرحَّلة من أصل ${progress.total} · متبقي ${progress.remaining}`
            : 'لا توجد بيانات في النطاق الحالي'
        }
      />

      <div className="grid-2">
        <SectionCard title="اتجاهات الترحيل" subtitle="عدد المذكرات حسب يوم الطباعة">
          {trend.length ? (
            <AreaTrendChart
              categories={trend.map((t) => t.date)}
              series={[{ name: 'مذكرات', data: trend.map((t) => t.count) }]}
            />
          ) : (
            <div className="empty">لا توجد بيانات اتجاه بعد</div>
          )}
        </SectionCard>

        <SectionCard title="أبرز الشركات" subtitle="اضغط شركة لعرض بياناتها فقط">
          <div className="company-grid">
            {companies.slice(0, 6).map((c, i) => (
              <TopCompanyCard
                key={c.name}
                rank={i + 1}
                name={c.name}
                count={c.count}
                pct={Math.round((c.count / companyTotal) * 1000) / 10}
                active={applied.selectedCompany === c.name}
                onClick={() => selectCompany(c.name)}
              />
            ))}
            {!companies.length ? <div className="empty">لا توجد شركات بعد</div> : null}
          </div>
        </SectionCard>
      </div>

      <div className="grid-2 equal">
        <SectionCard title="تحليل الفروع" subtitle="ترتيب أفقي حسب عدد التحويلات">
          {branches.length ? (
            <HorizontalBarChart
              categories={branches.slice(0, 10).map((b) => b.name)}
              data={branches.slice(0, 10).map((b) => b.count)}
              color="#22C55E"
            />
          ) : (
            <div className="empty">لا توجد فروع في النطاق</div>
          )}
        </SectionCard>

        <SectionCard title="حالة الترحيل" subtitle="الدونات الوحيد في اللوحة">
          {statusRows.some((r) => r.count) ? (
            <StatusDonut
              labels={statusRows.map((r) => r.name)}
              series={statusRows.map((r) => r.count)}
              colors={statusRows.map((r) => r.color)}
            />
          ) : (
            <div className="empty">لا توجد حالات</div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="تحليل الشركات" subtitle="مقارنة أفقية لكل الشركات ضمن الفلتر">
        {companies.length ? (
          <HorizontalBarChart
            categories={companies.slice(0, 12).map((c) => c.name)}
            data={companies.slice(0, 12).map((c) => c.count)}
            color="#3B82F6"
            height={Math.max(280, Math.min(520, companies.slice(0, 12).length * 36))}
          />
        ) : (
          <div className="empty">لا توجد بيانات شركات</div>
        )}
      </SectionCard>

      <SectionCard title="آخر عمليات الترحيل" subtitle="المسودات المطبوعة ضمن النطاق">
        <DataTable
          columns={draftCols}
          rows={draftsView}
          searchKeys={['vin', 'product', 'assignedTo']}
          searchPlaceholder="بحث في المذكرات…"
          emptyText="لا توجد مذكرات"
        />
      </SectionCard>

      <div className="grid-2 equal">
        <SectionCard title="قائمة المنسق" subtitle="الحالات الحية للشاسيه">
          <DataTable
            columns={queueCols}
            rows={queueView}
            searchKeys={['vin', 'product', 'assignedTo', 'location']}
            searchPlaceholder="بحث في القائمة…"
            emptyText="القائمة فارغة"
          />
        </SectionCard>

        <SectionCard title="سجل النشاط" subtitle="أحداث هذه الجلسة">
          <ul className="activity">
            {activity.length ? (
              activity.map((a) => (
                <li key={a.id}>
                  <span>{a.text}</span>
                  <time>{new Date(a.at).toLocaleTimeString('ar-SA')}</time>
                </li>
              ))
            ) : (
              <li className="muted">لا يوجد نشاط بعد</li>
            )}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="المخزون" subtitle="المركبات ضمن الفلتر الحالي">
        <DataTable
          columns={invCols}
          rows={vehiclesView}
          searchKeys={['vin', 'product', 'plate', 'customerName', 'location']}
          searchPlaceholder="بحث في المخزون…"
          pageSize={12}
          emptyText="لا توجد مركبات"
        />
      </SectionCard>

      {settingsOpen ? (
        <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="الإعدادات">
          <div className="settings glass-card">
            <div className="section-card__head">
              <div>
                <h2>الإعدادات والأدوات</h2>
                <p>استعادة، دمج تواريخ، إدارة الشركات/الفروع</p>
              </div>
              <button type="button" className="btn btn--sm" onClick={() => setSettingsOpen(false)}>إغلاق</button>
            </div>

            <div className="settings-grid">
              <div>
                <h3>استعادة تصدير قديم</h3>
                <input ref={restoreRef} type="file" accept=".xlsx,.xls" hidden onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    const r = await restoreExport(file)
                    setToast(r.message || 'تم الاستيراد')
                    pushActivity('استعادة أرشيف Excel')
                    await load()
                  } catch (err) {
                    setToast(err.message)
                  } finally {
                    e.target.value = ''
                  }
                }} />
                <button type="button" className="btn btn--primary" onClick={() => restoreRef.current?.click()}>
                  اختيار ملف التصدير
                </button>
              </div>
              <div>
                <h3>دمج تواريخ Proforma/Invoice</h3>
                <input ref={mergeRef} type="file" accept=".xlsx,.xls" hidden onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    const r = await mergeDates(file)
                    setToast(r.message || 'تم الدمج')
                    pushActivity('دمج تواريخ Sales Raw')
                    await load()
                  } catch (err) {
                    setToast(err.message)
                  } finally {
                    e.target.value = ''
                  }
                }} />
                <button type="button" className="btn" onClick={() => mergeRef.current?.click()}>
                  تحديث من Sales Raw
                </button>
              </div>
              <div>
                <h3>مسح البيانات</h3>
                <button type="button" className="btn btn--danger" onClick={handleClear}>مسح المخزون</button>
              </div>
            </div>

            <OptionsManager
              options={options}
              onChanged={async () => {
                const opt = await fetchOptions()
                setOptions({ companies: opt.companies || [], cities: opt.cities || [] })
              }}
              onToast={setToast}
            />
          </div>
        </div>
      ) : null}

      <style>{`
        .company-grid {
          display: grid;
          gap: 10px;
        }
        .toast {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 16px;
          border-color: rgba(59,130,246,0.35);
        }
        .activity {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 8px;
          max-height: 420px;
          overflow: auto;
        }
        .activity li {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 12px;
          background: var(--card-2);
          border: 1px solid var(--border);
          font-size: 13px;
        }
        .activity time { color: var(--muted); font-size: 11px; white-space: nowrap; }
        .settings-backdrop {
          position: fixed;
          inset: 0;
          z-index: 80;
          background: rgba(2, 6, 23, 0.72);
          display: grid;
          place-items: center;
          padding: 20px;
        }
        .settings {
          width: min(840px, 100%);
          max-height: min(90vh, 900px);
          overflow: auto;
          padding: 22px;
        }
        .settings-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-bottom: 18px;
        }
        .settings-grid > div,
        .options-box {
          background: var(--card-2);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 14px;
        }
        .settings-grid h3,
        .options-box h3 {
          margin: 0 0 10px;
          font-size: 14px;
        }
        @media (max-width: 900px) {
          .settings-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}

function OptionsManager({ options, onChanged, onToast }) {
  const [company, setCompany] = useState('')
  const [city, setCity] = useState('')

  async function add(kind, value, clear) {
    try {
      await addOption(kind, value)
      clear('')
      await onChanged()
      onToast('تمت الإضافة')
    } catch (err) {
      onToast(err.message)
    }
  }

  async function remove(kind, name) {
    try {
      await removeOption(kind, name)
      await onChanged()
      onToast('تم الحذف')
    } catch (err) {
      onToast(err.message)
    }
  }

  return (
    <div className="grid-2 equal">
      <div className="options-box">
        <h3>شركات النقل</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className="field" style={{ flex: 1, background: '#0f172a', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', color: 'inherit' }} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="اسم الشركة" />
          <button type="button" className="btn btn--primary btn--sm" onClick={() => add('companies', company, setCompany)}>إضافة</button>
        </div>
        <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflow: 'auto' }}>
          {(options.companies || []).slice(0, 40).map((name) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span>{name}</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => remove('companies', name)}>حذف</button>
            </div>
          ))}
        </div>
      </div>
      <div className="options-box">
        <h3>الفروع / المدن</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input style={{ flex: 1, background: '#0f172a', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', color: 'inherit' }} value={city} onChange={(e) => setCity(e.target.value)} placeholder="اسم الفرع" />
          <button type="button" className="btn btn--primary btn--sm" onClick={() => add('cities', city, setCity)}>إضافة</button>
        </div>
        <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflow: 'auto' }}>
          {(options.cities || []).slice(0, 40).map((name) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span>{name}</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => remove('cities', name)}>حذف</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
