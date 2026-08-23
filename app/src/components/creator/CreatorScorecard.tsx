import { useMemo } from 'react'
import { Link } from 'react-router'
import { ChainBadge } from '../ChainBadge'
import { useAllBaskets } from '../../lib/spectrum/hooks'
import { perfMeasurable, versionChain, MEASURABLE_TVL_FLOOR_USD } from '../../lib/spectrum/leaderboard'
import type { BasketSummary } from '../../lib/spectrum/basket-data'
import { formatUsdCompact } from '../../lib/spectrum/format'
import { basketHref } from '../../lib/spectrum/short-url'
import { showSymbol } from '../../lib/spectrum/safe-copy'

// ─────────────────────────────────────────────────────────────────────────────
// THE SCORECARD (owner 2026-08-22: "you can see their performance overall and
// per basket close to the top of the page and it tracks the changes they make to
// baskets and what difference that makes").
//
// The hero already carries the OVERALL number and its tracked curve. This is the
// per-basket half, and it sits directly under the hero because a creator's record
// is the reason to read the rest of the page.
//
// ⚠ WHAT "THE CHANGES THEY MAKE" MEANS HERE, and why this is honest. A basket is
// IMMUTABLE — there is no setter, no rebalance, no adding a leg. The only way a
// creator changes one is to publish a NEW VERSION that supersedes the old, which
// is a signed on-chain link (`supersededBy`). So the "difference their change
// made" is exactly comparable: each version has its own since-launch return, and
// the delta between a version and the one it replaced is the difference their
// decision made. Nothing is inferred and nothing is modelled.
//
// It reads every version, superseded ones included, from useAllBaskets — the SAME
// cached query the profile and the nav already run, so this costs no new request.
// (`profile.baskets` deliberately holds only current versions, which is why the
// predecessor's numbers have to come from here.)
//
// ⚠ AND IT REFUSES TO CLAIM WHAT IT CANNOT MEASURE. A basket under the
// measurability floor gets its AUM and nothing else: perfMeasurable is the
// house's own gate, and a since-launch percentage off a few dollars of seed is
// arithmetic, not performance. Absent, never a zero.
// ─────────────────────────────────────────────────────────────────────────────

