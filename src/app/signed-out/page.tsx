export default function SignedOut() {
  return (
    <main className="narrow">
      <h1>You’ve signed out</h1>
      <p>
        <a className="button" href="/auth/signin">
          Sign in again
        </a>
      </p>
    </main>
  );
}
