import './_group.css';
import { Wifi, ArrowRight } from 'lucide-react';

export function LayoutC() {
  return (
    <div style={{
      minHeight: '100vh', fontFamily: "'Inter', sans-serif",
      background: '#060d1a',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, position: 'relative', overflow: 'hidden',
    }}>
      {/* Network grid overlay */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.06,
        backgroundImage: 'linear-gradient(rgba(59,130,246,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,.8) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      {/* Radial glow */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Logo — large, above the card */}
      <div style={{ textAlign: 'center', marginBottom: 32, position: 'relative', zIndex: 1 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px', boxShadow: '0 0 32px rgba(37,99,235,0.45)',
        }}>
          <Wifi size={26} color="white" />
        </div>
        <h1 style={{ color: 'white', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>NetPulse ISP</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Management Portal</p>
      </div>

      {/* Frosted glass card */}
      <div style={{
        position: 'relative', zIndex: 1, width: '100%', maxWidth: 380,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        padding: '32px 28px',
        backdropFilter: 'blur(20px)',
      }}>
        <h2 style={{ color: 'white', fontWeight: 600, fontSize: 18, marginBottom: 4 }}>Welcome back</h2>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 28 }}>Sign in to your account</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>
              Email address
            </label>
            <input
              type="email" placeholder="admin@myisp.co.ke" readOnly
              style={{
                width: '100%', padding: '10px 14px',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, fontSize: 14, color: '#f1f5f9',
                outline: 'none', caretColor: '#3b82f6',
              }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>Password</label>
              <span style={{ fontSize: 12, color: '#3b82f6', cursor: 'pointer' }}>Forgot password?</span>
            </div>
            <input
              type="password" placeholder="••••••••" readOnly
              style={{
                width: '100%', padding: '10px 14px',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, fontSize: 14, color: '#f1f5f9', outline: 'none',
              }}
            />
          </div>

          <button style={{
            width: '100%', padding: '12px', marginTop: 4,
            background: 'linear-gradient(90deg, #2563eb, #1d4ed8)',
            color: 'white', border: 'none', borderRadius: 8,
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 4px 20px rgba(37,99,235,0.4)',
          }}>
            Sign In <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <p style={{ color: '#334155', fontSize: 12, marginTop: 24, position: 'relative', zIndex: 1 }}>
        NetPulse ISP Manager · Self-hosted
      </p>
    </div>
  );
}
