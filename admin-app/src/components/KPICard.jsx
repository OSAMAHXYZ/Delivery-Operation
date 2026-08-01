import { motion } from 'framer-motion'

const accentMap = {
  primary: '#3B82F6',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  muted: '#64748B',
}

export default function KPICard({
  icon: Icon,
  label,
  value,
  trend,
  accent = 'primary',
}) {
  const color = accentMap[accent] || accentMap.primary
  return (
    <motion.div
      className="kpi-card glass-card"
      whileHover={{ y: -4, transition: { duration: 0.18 } }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="kpi-card__icon" style={{ color, background: `${color}22` }}>
        {Icon ? <Icon size={18} strokeWidth={2} aria-hidden /> : null}
      </div>
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">{value}</div>
      {trend ? <div className="kpi-card__trend">{trend}</div> : null}
      <span className="kpi-card__accent" style={{ background: color }} />
      <style>{`
        .kpi-card {
          position: relative;
          padding: 18px 18px 16px;
          overflow: hidden;
          min-height: 128px;
        }
        .kpi-card__icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          margin-bottom: 14px;
        }
        .kpi-card__label {
          font-size: 14px;
          color: var(--muted);
          font-weight: 500;
        }
        .kpi-card__value {
          margin-top: 6px;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.1;
        }
        .kpi-card__trend {
          margin-top: 8px;
          font-size: 12px;
          color: var(--muted);
        }
        .kpi-card__accent {
          position: absolute;
          inset-inline-start: 0;
          top: 18px;
          bottom: 18px;
          width: 3px;
          border-radius: 999px;
          opacity: 0.9;
        }
      `}</style>
    </motion.div>
  )
}
