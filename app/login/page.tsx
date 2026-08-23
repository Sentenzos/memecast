import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminUser } from "../admin-auth";
import { adminAccessAllowed } from "../request-security";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; return_to?: string }> }) {
  if (await getAdminUser()) redirect("/dashboard");
  const requestHeaders = await headers();
  const adminAccess = adminAccessAllowed(requestHeaders);
  const { error, return_to: returnTo } = await searchParams;
  return (
    <main className="auth-page">
      <Link className="brand" href="/"><span className="brand-mark">M</span><span>MEMECAST</span></Link>
      <section className="auth-card">
        <div className="auth-art" aria-hidden="true"><span>🗿</span><i>+</i><span>📺</span></div>
        <p className="section-kicker">КАБИНЕТ СТРИМЕРА</p>
        <h1>Запусти мемы<br />на своём стриме</h1>
        {error === "not_configured" ? <div className="dashboard-alert">Вход временно недоступен.</div> : null}
        {error === "invalid" ? <div className="dashboard-alert">Неверный логин или пароль.</div> : null}
        {adminAccess ? (
          <form className="auth-form" action="/api/auth/login" method="post">
            <input name="return_to" type="hidden" value={returnTo || "/dashboard"} />
            <label>Логин<input autoComplete="username" name="login" required /></label>
            <label>Пароль<input autoComplete="current-password" name="password" required type="password" /></label>
            <button className="primary-button auth-button" type="submit">Войти в кабинет <span>→</span></button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
