/**
 * Daily budgets.
 *
 * Six outbound, nine inbound. Browsing is free; *deciding* is what is
 * scarce, which is what makes someone read a profile properly instead of
 * skimming it under pressure. Nothing here can be bought — the cap simply
 * resets, because there is no subscription to sell.
 *
 * The inbound cap is the unusual half. Commercial apps cap outbound to
 * monetise and leave inbound uncapped, because concentrated attention is
 * the engagement engine — in a market that is roughly two-thirds men, that
 * means a few people get hundreds of unread likes and everyone else gets
 * nothing. Capping inbound and spreading the overflow across days is the
 * pro-social version of the same mechanic.
 */

/** India Standard Time, fixed. The day resets at midnight where the users are. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight IST, expressed as the UTC instant it happened. */
export function startOfDay(now = new Date()): Date {
  const shifted = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

export interface BudgetState {
  limit: number;
  used: number;
  remaining: number;
}

export function budget(limit: number, used: number): BudgetState {
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining };
}
