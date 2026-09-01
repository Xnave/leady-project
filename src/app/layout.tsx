import Link from "next/link";
import "./globals.css";

export const metadata = { title: "Leady" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav>
            <Link href="/">Leady</Link>
            <Link href="/onboard">Setup</Link>
            <Link href="/demo">Chat</Link>
            <Link href="/leads">Leads</Link>
            <Link href="/inbox">Inbox</Link>
            <Link href="/channels">Channels</Link>
            <Link href="/ops">Ops</Link>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
