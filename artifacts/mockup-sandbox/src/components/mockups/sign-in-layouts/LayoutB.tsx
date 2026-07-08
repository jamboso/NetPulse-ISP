import './_group.css';
import { Wifi } from 'lucide-react';

export function LayoutB() {
  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <header style={{
        height: 56, borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wifi size={15} color="white" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>NetPulse ISP</span>
        </div>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Self-hosted</span>
      </header>

      {/* Body — centered, open, minimal */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Heading block */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Sign in</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Use your admin credentials to access the portal</p>
          </div>

          {/* Fieldset — no card background, fields float on white */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Email address
              </label>
              <input
                type="email" placeholder="admin@myisp.co.ke" readOnly
                style={{
                  width: '100%', padding: '12px 0', border: 'none', borderBottom: '2px solid #e5e7eb',
                  fontSize: 15, color: '#0f172a', background: 'transparent', outline: 'none',
                }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Password
                </label>
                <span style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }}>Forgot?</span>
              </div>
              <input
                type="password" placeholder="••••••••" readOnly
                style={{
                  width: '100%', padding: '12px 0', border: 'none', borderBottom: '2px solid #e5e7eb',
                  fontSize: 15, background: 'transparent', outline: 'none',
                }}
              />
            </div>

            <div style={{ paddingTop: 8 }}>
              <button style={{
                width: '100%', padding: '14px', background: '#0f172a', color: 'white',
                border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 15, cursor: 'pointer', letterSpacing: '0.01em',
              }}>
                Continue →
              </button>
            </div>
          </div>

          {/* Divider + footer */}
          <div style={{ textAlign: 'center', marginTop: 48 }}>
            <p style={{ fontSize: 12, color: '#cbd5e1' }}>NetPulse ISP Manager · Self-hosted</p>
          </div>
        </div>
      </div>
    </div>
  );
}
