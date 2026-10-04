import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/ui/Nav";
import { board } from "@/server/context";
import { session } from "@/server/session";

export const metadata: Metadata = {
  title: "Sunridge Value Board",
  description: "What matters most, who owns it, what is blocked and which file backs it up.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const member = (await session()).member;
  const companies = member ? await board().companies() : [];
  return (
    <html lang="en-GB">
      <body>
        <header className="top">
          <Link className="brand" href="/">
            Sunridge Value Board
          </Link>
          {member && (
            <>
              <Nav companies={companies.map((c) => ({ id: c.id, name: c.name }))} />
              <div className="who">
                <span>{member.name}</span>
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
