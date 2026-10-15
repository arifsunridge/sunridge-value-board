import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/ui/Nav";
import { board } from "@/server/context";
import { config } from "@/server/config";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = {
  title: "Sunridge Value Board",
  description: "What matters most, who owns it, what is blocked and which file backs it up.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentPerson();
  const companies = me ? await board().companies(me) : [];
  const portalUrl = config().AUTH_MODE === "portal" ? config().PORTAL_URL : null;
  return (
    <html lang="en-GB">
      <body>
        <div className="wrap">
          <header className="mast">
            <div className="label">
              <span>Sunridge Partners</span>
              <span aria-hidden="true">·</span>
              <span>Value Creation and Investment</span>
              <span className="tagbox">Internal</span>
              {me && (
                <span className="who">
                  <span>{me.name}</span>
                  {portalUrl && <a href={portalUrl}>HBF Portal</a>}
                  <form action="/auth/signout" method="post">
                    <button className="linkish">Sign out</button>
                  </form>
                </span>
              )}
            </div>
            <div className="head">
              <Link href="/" className="logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/sunridge-logo.png" alt="Sunridge Partners" width={130} height={34} />
              </Link>
              <span className="vr" aria-hidden="true" />
              <div>
                <h1>
                  Value<span className="bar-g">|</span>
                  <em>Board</em>
                </h1>
                <div className="sub">What matters most, who owns it, what is blocked, and the files behind it</div>
              </div>
            </div>
            {me && <Nav companies={companies.map((c) => ({ id: c.id, name: c.name }))} canImport={me.kind === "member"} />}
          </header>
          {children}
          <footer className="pagefoot">
            <span>Strictly confidential</span>
            <span>Sunridge Partners</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
