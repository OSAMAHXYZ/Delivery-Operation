import {
  Bell,
  Download,
  LogOut,
  Settings,
  UserRound,
} from 'lucide-react'

export default function Header({ onExport, onLogout, onOpenSettings }) {
  return (
    <header className="topbar glass-card">
      <div>
        <p className="topbar__eyebrow">Toyota Delivery Hub</p>
        <h1>لوحة متابعة الترحيل</h1>
      </div>
      <div className="topbar__actions">
        <button type="button" className="btn icon-btn" aria-label="الإشعارات" title="الإشعارات">
          <Bell size={18} />
        </button>
        <button type="button" className="btn btn--primary" onClick={onExport}>
          <Download size={16} />
          تصدير
        </button>
        <button type="button" className="btn icon-btn" aria-label="الإعدادات" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
        <button type="button" className="btn avatar" aria-label="المستخدم" onClick={onLogout} title="خروج">
          <UserRound size={18} />
          <LogOut size={14} />
        </button>
      </div>
      <style>{`
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 22px;
          position: sticky;
          top: 12px;
          z-index: 40;
        }
        .topbar__eyebrow {
          margin: 0 0 4px;
          font-size: 12px;
          color: #93c5fd;
          font-weight: 600;
          letter-spacing: 0.04em;
        }
        .topbar h1 {
          margin: 0;
          font-size: clamp(22px, 2.4vw, 28px);
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .topbar__actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .avatar {
          gap: 6px;
          padding-inline: 12px;
          height: 40px;
        }
      `}</style>
    </header>
  )
}
