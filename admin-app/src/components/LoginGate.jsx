import { useState } from 'react'
import { Lock } from 'lucide-react'
import { checkPassword } from '../lib/api'

export default function LoginGate({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (checkPassword(password)) {
      setError('')
      onSuccess()
      return
    }
    setError('كلمة المرور غير صحيحة')
  }

  return (
    <div className="gate">
      <form className="gate-card glass-card" onSubmit={submit}>
        <div className="gate-icon"><Lock size={22} /></div>
        <h2>دخول لوحة الإدارة</h2>
        <p className="muted">أدخل كلمة مرور المسؤول للمتابعة</p>
        <div className="field">
          <label htmlFor="adminPass">كلمة المرور</label>
          <input
            id="adminPass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
        </div>
        <button type="submit" className="btn btn--primary" style={{ width: '100%', marginTop: 8 }}>
          دخول
        </button>
        {error ? <p className="gate-error" role="alert">{error}</p> : null}
      </form>
      <style>{`
        .gate {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(ellipse 70% 50% at 50% -10%, rgba(59,130,246,0.2), transparent 55%),
            var(--bg);
        }
        .gate-card {
          width: min(400px, 100%);
          padding: 28px 24px;
          text-align: center;
        }
        .gate-icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 14px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: rgba(59,130,246,0.15);
          color: #93c5fd;
        }
        .gate-card h2 {
          margin: 0 0 8px;
          font-size: 22px;
          font-weight: 700;
        }
        .gate-card p { margin: 0 0 18px; font-size: 13px; }
        .gate-error {
          margin: 12px 0 0;
          color: #fca5a5;
          font-size: 13px;
        }
      `}</style>
    </div>
  )
}
