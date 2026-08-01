export default function SectionCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`section-card glass-card ${className}`.trim()}>
      {(title || action) && (
        <div className="section-card__head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action || null}
        </div>
      )}
      {children}
    </section>
  )
}
