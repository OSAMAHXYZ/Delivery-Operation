import { motion } from 'framer-motion'

export default function TopCompanyCard({ rank, name, count, pct, active, onClick }) {
  return (
    <motion.button
      type="button"
      className={`company-card ${active ? 'is-active' : ''}`}
      onClick={onClick}
      whileHover={{ y: -2 }}
      aria-pressed={active}
    >
      <div className="company-card__top">
        <span className="company-card__rank">#{rank}</span>
        <span className="company-card__pct">{pct}%</span>
      </div>
      <div className="company-card__name" title={name}>{name}</div>
      <div className="company-card__meta">{count} مركبة / مذكرة</div>
      <div className="company-card__bar">
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, pct)}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
      <style>{`
        .company-card {
          display: block;
          width: 100%;
          text-align: right;
          background: var(--card-2);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 14px 16px;
          color: inherit;
          cursor: pointer;
        }
        .company-card.is-active,
        .company-card:hover {
          border-color: rgba(59,130,246,0.45);
          background: rgba(59,130,246,0.08);
        }
        .company-card__top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .company-card__rank {
          font-size: 12px;
          font-weight: 700;
          color: #93c5fd;
          background: rgba(59,130,246,0.12);
          border-radius: 999px;
          padding: 2px 8px;
        }
        .company-card__pct {
          font-size: 13px;
          font-weight: 700;
          color: var(--text);
        }
        .company-card__name {
          font-size: 14px;
          font-weight: 650;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .company-card__meta {
          margin-top: 4px;
          font-size: 12px;
          color: var(--muted);
        }
        .company-card__bar {
          margin-top: 12px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          overflow: hidden;
        }
        .company-card__bar span {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #22c55e);
          border-radius: inherit;
        }
      `}</style>
    </motion.button>
  )
}
