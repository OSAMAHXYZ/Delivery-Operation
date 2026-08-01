import { motion } from 'framer-motion'

export default function HeroProgress({ pct, delivered, remaining, total, caption }) {
  return (
    <motion.section
      className="hero glass-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="hero__copy">
        <p className="hero__eyebrow">Delivery Progress</p>
        <h1>تقدم الترحيل</h1>
        <p className="hero__caption muted">{caption}</p>
      </div>
      <div className="hero__metric">
        <motion.div
          className="hero__pct"
          key={pct}
          initial={{ opacity: 0.4, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          {pct}%
        </motion.div>
        <div className="hero__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <motion.span
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, pct || 0)}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <div className="hero__stats">
          <div><b>{delivered}</b><span>تم الترحيل</span></div>
          <div><b>{remaining}</b><span>متبقي</span></div>
          <div><b>{total}</b><span>الإجمالي</span></div>
        </div>
      </div>
      <style>{`
        .hero {
          display: grid;
          grid-template-columns: 1.1fr 1.4fr;
          gap: 28px;
          padding: 28px 30px;
          background:
            radial-gradient(ellipse 60% 80% at 100% 0%, rgba(59,130,246,0.18), transparent 55%),
            linear-gradient(135deg, rgba(255,255,255,0.04), transparent 40%),
            var(--card);
        }
        .hero__eyebrow {
          margin: 0 0 8px;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #93c5fd;
          font-weight: 600;
        }
        .hero h1 {
          margin: 0;
          font-size: clamp(24px, 3vw, 32px);
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .hero__caption { margin: 10px 0 0; font-size: 13px; max-width: 42ch; }
        .hero__pct {
          font-size: clamp(48px, 6vw, 72px);
          font-weight: 750;
          letter-spacing: -0.04em;
          line-height: 1;
          background: linear-gradient(180deg, #fff, #93c5fd);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .hero__bar {
          margin-top: 18px;
          height: 14px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          overflow: hidden;
          border: 1px solid var(--border);
        }
        .hero__bar span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #22c55e, #3b82f6);
        }
        .hero__stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 18px;
        }
        .hero__stats div {
          background: var(--card-2);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 12px 14px;
        }
        .hero__stats b {
          display: block;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .hero__stats span {
          font-size: 12px;
          color: var(--muted);
        }
        @media (max-width: 900px) {
          .hero { grid-template-columns: 1fr; }
        }
      `}</style>
    </motion.section>
  )
}
