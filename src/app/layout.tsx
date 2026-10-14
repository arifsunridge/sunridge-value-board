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
        <header className="top">
          <Link className="brand" href="/">
            Sunridge Value Board
          </Link>
          {me && (
            <>
              <Nav companies={companies.map((c) => ({ id: c.id, name: c.name }))} />
              <div className="who">
                <span>{me.name}</span>
                {portalUrl && (
                  <a className="button quiet small" href={portalUrl}>
                    HBF Portal
                  </a>
                )}
                <form action="/auth/signout" method="post">
                  <button className="button quiet small">Sign out</button>
                </form>
              </div>
            </>
          )}
        </header>
        {children}
      </body>
    </html>
  );
}