/** navPerToken is 1.0 at launch, so this is the return since launch. */
const sinceLaunchPct = (b: BasketSummary): number | null =>
  typeof b.navPerToken === 'number' && b.navPerToken > 0 ? (b.navPerToken - 1) * 100 : null

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(n <= -10 || n >= 10 ? 0 : 1)}%`
const toneOf = (n: number) => (n > 0 ? 'text-teal' : n < 0 ? 'text-magenta' : 'text-ink-dim')

interface Row {
  basket: BasketSummary
  /** Return since this version launched, or null when unmeasurable. */
  since: number | null
  /** 1-based position in its version chain, and the chain's length. */
  v: number
  of: number
  /** This version's since-launch minus the one it replaced — the difference the
   *  change made. Null unless BOTH versions clear the floor. */
  vsPrev: number | null
}

export function CreatorScorecard({ creator, baskets }: { creator: string; baskets: BasketSummary[] }) {
  const { data: all } = useAllBaskets()

  const rows = useMemo<Row[]>(() => {
    const me = creator.toLowerCase()
    // every version this creator ever published, superseded included
    const mine = (all ?? []).filter((b) => b.deployer?.toLowerCase() === me)
    return baskets.map((b) => {
      const chain = versionChain(b.address, mine)
      const idx = chain.findIndex((c) => c.address.toLowerCase() === b.address.toLowerCase())
      const prev = idx > 0 ? chain[idx - 1] : null
      const since = perfMeasurable(b) ? sinceLaunchPct(b) : null
      const prevSince = prev && perfMeasurable(prev) ? sinceLaunchPct(prev) : null
      return {
        basket: b,
        since,
        v: idx >= 0 ? idx + 1 : 1,
        of: chain.length || 1,
        vsPrev: since != null && prevSince != null ? since - prevSince : null,
      }
    })
  }, [all, baskets, creator])

  if (rows.length === 0) return null
  // QoL round (owner 2026-08-23): the table leads with substance. Funded rows
  // first, largest held first; baskets holding NOTHING and measuring nothing
  // collapse into one quiet count line - seven full rows of "not yet
  // measurable" over empty baskets was the wall the phone shot showed.
  const funded = rows.filter((r) => (r.basket.aumUsd || 0) > 0 || r.since != null)
  const empty = rows.length - funded.length
  const shown = [...funded].sort((a, b) => (b.basket.aumUsd || 0) - (a.basket.aumUsd || 0))
  if (shown.length === 0) return null
  const anyVersioned = shown.some((r) => r.of > 1)
  // A column of dashes is a column with nothing to say: when NO shown row
  // measures yet, Since launch leaves entirely and the footnote explains why.
  const showSince = shown.some((r) => r.since != null)
  const statCols = (showSince ? 1 : 0) + (anyVersioned ? 1 : 0) + 1
  // static strings so the JIT sees every variant
  const smCols =
    statCols === 1
      ? 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'
      : statCols === 2
        ? 'sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]'
        : 'sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]'

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/10 pb-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-ink">Their record</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          {anyVersioned ? 'per basket, and what each new version changed' : showSince ? 'per basket, since each launched' : 'per basket'}
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
        {shown.map((r, i) => (
          <Link
            key={`${r.basket.chainId}:${r.basket.address}`}
            to={basketHref(r.basket)}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition-colors hover:bg-white/[0.03] ${smCols} ${
              i > 0 ? 'border-t border-white/8' : ''
            }`}
          >
            {/* who it is */}
            <div className="flex min-w-0 items-center gap-2.5">
              <ChainBadge chainId={r.basket.chainId} size="sm" />
              <span className="truncate font-display text-sm font-bold uppercase tracking-wide text-ink">
                ${showSymbol(r.basket.symbol)}
              </span>
              {r.of > 1 && (
                <span
                  title={`Version ${r.v} of ${r.of} — this creator replaced an earlier one with it`}
                  className="shrink-0 rounded-full border border-violet-bright/40 bg-violet-bright/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-violet-bright"
                >
                  v{r.v}
                </span>
              )}
            </div>

            {/* since launch - a dash where it cannot be measured (the footnote
                below says why ONCE, instead of every row repeating the words);
                phones get HELD, the number that always exists, and pick this
                column back up from sm */}
            {showSince && (
            <div className="hidden sm:block sm:text-left">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">Since launch</div>
              <div
                title={r.since == null ? 'Not yet measurable - see the note below' : undefined}
                className={`mt-1 font-num text-sm tabular-nums ${r.since == null ? 'text-ink-faint' : toneOf(r.since)}`}
              >
                {r.since == null ? '—' : signed(r.since)}
              </div>
            </div>
            )}

            {/* what the change did — the column only exists when one of them is
                actually a new version, so it never reads as missing data */}
            {anyVersioned && (
              <div className="hidden text-left sm:block">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">Vs the one it replaced</div>
                <div className={`mt-1 font-num text-sm tabular-nums ${r.vsPrev == null ? 'text-ink-faint' : toneOf(r.vsPrev)}`}>
                  {r.vsPrev == null ? (r.of > 1 ? 'not comparable yet' : '—') : signed(r.vsPrev)}
                </div>
              </div>
            )}

            {/* held value - the one number every basket has, so it is the
                column a phone keeps */}
            <div className="text-right sm:text-left">
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">Held</div>
              <div className="mt-1 font-num text-sm tabular-nums text-ink-dim">{formatUsdCompact(r.basket.aumUsd || 0)}</div>
            </div>
          </Link>
        ))}
      </div>

      {empty > 0 && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          + {empty} basket{empty === 1 ? '' : 's'} with nothing held yet
        </p>
      )}
      {shown.some((r) => r.since == null) && (
        <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wide text-ink-faint">
          A basket holding under {formatUsdCompact(MEASURABLE_TVL_FLOOR_USD)} shows no return: a percentage off a few
          dollars of seed is arithmetic, not performance.
        </p>
      )}
    </section>
  )
}
