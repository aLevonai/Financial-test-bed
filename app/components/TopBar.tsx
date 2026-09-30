import Link from "next/link";
import { Logo } from "./Logo";

export function TopBar({ current }: { current: "feed" | "sources" }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <Logo />
          Tech Radar
        </Link>
        <nav className="nav">
          <Link href="/" aria-current={current === "feed" ? "page" : undefined}>
            Feed
          </Link>
          <Link href="/sources" aria-current={current === "sources" ? "page" : undefined}>
            Sources
          </Link>
          <form action="/api/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
