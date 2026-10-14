import Link from "next/link";

export default function SignedOut() {
  return (
    <main className="narrow">
      <h1>You’ve signed out</h1>
      <p>
        <Link className="button" href="/">
          Sign in again
        </Link>
      </p>
    </main>
  );
}
