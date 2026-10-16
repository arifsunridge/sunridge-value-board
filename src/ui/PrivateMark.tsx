/** The lock on a Private Task, wherever it is drawn: a card on the board, or a line in My Tasks (ADR 0010). */
export function PrivateMark() {
  return (
    <span className="private-mark" title="Private: only its Owners and Contributors see this Task">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      Private
    </span>
  );
}
