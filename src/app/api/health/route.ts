/** For Render's health check. Says nothing about the board. */
export function GET() {
  return Response.json({ ok: true });
}
