// Request budgets for the agent listener, so no client (or stuck loop) can flood it.

/** Token bucket per key: `burst` requests at once, refilled at `perSecond`. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private burst: number, private perSecond: number, private now: () => number = () => Date.now()) {}

  /** Spends one request for `id`; false when its budget is used up. */
  take(id: string): boolean {
    const t = this.now();
    const b = this.buckets.get(id) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.perSecond);
    b.at = t;
    this.buckets.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/** Counts requests being handled; refuses more than `max` at once. */
export class Concurrency {
  private active = 0;

  constructor(private max: number) {}

  get count() { return this.active; }

  /** Starts a request; returns a release function, or null when at the limit. */
  enter(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let done = false;
    return () => { if (!done) { done = true; this.active--; } };
  }
}

export const RATE = {
  burst: 300, // a busy agent fires a hook per tool call; bursts of a few hundred are normal
  perSecond: 50,
  concurrent: 24, // requests in progress at once (approvals counted separately)
  approvals: 5, // approval prompts waiting for the user at once
  events: 500, // events in one /pulse request
  messages: 100, // messages in one /bridge-message request
};
