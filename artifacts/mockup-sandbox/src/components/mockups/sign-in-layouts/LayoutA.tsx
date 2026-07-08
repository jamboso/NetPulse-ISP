import './_group.css';
import { Wifi, Lock, Zap, Shield, Globe } from 'lucide-react';

export function LayoutA() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: "'Inter', sans-serif" }}>

      {/* Left branded panel */}
      <div style={{
        width: '45%', background: 'linear-gradient(160deg, #0a192f 0%, #0d2847 60%, #1a3a6e 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '48px 40px', position: 'relative', overflow: 'hidden',
      }}>
        {/* subtle grid lines */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.07,
          backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />

        {/* Logo */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wifi size={20} color="white" />
            </div>
            <span style={{ color: 'white', fontWeight: 700, fontSize: 18 }}>NetPulse ISP</span>
          </div>
        </div>

        {/* Center copy */}
        <div style={{ position: 'relative' }}>
          <h2 style={{ color: 'white', fontSize: 28, fontWeight: 700, lineHeight: 1.3, marginBottom: 16 }}>
            Manage your network<br />from one place
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
            Full-featured ISP management — customers, billing, tickets, and network infrastructure, all in one dashboard.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: <Zap size={14} />, text: 'Real-time network monitoring' },
              { icon: <Shield size={14} />, text: 'RADIUS & PPPoE authentication' },
              { icon: <Globe size={14} />, text: 'M-Pesa billing integration' },
            ].map(f => (
              <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#60a5fa' }}>{f.icon}</div>
                <span style={{ color: '#cbd5e1', fontSize: 13 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p style={{ color: '#475569', fontSize: 12, position: 'relative' }}>
          NetPulse ISP Manager · Self-hosted
        </p>
      </div>

      {/* Right form panel */}
      <div style={{
        flex: 1, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Welcome back</h1>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 32 }}>Sign in to your account to continue</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Email address</label>
              <input
                type="email" placeholder="admin@myisp.co.ke" readOnly
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#374151', background: 'white', outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>Password</label>
                <span style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }}>Forgot password?</span>
              </div>
              <input
                type="password" placeholder="••••••••" readOnly
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: 'white', outline: 'none' }}
              />
            </div>
            <button style={{
              width: '100%', padding: '11px', background: '#2563eb', color: 'white',
              border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}>
              Sign In
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 28 }}>
            <Lock size={13} color="#94a3b8" />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Secure, self-hosted · Your data stays on your server</span>
          </div>
        </div>
      </div>
    </div>
  );
}
