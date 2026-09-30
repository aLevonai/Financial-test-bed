"use client";

import { useState, useTransition } from "react";

export function VoteButtons({ itemId, initial }: { itemId: number; initial: -1 | 1 | null }) {
  const [vote, setVote] = useState<-1 | 1 | null>(initial);
  const [pending, startTransition] = useTransition();

  function cast(next: -1 | 1) {
    const value = vote === next ? null : next;
    const previous = vote;
    setVote(value);
    startTransition(async () => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, vote: value ?? 0 }),
      }).catch(() => null);
      if (!res?.ok) setVote(previous);
    });
  }

  return (
    <div className="votes">
      <button
        type="button"
        className="vote"
        aria-pressed={vote === 1}
        aria-label="More like this"
        title="More like this"
        disabled={pending}
        onClick={() => cast(1)}
      >
        ▲
      </button>
      <button
        type="button"
        className="vote"
        aria-pressed={vote === -1}
        aria-label="Less like this"
        title="Less like this"
        disabled={pending}
        onClick={() => cast(-1)}
      >
        ▼
      </button>
    </div>
  );
}
