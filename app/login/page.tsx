import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminUser } from "../admin-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; return_to?: string }> }) {
  if (await getAdminUser()) redirect("/dashboard");
  const host = (await headers()).get("host") ?? "";
  const isLocal = /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
  const { error, return_to: returnTo } = await searchParams;
  return (
    <main className="auth-page">
      <Link className="brand" href="/"><span className="brand-mark">M</span><span>MEMECAST</span></Link>
      <section className="auth-card">
        <div className="auth-art" aria-hidden="true"><span>🗿</span><i>+</i><span>📺</span></div>
        <p className="section-kicker">КАБИНЕТ СТРИМЕРА</p>
        <h1>Запусти мемы<br />на своём стриме</h1>
        <p>Введи административный логин и пароль, указанные в настройках сервера.</p>
        {error === "not_configured" ? <div className="dashboard-alert">Добавь ADMIN_LOGIN и ADMIN_PASSWORD в .env сервера.</div> : null}
        {error === "invalid" ? <div className="dashboard-alert">Неверный логин или пароль.</div> : null}
        <form className="auth-form" action="/api/auth/login" method="post">
          <input name="return_to" type="hidden" value={returnTo || "/dashboard"} />
          <label>Логин<input autoComplete="username" name="login" required /></label>
          <label>Пароль<input autoComplete="current-password" name="password" required type="password" /></label>
          <button className="primary-button auth-button" type="submit">Войти в кабинет <span>→</span></button>
        </form>
        {isLocal ? <a className="secondary-button auth-demo-button" href="/dashboard/demo">Открыть демо без входа</a> : null}
        <small>Данные входа хранятся только в .env на сервере.</small>
      </section>
    </main>
  );
}
