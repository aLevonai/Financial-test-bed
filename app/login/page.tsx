import { Logo } from "../components/Logo";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = sp.error;

  return (
    <main className="login">
      <div style={{ width: 36, height: 36 }}>
        <Logo />
      </div>
      <h1>Tech Radar</h1>
      <p>Enter the password to continue.</p>
      <form action="/api/login" method="post">
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          required
          aria-label="Password"
        />
        {error === "1" && <p className="error">Wrong password.</p>}
        {error === "config" && <p className="error">APP_PASSWORD isn’t set (or is shorter than 8 characters) on the server.</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
