import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Calendar,
  Building2,
  MapPin,
  Truck,
  User,
  Filter,
  RotateCcw,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="ft-search">
      <Search className="ft-search__icon" size={18} aria-hidden />
      <input
        className="ft-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search by VIN, Company, Branch...'}
        aria-label="Search"
      />
      {value ? (
        <button type="button" className="ft-search__clear is-visible" onClick={() => onChange('')} aria-label="Clear search">
          <X size={14} />
        </button>
      ) : null}
    </div>
  )
}

function FilterChip({ label, onClear }) {
  return (
    <motion.span
      className="ft-chip"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label}`}>
        <X size={12} />
      </button>
    </motion.span>
  )
}

function SearchableSelect({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  placeholder,
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const root = useRef(null)
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return options
    return options.filter((o) => String(o.label || o).toLowerCase().includes(s))
  }, [options, q])

  useEffect(() => {
    const onDoc = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const display = value
    ? options.find((o) => (o.value ?? o) === value)?.label || value
    : placeholder || label

  return (
    <div className={`ft-control${open ? ' is-open' : ''}`} ref={root}>
      <button
        type="button"
        className="ft-control__trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {Icon ? <Icon size={16} className="ft-control__icon" /> : null}
        <span className={`ft-control__value${value ? '' : ' is-placeholder'}`}>{display}</span>
      </button>
      <span className="ft-control__chevron">▾</span>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="ft-panel"
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <div className="ft-panel__search">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${label}…`}
                autoFocus
              />
            </div>
            <button type="button" className="ft-option" onClick={() => { onChange(''); setOpen(false); setQ('') }}>
              All {label}
            </button>
            {filtered.map((o) => {
              const val = o.value ?? o
              const text = o.label ?? o
              return (
                <button
                  key={val}
                  type="button"
                  className={`ft-option${val === value ? ' is-active' : ''}`}
                  onClick={() => { onChange(val); setOpen(false); setQ('') }}
                >
                  {text}
                </button>
              )
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function DateRangePicker({ from, to, onChange }) {
  const [open, setOpen] = useState(false)
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)
  const root = useRef(null)

  useEffect(() => {
    setLocalFrom(from)
    setLocalTo(to)
  }, [from, to])

  useEffect(() => {
    const onDoc = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const label = from || to ? `${from || '…'} → ${to || '…'}` : 'Date Range'

  return (
    <div className={`ft-control ft-control--date${open ? ' is-open' : ''}`} ref={root}>
      <button type="button" className="ft-control__trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Calendar size={16} />
        <span className={`ft-control__value${from || to ? '' : ' is-placeholder'}`}>{label}</span>
      </button>
      <span className="ft-control__chevron">▾</span>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="ft-panel ft-date-panel"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <label>
              From
              <input type="date" value={localFrom} onChange={(e) => setLocalFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={localTo} onChange={(e) => setLocalTo(e.target.value)} />
            </label>
            <div className="ft-date-actions">
              <button
                type="button"
                className="ft-btn ft-btn--ghost"
                style={{ height: 40, flex: 1 }}
                onClick={() => {
                  const t = new Date().toISOString().slice(0, 10)
                  setLocalFrom(t)
                  setLocalTo(t)
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="ft-btn ft-btn--primary"
                style={{ height: 40, flex: 1 }}
                onClick={() => {
                  onChange({ from: localFrom, to: localTo })
                  setOpen(false)
                }}
              >
                Done
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function CompanySelect(props) {
  return <SearchableSelect icon={Building2} label="Company" placeholder="Company" {...props} />
}
export function BranchSelect(props) {
  return <SearchableSelect icon={MapPin} label="Branch" placeholder="Branch" {...props} />
}
export function StatusSelect(props) {
  return <SearchableSelect icon={Truck} label="Status" placeholder="Status" {...props} />
}
export function CoordinatorSelect(props) {
  return <SearchableSelect icon={User} label="Coordinator" placeholder="Coordinator" {...props} />
}

export function ApplyButton({ onClick }) {
  return (
    <motion.button
      type="button"
      className="ft-btn ft-btn--primary"
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
    >
      <Filter size={16} />
      Apply Filters
    </motion.button>
  )
}

export function ResetButton({ onClick }) {
  return (
    <motion.button
      type="button"
      className="ft-btn ft-btn--ghost"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
    >
      <RotateCcw size={16} />
      Reset
    </motion.button>
  )
}

export default function FilterToolbar({
  filter,
  onChange,
  companies = [],
  cities = [],
  coordinators = [],
  onApply,
  onReset,
  meta,
  resultCount,
  totalCount,
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const companyOpts = companies.map((c) => ({ value: c, label: c }))
  const cityOpts = cities.map((c) => ({ value: c, label: c }))
  const coordOpts = coordinators.map((c) => ({ value: c, label: c }))
  const statusOpts = [
    { value: 'delivered', label: 'Delivered' },
    { value: 'pending', label: 'Pending' },
    { value: 'available', label: 'Available' },
  ]

  const chips = []
  if (filter.from || filter.to) {
    chips.push({
      key: 'date',
      label: `${filter.from || '…'} → ${filter.to || '…'}`,
      clear: () => onChange({ ...filter, from: '', to: '' }),
    })
  }
  if (filter.selectedCompany) {
    chips.push({
      key: 'company',
      label: filter.selectedCompany,
      clear: () => onChange({ ...filter, selectedCompany: '' }),
    })
  }
  if (filter.city) {
    chips.push({ key: 'city', label: filter.city, clear: () => onChange({ ...filter, city: '' }) })
  }
  if (filter.status) {
    const label = statusOpts.find((s) => s.value === filter.status)?.label || filter.status
    chips.push({ key: 'status', label, clear: () => onChange({ ...filter, status: '' }) })
  }
  if (filter.coordinator) {
    chips.push({
      key: 'coordinator',
      label: filter.coordinator,
      clear: () => onChange({ ...filter, coordinator: '' }),
    })
  }
  if (filter.search) {
    chips.push({
      key: 'search',
      label: `“${filter.search}”`,
      clear: () => onChange({ ...filter, search: '' }),
    })
  }

  return (
    <motion.div
      className="ft-shell"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      role="search"
      aria-label="Filter toolbar"
    >
      <div className="ft-toolbar">
        <SearchInput
          value={filter.search || ''}
          onChange={(search) => onChange({ ...filter, search })}
        />
        <DateRangePicker
          from={filter.from || ''}
          to={filter.to || ''}
          onChange={({ from, to }) => onChange({ ...filter, from, to })}
        />
        <CompanySelect
          value={filter.selectedCompany || ''}
          options={companyOpts}
          onChange={(selectedCompany) => onChange({ ...filter, selectedCompany })}
        />
        <BranchSelect
          value={filter.city || ''}
          options={cityOpts}
          onChange={(city) => onChange({ ...filter, city })}
        />
        <StatusSelect
          value={filter.status || ''}
          options={statusOpts}
          onChange={(status) => onChange({ ...filter, status })}
        />
        <div className="ft-actions">
          <div className={`ft-more${moreOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className={`ft-btn ft-btn--more${moreOpen ? ' is-active' : ''}`}
              onClick={() => setMoreOpen((v) => !v)}
            >
              More Filters
            </button>
            {moreOpen ? (
              <div className="ft-more__panel">
                <div>
                  <div className="ft-more__label">Date type</div>
                  <select
                    className="ft-native"
                    value={filter.type}
                    onChange={(e) => onChange({ ...filter, type: e.target.value })}
                  >
                    <option value="delivery_note">Delivery note</option>
                    <option value="proforma">Proforma</option>
                    <option value="invoice">Invoice</option>
                  </select>
                </div>
                <div>
                  <div className="ft-more__label">Coordinator</div>
                  <CoordinatorSelect
                    value={filter.coordinator || ''}
                    options={coordOpts}
                    onChange={(coordinator) => onChange({ ...filter, coordinator })}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <ApplyButton onClick={onApply} />
          <ResetButton onClick={onReset} />
        </div>
      </div>

      <div className="ft-chips">
        <AnimatePresence>
          {chips.map((c) => (
            <FilterChip key={c.key} label={c.label} onClear={c.clear} />
          ))}
        </AnimatePresence>
        {chips.length ? (
          <button type="button" className="ft-chip ft-chip--clear" onClick={onReset}>
            Clear All
          </button>
        ) : null}
      </div>

      <p className="ft-meta">
        {typeof resultCount === 'number' && typeof totalCount === 'number'
          ? <>Showing <strong>{resultCount}</strong> of <strong>{totalCount}</strong> vehicles</>
          : null}
        {meta ? <> · <span dangerouslySetInnerHTML={{ __html: meta }} /></> : null}
      </p>
    </motion.div>
  )
}

export {
  SearchInput,
  DateRangePicker,
  FilterChip,
}
