import { SA, SA_TYPE, SA_SHAPE, SA_THEME_CSS, SA_THEME_ROOT_ID, SA_BAD_BG, SA_BAD_BORDER, saSans } from '../salesAnalytics/theme';

// Shared shell + controls for /login, /invite/:token and /reset-password,
// in the design-v1 look (the SA tokens resolve under SA_THEME_ROOT_ID).
export const inputStyle = { ...SA_TYPE.body, fontSize: 14, height: 44, padding: '0 12px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text, width: '100%', boxSizing: 'border-box' };
export const primaryButton = { ...SA_TYPE.body, fontSize: 14, fontWeight: 600, height: 44, width: '100%', border: 0, borderRadius: SA_SHAPE.radiusInner, background: SA.accent, color: SA.ground, cursor: 'pointer' };
export const secondaryButton = { ...primaryButton, fontWeight: 500, background: 'transparent', color: SA.text, border: `1px solid ${SA.border}` };
export const linkButton = { ...SA_TYPE.body, fontSize: 13, background: 'transparent', border: 0, padding: 0, color: SA.accent, cursor: 'pointer' };

export function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div role="alert" style={{ fontSize: 13, color: SA.bad, padding: '10px 12px', background: SA_BAD_BG, border: `1px solid ${SA_BAD_BORDER}`, borderRadius: SA_SHAPE.radiusInner }}>
      {children}
    </div>
  );
}

export function Notice({ children }) {
  if (!children) return null;
  return <div style={{ fontSize: 13, color: SA.muted, padding: '10px 12px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner }}>{children}</div>;
}

export function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: SA.faint, fontSize: 12 }}>
      <span style={{ flex: 1, height: 1, background: SA.border }} />or<span style={{ flex: 1, height: 1, background: SA.border }} />
    </div>
  );
}

export function GoogleButton({ onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...secondaryButton, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: disabled ? 0.6 : 1 }}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </button>
  );
}

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, minHeight: '100vh', background: SA.ground, color: SA.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
      <style>{SA_THEME_CSS}</style>
      <div style={{ width: '100%', maxWidth: 400, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ ...SA_TYPE.label, color: SA.muted, marginBottom: 8 }}>Prospector</div>
          <h1 style={{ ...SA_TYPE.pageTitle, fontSize: 26, margin: 0, color: SA.text }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 14, color: SA.muted, margin: '8px 0 0', lineHeight: 1.5 }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
