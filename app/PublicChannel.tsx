import { MemeSender } from "./MemeSender";

type Props = {
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  cooldownSeconds: number;
};

export function PublicChannel({ slug, displayName, avatarUrl, cooldownSeconds }: Props) {
  const initials = displayName.slice(0, 2).toUpperCase();
  return (
    <main className="site-shell">
      <div className="public-top">
        <header className="topbar">
          <a className="brand" href="#top" aria-label="MemeCast — на главную">
            <span className="brand-mark">M</span><span>MEMECAST</span>
          </a>
          <a className="login-link" href="/login">Кабинет стримера <span aria-hidden="true">↗</span></a>
        </header>

        <section className="channel-hero" id="top">
          <div className="avatar-wrap">
            {avatarUrl ? <img className="avatar avatar-img" src={avatarUrl} alt={`Аватар ${displayName}`} /> : <div className="avatar" aria-hidden="true">{initials}</div>}
            <span className="live-dot">LIVE</span>
          </div>
          <div className="channel-copy">
            <div className="eyebrow"><span /> МЕМЫ ДЛЯ СТРИМЕРА</div>
            <h1>{displayName}</h1>
            <p>Выбери мем — и он появится прямо на стриме. Бесплатно, без донатов.</p>
          </div>
          <div className="online-pill"><span className="pulse" />Алерты включены</div>
        </section>
      </div>

      <div className="public-content">
        <MemeSender slug={slug} cooldownSeconds={cooldownSeconds} />
      </div>
      <footer className="footer">
        <p>created by deadlock_otp</p>
      </footer>
    </main>
  );
}
