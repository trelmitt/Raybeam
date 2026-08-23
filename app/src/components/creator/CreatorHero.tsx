import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { parseAbi, type Address } from 'viem'
import { SPECTRAL } from '../home/Spine'
import { BasketAvatar } from '../BasketAvatar'
import { AssetLogo } from '../AssetLogo'
import { Carousel } from '../Carousel'
import { ChainBadge } from '../ChainBadge'
import { CopyAddress } from '../CopyAddress'
import { FollowButton } from '../FollowButton'
import { CrownWinnings } from '../CrownWinnings'
import { useActiveChainId } from '../../lib/chain/active-chain'
import { chainCfg } from '../../lib/chain/chains'
import { clientFor } from '../../lib/chain/rpc'
import { useFollowers as useFollowersOnchain } from '../../lib/spectrum/notes-social'
import { useCreatorMeta, type CreatorProfile } from '../../lib/spectrum/hooks'
import { resolveCreator } from '../../lib/spectrum/creator'
import { basketSignatureColor } from '../../lib/spectrum/signature'
import { formatUsdCompact, shortAddr } from '../../lib/spectrum/format'
import { useCopy } from '../../lib/use-copy'
import type { HandleOwner } from '../../lib/spectrum/creator-handles'
import { xUrlForHandle, type VerifiedCreatorIdentity } from '../../lib/spectrum/creator-identity'
import { xStandingFor } from '../../lib/spectrum/creator-proofs'
import { PortfolioChart } from '../PortfolioChart'
import type { PortfolioHistoryAsset } from '../../lib/spectrum/portfolio-history'

// ─────────────────────────────────────────────────────────────────────────────
// THE CREATOR HEAD (owner 2026-08-06, the creator-page rework: "this page needs
// to be way more logical and beautiful").
//
// WHO THEY ARE AND WHAT THEY BELIEVE, IN ONE BLOCK. The old page split the
// creator in half: the avatar, the handle and four counters at the top, and the
// convictions they had actually signed ("bullish on") dead last, below the
// baskets and the bundles. So it opened with inventory and buried the argument.
// The identity and the argument are now one composed plate: who, on the left;
// what they are bullish on, on the right; the facts that carry weight along the
// foot. A reader meets the person and their thesis in one screen.
//
// THE BANNER, TWICE RULED ON. It once held a 64svh floor and ate roughly 700px
// before a single fact, so 2026-08-06 demoted it to a 60%-opacity backdrop.
// 2026-08-22 asks for "a full hero banner for the image they upload", which
// reverses that — and keeps the reason it was made. An UPLOADED banner now gets
// its own full-bleed band at full strength, but a bounded one (192px, 240 from
// sm), with the identity plate climbing back up into it. Their art reads as the
// top of their page and the facts still start inside one screen. With no upload
// the old subtle backdrop stands: house league art does not earn a 240px stage.
//
// It also aligns now: the stage's column is the app shell's 1000px, so the plate
// sits directly over the baskets below instead of floating off to one side.
// ─────────────────────────────────────────────────────────────────────────────

/** One weighty fact. `value` null = the fact is unmeasurable, so the cell is
 *  ABSENT — never a zero standing in for "we could not read it". */
interface CreatorFact {
  label: string
  value: string | null
  /** The precision the label cannot carry. Hidden on a phone, where three cells
   *  share 358px and the label alone has to do the work. */
  sub?: string
}

function FactCell({ fact }: { fact: CreatorFact }) {
  return (
    // flex-col justify-center: beside the tracked chart the cells stretch to
    // share its height (auto-rows-fr below), so a lone fact reads as a
    // full-height plate instead of a chip floating over dead air.
    <div className="relative flex flex-col justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-4">
      {/* the house bezel edge: a spectral hairline along the top */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: SPECTRAL, opacity: 0.55 }} />
      <div className="font-mono text-[10px] uppercase leading-tight tracking-[0.16em] text-ink-faint">{fact.label}</div>
      <div className="mt-3 font-num text-xl font-light leading-none tabular-nums text-ink sm:text-3xl">{fact.value}</div>
      {fact.sub && <div className="mt-2 hidden font-mono text-[10px] tracking-wide text-ink-faint sm:block">{fact.sub}</div>}
    </div>
  )
}

// FactStrip and its COLS table are GONE with the plate (owner 2026-08-22): the
// facts are no longer a strip inside a card, they are cells the hero's own row
// places by name. FactCell survives because a single fact still needs a surface.

// "Bullish on" — the tokens the creator signed into their profile. Symbols are
// resolved live from the chain (display-only); every row is just a fact card,
// no links out (the pick is the creator's word, not an endorsement rail).
const pickSymbolAbi = parseAbi(['function symbol() view returns (string)'])

function Convictions({
  identityMeta,
  isMe,
  onEdit,
}: {
  identityMeta: VerifiedCreatorIdentity | null
  isMe: boolean
  onEdit?: () => void
}) {
  const [symbols, setSymbols] = useState<Record<string, string>>({})
  const anyNote = (identityMeta?.picks ?? []).some((p) => (p.note ?? '').trim().length > 0)
  /** The pick being read — hover or keyboard focus. */
  const [shown, setShown] = useState<{ address: string; note?: string | null } | null>(null)
  const chainId = identityMeta?.chainId
  const picks = useMemo(() => identityMeta?.picks ?? [], [identityMeta])

  useEffect(() => {
    if (chainId === undefined || picks.length === 0) return
    let stale = false
    void Promise.all(
      picks.map((p) =>
        clientFor(chainId)
          .readContract({ address: p.address as Address, abi: pickSymbolAbi, functionName: 'symbol' })
          .then((s) => [p.address, typeof s === 'string' && s ? s.slice(0, 16) : shortAddr(p.address)] as const)
          .catch(() => [p.address, shortAddr(p.address)] as const),
      ),
    ).then((pairs) => {
      if (!stale) setSymbols(Object.fromEntries(pairs))
    })
    return () => {
      stale = true
    }
  }, [picks, chainId])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-ink">Bullish on</h2>
        {picks.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">signed by them</span>
        )}
      </div>

      {picks.length === 0 ? (
        // Honest absence, and it says what would fill it. A blank column would
        // read as a page still loading; this reads as a creator who has not
        // said it yet.
        <div className="mt-4 rounded-2xl border border-dashed border-white/12 px-4 py-4">
          <p className="text-sm leading-relaxed text-ink-dim">
            {isMe
              ? 'You have not listed what you are bullish on. Sign your profile with the tokens you back and a line on each, and they show up here.'
              : 'Nothing listed yet. When this creator signs their profile they can name the tokens they back and say why in their own words.'}
          </p>
          {isMe && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="press mt-4 inline-flex h-9 items-center rounded-full border border-cyan/45 bg-cyan/10 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-cyan hover:border-cyan"
            >
              Add yours
            </button>
          )}
        </div>
      ) : (
        // CIRCLES (owner 2026-08-22: "you see the assets they're bullish on as
        // beautiful circles"). It was a rail of full-width cards, which spent a
        // whole column on twelve rows of chrome; a conviction is a face and a
        // symbol, so it gets one. Twelve fit in a wrapped row without a
        // carousel, which is why the rail could go.
        //
        // THE NOTES ARE THE POINT AND THEY DO NOT GET HIDDEN. Each pick's line
        // is the creator's own word on it, so hovering or focusing a circle
        // prints it in the reserved line below the row — reserved, so nothing
        // reflows as you move across them, and keyboard-reachable because a
        // hover-only reveal is not a control.
        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          {/* TWO PER ROW, as many rows as needed (owner 2026-08-22). A wrapped
              flex row left a ragged last line and, beside a ~320px chart, four
              faces in one line looked squeezed. Past FOUR the rows would grow
              this cell and push the whole band down, so at that point the same
              pairs become a slideshow instead — the shared Carousel, one column
              of two per slide, so it is still two per row either way. */}
          {(() => {
            const circle = (p: { address: string; note?: string | null }) => {
              const sym = symbols[p.address] ?? shortAddr(p.address)
              const active = shown?.address === p.address
              return (
                <button
                  key={p.address}
                  type="button"
                  onMouseEnter={() => setShown(p)}
                  onFocus={() => setShown(p)}
                  onMouseLeave={() => setShown(null)}
                  onBlur={() => setShown(null)}
                  aria-label={p.note ? `${sym}: ${p.note}` : sym}
                  className="press group flex min-w-0 flex-col items-center gap-2 focus:outline-none"
                >
                  <span className="relative grid h-14 w-14 place-items-center">
                    {/* the house halo, lit on the one being read */}
                    <span
                      aria-hidden
                      className={`absolute -inset-0.5 rounded-full blur-[6px] transition-opacity ${active ? 'opacity-70' : 'opacity-0 group-hover:opacity-50'}`}
                      style={{ background: SPECTRAL }}
                    />
                    <span
                      className={`relative grid h-14 w-14 place-items-center overflow-hidden rounded-full ring-1 transition-all ${
                        active ? 'ring-cyan/70' : 'ring-white/15 group-hover:ring-white/35'
                      }`}
                    >
                      <AssetLogo address={p.address} symbol={sym} chainId={chainId ?? 8453} size={56} />
                    </span>
                  </span>
                  <span className="max-w-full truncate font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim group-hover:text-ink">
                    {sym}
                  </span>
                </button>
              )
            }
            // Four or fewer: two per row, wrapped, done.
            // one or two picks centre themselves - a lone conviction pinned
            // to the top-left of a wide cell read as a layout accident
            if (picks.length <= 4)
              return (
                <div className={`grid gap-x-4 gap-y-5 ${picks.length === 1 ? 'grid-cols-1 justify-items-center' : 'grid-cols-2 justify-items-center'}`}>
                  {picks.map(circle)}
                </div>
              )
            // More than four would grow this cell and push the whole band down,
            // so the same pairs ride the shared Carousel instead — one column of
            // two per slide, which is still two per row, moved sideways.
            const pairs: (typeof picks)[] = []
            for (let i = 0; i < picks.length; i += 2) pairs.push(picks.slice(i, i + 2))
            return (
              <Carousel label="Tokens this creator is bullish on" gridFrom="never" arrows dots={false} peek="46%">
                {pairs.map((pair) => (
                  <div key={pair[0].address} className="grid grid-rows-2 gap-5">
                    {pair.map(circle)}
                  </div>
                ))}
              </Carousel>
            )
          })()}
          {/* Reserved, so the row never jumps (bottom-centre per the owner
              2026-08-23). QoL: the line only INVITES reading when there is
              something to read — a card whose picks carry no notes used to say
              "hover to read why" and then answer every hover with "no note",
              an invitation to disappointment. And the verb is pointer-aware:
              "Hover" is a lie on a touch screen. */}
          <p className="mx-auto mt-auto min-h-10 max-w-[52ch] pt-4 text-center text-[13px] leading-relaxed text-ink-dim">
            {!anyNote ? (
              ''
            ) : shown?.note ? (
              shown.note
            ) : shown ? (
              `${symbols[shown.address] ?? shortAddr(shown.address)}: no note on this one.`
            ) : (
              <>
                <span className="[@media(hover:none)]:hidden">Hover</span>
                <span className="hidden [@media(hover:none)]:inline">Tap</span>
                {' a token to read why they back it.'}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

/** Wallets that signed a follow on the chain being viewed. Public, portable
 *  social proof — distinct from the browser-local bookmark the heart keeps. */
function useFollowerFact(creator: string): CreatorFact {
  const chainId = useActiveChainId()
  const { data } = useFollowersOnchain(chainId, creator)
  const n = data?.list.length ?? 0
  return {
    label: 'Followers',
    // "N+" when the log scan was range-capped or served stale: a partial count
    // must never pose as the total. Nobody following yet = absent, not zero.
    value: n > 0 ? `${n.toLocaleString()}${data?.partial ? '+' : ''}` : null,
    sub: `on ${chainCfg(chainId).name}`,
  }
}

export function CreatorHero({
  profile,
  identityMeta,
  isMe,
  onEdit,
  ownerBar,
  handle = null,
}: {
  profile: CreatorProfile
  identityMeta: VerifiedCreatorIdentity | null
  isMe: boolean
  /** Opens the inline profile editor — offered from the empty convictions state. */
  onEdit?: () => void
  /** The one owner-only control up here: a door to the studio, which holds the
   *  rest. Everything a visitor cannot use stays grouped down there. */
  ownerBar?: ReactNode
  /** The page's claimed URL name, when one exists — worn as a copyable chip in
   *  the control strip (it IS the shareable identity; ≤30 chars by claim law). */
  handle?: HandleOwner | null
}) {
  const { copied: nameCopied, copy: copyName } = useCopy()
  const top = profile.baskets[0]
  // Identity precedence: the creator's SELF-signed profile (creator-identity.ts)
  // → the largest basket's deployer-signed blob → address attribution.
  const { data: meta } = useCreatorMeta(top?.address, top?.chainId)
  const identity = identityMeta
    ? resolveCreator({ handle: identityMeta.handle, name: identityMeta.name, deployer: profile.address })
    : meta
      ? resolveCreator({ handle: meta.handle, name: meta.name, deployer: profile.address })
      : profile.identity
  // Tie the page to the creator's largest basket via its signature colour.
  const accent = top ? basketSignatureColor(top.address, top.top[0]) : 'var(--color-violet)'
  const avatarSymbol = identity.kind === 'address' ? 'x' : identity.label.replace(/^@/, '')
  const avatarUrl = identityMeta?.avatarUrl ?? meta?.avatarUrl ?? undefined
  const bio = identityMeta?.bio ?? null

  // Holders across their baskets. Only the operator's indexer reports this, so
  // a chain-only install reports none — in which case the fact is ABSENT. When
  // some baskets report and others do not, the sum is marked partial rather
  // than passed off as the whole (the same rule the follower count follows).
  const reporting = profile.baskets.filter((b) => b.holdersCount != null)
  const holders = reporting.reduce((s, b) => s + (b.holdersCount ?? 0), 0)
  const followerFact = useFollowerFact(profile.address)

  const facts: CreatorFact[] = [
    {
      label: 'Total value',
      value: profile.totalAumUsd > 0 ? formatUsdCompact(profile.totalAumUsd) : null,
      sub: 'held in their baskets',
    },
    {
      label: 'Holders',
      value: holders > 0 ? `${holders.toLocaleString()}${reporting.length < profile.baskets.length ? '+' : ''}` : null,
      sub: 'across their baskets',
    },
    followerFact,
  ]

  /** One fact as its own cell, or null when it is unmeasurable — the row places
   *  cells by NAME now rather than taking the array in order, because the order
   *  the owner asked for (chart, holders, value, bullish) is not the order the
   *  facts are built in, and a positional read would silently swap two numbers. */
  const factByLabel = (label: string) => {
    const f = facts.find((x) => x.label === label)
    return f && f.value !== null ? <FactCell fact={f} /> : null
  }
  /** Followers moved OUT of the row (his row names four things, and this is not
   *  one of them) — but a public count is worth keeping, so it rides under the
   *  identity beside the follow button it belongs to. Absent when unmeasurable. */
  const followerLine = followerFact.value !== null ? `${followerFact.value} followers` : null

  // THE TRACKED VALUE (owner 2026-08-06: charts beside the facts that
  // "genuinely track that data"): the combined value's real history,
  // reconstructed the way every portfolio surface does it — each basket's
  // current composition (weight × today's AUM per constituent) priced back
  // through time by PortfolioChart. Genuine, with the chart's own coverage
  // honesty left ON. Holders get NO curve: no holder history exists anywhere
  // client-side, and a drawn one would be an invention — that chart arrives
  // with the operator DB's snapshot indexer.
  const historyAssets = useMemo<(PortfolioHistoryAsset & { symbol: string })[]>(
    () =>
      profile.baskets.flatMap((b) =>
        (b.top ?? [])
          .map((t) => ({
            chainId: b.chainId,
            address: t.address,
            valueUsd: (b.aumUsd || 0) * ((t.weightPct || 0) / 100),
            symbol: t.symbol,
          }))
          .filter((a) => a.valueUsd > 0),
      ),
    [profile.baskets],
  )
  const valueChart =
    historyAssets.length > 0 && profile.totalAumUsd > 0 ? (
      <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: SPECTRAL, opacity: 0.55 }} />
        {/* the "Their baskets · tracked" label is GONE (owner 2026-08-22):
            the chart's own header already names the period and the change, and
            a label above a labelled chart is one line of nothing. */}
        {/* MORE HEIGHT (owner 2026-08-22: "chart area needs to use more width
            and height"). Measured, the 247px card spent 65px on the header and
            22px on the coverage sentence, leaving the plot 160px — 65% of a
            card whose whole job is the curve.
            `hideCoverage` reclaims the 22px WITHOUT growing the row, and it is
            what every other mount already passes: the owner asked for that
            sentence gone on 2026-08-06 ("remove that text") and its caveat
            moved into the ⓘ beside the figures, which this mount renders. The
            creator page was the one place still printing it.
            h-52 buys the rest. The row grows ~26px, which is affordable here
            because this cell is the tallest and the other two are stretched to
            it — the numbers column stays near the 2026-08-22 pairing height,
            well under the "too much height per card" it was cut from. */}
        <PortfolioChart assets={historyAssets} totalUsd={profile.totalAumUsd} heightClass="h-52" hideCoverage />
      </div>
    ) : undefined

  const banner = identityMeta?.bannerUrl ?? null
  // Their X page, built from the handle they SIGNED — never from a URL they
  // typed (xUrlForHandle's header has the phishing shapes that rule out).
  const xUrl = xUrlForHandle(identityMeta?.handle ?? null)
  // Whether this build could CHECK that the handle is theirs (creator-proofs.ts).
  // Keyed on the chain the profile RESOLVED on, not the chain being browsed:
  // the proof was read from that chain's registry, so any other key would
  // silently never match and quietly downgrade a real verification.
  const xStanding = xStandingFor(identityMeta?.chainId ?? 0, profile.address, identityMeta?.handle ?? null)

  return (
    <section className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 overflow-hidden">
      {/* ── THE UPLOADED BANNER IS A REAL HERO NOW (owner 2026-08-22: "full hero
          banner for the image they upload") ──────────────────────────────────
          This reverses the 2026-08-06 call directly above, and keeps the reason
          it was made. That call demoted the banner to a 60%-opacity backdrop
          because a full hero held a 64svh floor and ate ~700px before a single
          fact — a thing you scroll past. So the image gets its own full-bleed
          band at full strength, but a BOUNDED one (192px, 240 from sm), and the
          identity plate climbs back up into it. The creator's art reads as the
          top of their page; the facts still start inside one screen.
          Only for an image they actually uploaded: house art does not earn a
          240px stage, so with no banner the old subtle backdrop stands. */}
      {banner ? (
        // IN FLOW, not absolute: the band owns real height, and the identity
        // plate below climbs back into it. An absolute image here would have sat
        // behind the plate again, which is the treatment this replaces.
        // TALLER, DOWN TO THE LOGO'S OWN FOOT (owner 2026-08-23: "the banner can
        // take up a bit more height to the bottom of their logo as it tapers"):
        // the band now ends where the avatar ends, so the photo sits wholly ON
        // their art and the foot fade tapers behind its lower half instead of
        // stopping at its shoulders.
        <div className="relative h-64 w-full sm:h-80">
          <img src={banner} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          {/* sides fade for the site's light bands, foot into the page so the
              plate composites instead of butting against a hard edge */}
          <span aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(90deg, var(--color-void) 0%, transparent 12%, transparent 88%, var(--color-void) 100%)' }} />
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-52" style={{ background: 'linear-gradient(180deg, transparent, var(--color-void))' }} />
        </div>
      ) : null}
      {/* THE HOUSE-ART BACKDROP IS GONE (owner 2026-08-23: "the old creator bg
          hero should be removed now that we allow for creator banners"). With
          no uploaded banner the page simply starts on its own ground, both
          planes - house league art on a page about a PERSON read as decoration
          standing in for an identity they had not supplied, and the upload is
          the honest way to earn a stage. */}

      {/* ── NOT A CARD IN THE MIDDLE OF A PAGE (owner 2026-08-22: "I want the
          creator pages not to feel like it's boxed into a center card") ──────
          The identity used to sit inside a Bezel plate with a two-column grid,
          which is exactly what read as boxed: a bordered panel, its own
          backdrop, and a hard edge around the person. The plate is gone. The
          page is now a centred vertical flow that runs to a wider column than
          the app shell's 1000px, so the content breathes instead of being held
          in a frame.

          The order is his: photo overlapping the banner, name centred, thesis
          under it, then chart · holders · total value · bullish in ONE row, then
          the baskets (Creator.tsx widens those further), then the swap card. */}
      {/* THE BACK LINK RIDES THE BAND when there is one. In flow it sat BETWEEN
          the banner and the photo, which is what stopped the photo reaching the
          band at all — the avatar measured 44px below the edge it was supposed
          to overlap. Absolute over the band with a banner, in flow without one
          (no band means nothing to float over). */}
      {banner && (
        <div className="absolute inset-x-0 top-6 z-20 mx-auto w-full max-w-[1240px] px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <BackControl />
            {ownerBar}
          </div>
        </div>
      )}
      <div className="relative z-10 mx-auto w-full max-w-[1240px] px-4 sm:px-6">
        {!banner && (
          <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <BackControl />
            {ownerBar}
          </div>
        )}

        {/* ── who they are, centred ──────────────────────────────────────── */}
        {/* -mt-[10.5rem] (owner 2026-08-23, second word: "the banner can go
            down to the start of the person's name"): 168px = the avatar's
            128 + its mt-5 + the Creator eyebrow + the name's mt-2, so the
            band's foot lands exactly where the name begins - the photo AND the
            eyebrow ride the art, the name starts on the page. */}
        <div className={`flex flex-col items-center text-center ${banner ? '-mt-[10.5rem]' : 'pt-6'}`}>
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-1.5 rounded-full opacity-60 blur-lg"
              style={{ background: `linear-gradient(135deg, ${accent}, var(--color-cyan))` }}
            />
            {/* SLIGHTLY OVERLAPPING THE BANNER, which is what a profile photo
                does. The ring is the PAGE colour rather than a white hairline:
                it cuts the photo out of the band above it, so the overlap reads
                as deliberate instead of as two things touching. */}
            <div className="relative overflow-hidden rounded-full ring-4 ring-void">
              <BasketAvatar address={profile.address} symbol={avatarSymbol} imageUrl={avatarUrl} size={120} />
            </div>
          </div>

          <div className="mt-5 font-mono text-[10px] uppercase tracking-[0.25em] text-ink-faint">Creator</div>
          {/* Fluid, and centred: a handle is arbitrary text, and at a fixed size
              a long one broke mid-word. */}
          <h1
            className="mt-2 break-words font-display font-bold leading-[0.95] tracking-tight text-ink"
            style={{ fontSize: 'clamp(1.75rem, 1rem + 3.4vw, 3rem)' }}
          >
            {identity.label}
          </h1>

          {/* One 36px row of controls, centred under the name. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {handle ? (
              <button
                type="button"
                onClick={() => void copyName(`${window.location.origin}/creator/${handle.display}`)}
                title={`Copy ${window.location.host}/creator/${handle.display}`}
                aria-label="Copy this creator page link"
                className={`press inline-flex h-9 items-center rounded-full border px-3 font-mono text-[11px] tracking-[0.04em] ${
                  nameCopied
                    ? 'border-cyan/60 bg-cyan/10 text-cyan'
                    : 'border-cyan/35 bg-cyan/[0.06] text-ink hover:border-cyan/70'
                }`}
              >
                <span className="text-ink-faint">/creator/</span>
                <span className="font-semibold">{handle.display}</span>
                <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  {nameCopied ? 'copied ✓' : 'copy'}
                </span>
              </button>
            ) : null}
            <FollowButton deployer={profile.address} className="h-9 px-3" />
            {/* THEIR X — safe by construction: the handle they signed, host as
                a literal, so no typed value can steer where this goes.
                ── AND NOW, WHETHER IT IS THEIRS ──────────────────────────────
                A signed profile proves the WALLET, never the account, which is
                why this chip spent its life saying nothing about ownership.
                `xStandingFor` upgrades it to "verified" ONLY when this build
                checked a link-back post: from that handle, naming this
                address. The flag is a build artifact, so nothing the creator
                writes can grant it to themselves, and a handle changed after
                the check drops back to a plain claim rather than carrying the
                tick onto a handle nobody looked at. */}
            {xUrl && (
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={
                  xStanding.kind === 'verified'
                    ? `@${xStanding.handle} posted this creator address from that account (checked ${xStanding.checkedAt}). Proves the account, not an endorsement.`
                    : `${identityMeta?.handle} on X (creator-provided, unverified)`
                }
                className={`press inline-flex h-9 items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] tracking-[0.04em] ${
                  xStanding.kind === 'verified'
                    ? 'border-teal/40 bg-teal/[0.08] text-teal hover:border-teal/70'
                    : 'border-white/15 bg-white/[0.04] text-ink-dim hover:border-white/35 hover:text-ink'
                }`}
              >
                <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3 fill-current">
                  <path d="M18.9 2H22l-7 8 7.6 12H16l-5-7.6L4.9 22H2l7.4-8.4L2 2h6.7l4.7 7.1L18.9 2Z" />
                </svg>
                @{(identityMeta?.handle ?? '').replace(/^@+/, '')}
                {xStanding.kind === 'verified' && (
                  <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </a>
            )}
            {/* The proof itself is one click away, because a badge a reader
                cannot check is just a nicer-looking claim. */}
            {xStanding.proofUrl && (
              <a
                href={xStanding.proofUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title="The post this account made naming this creator address"
                className="press inline-flex h-9 items-center rounded-full border border-white/12 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint hover:border-white/30 hover:text-ink"
              >
                proof
              </a>
            )}
            <CopyAddress
              address={profile.address}
              what="creator address"
              className="[&>button]:h-9 [&>button]:px-3 [&>button]:text-[11px]"
            />
            {identityMeta && (
              <span className="inline-flex h-9 items-center rounded-full border border-teal/40 bg-teal/10 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-teal">
                Signed profile
              </span>
            )}
            {profile.chains.map((c) => (
              <ChainBadge key={c} chainId={c} size="md" className="h-9 px-3" />
            ))}
          </div>

          {/* THE THESIS, DIRECTLY UNDER THE NAME. Centred with the identity, and
              measure-capped: centred text past ~60ch stops being readable. */}
          {bio ? (
            <div className="mt-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-faint">Their thesis</div>
              <p className="mx-auto mt-3 max-w-[60ch] text-[17px] leading-relaxed text-ink sm:text-[19px]">{bio}</p>
            </div>
          ) : (
            <p className="mx-auto mt-7 max-w-[60ch] text-sm leading-relaxed text-ink-faint">
              {isMe
                ? 'You have not published a profile yet. Sign one to add your name, a thesis and the tokens you back, on every Spectrum site at once.'
                : 'No profile published yet. Until then this page is what the address itself proves: the baskets it published, and how they have gone.'}
            </p>
          )}
          {followerLine && (
            <div className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">{followerLine}</div>
          )}
        </div>

        {/* ── HIS ROW: chart · holders · total value · bullish ─────────────
            One band across the page rather than a fact strip inside a plate.
            The chart takes the widest cell because it is the only one with a
            shape to read; the two numbers are narrow; the circles need room for
            four faces and their reserved note line. Each cell keeps its own
            surface, which is what stops a borderless page becoming a soup —
            the boxes that went were the ones AROUND the content, not the ones
            holding a single fact. */}
        {/* MORE WIDTH, taken from the column that had the least to say: the two
            stacked figures are a label and a number each, so 0.9fr → 0.75fr
            costs them nothing legible and hands the curve ~42px. Convictions
            keeps its 1.5fr because it is width-bound (four faces on a row),
            unlike the numbers, which are not. */}
        <div className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(0,0.75fr)_minmax(0,1.5fr)] lg:items-stretch">
          {valueChart ?? <div className="hidden lg:block" />}
          {/* THE TWO NUMBERS SHARE ONE COLUMN, stacked (owner 2026-08-22: "these
              two have too much height per card, make em one top and one bottom
              in same column"). Beside a ~320px chart, two separate full-height
              cells each carried a single figure and 200px of air. One column of
              two keeps the row's height honest and reads as a pair, which is
              what they are: what it is worth, and who holds it. */}
          <div className="grid min-w-0 grid-rows-2 gap-4">
            {factByLabel('Total value') ?? <div />}
            {factByLabel('Holders') ?? <div />}
          </div>
          <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: SPECTRAL, opacity: 0.55 }} />
            <Convictions identityMeta={identityMeta} isMe={isMe} onEdit={onEdit} />
          </div>
        </div>

      {/* Their UNWITHDRAWN crown balance (not cumulative earnings — it zeroes
            on withdraw and self-hides at 0), and the claim button when the
            viewer is them. */}
        <CrownWinnings creator={profile.address} className="mt-4" />
      </div>
    </section>
  )
}

/* ONE back control, history-aware (owner 2026-08-23: "it should go back to
   whatever page you were last on, and defaults to creators if direct"). The
   router stamps history.state.idx on every in-app navigation, so idx > 0 means
   there IS an in-app page behind us and browser-back lands inside the site;
   idx 0 or absent means this tab arrived here directly, and /creators is the
   honest default. Never a bare navigate(-1): on a direct visit that would walk
   the visitor out of the site entirely. */
function BackControl() {
  const navigate = useNavigate()
  const goBack = () => {
    const idx = typeof window !== 'undefined' ? ((window.history.state as { idx?: number } | null)?.idx ?? 0) : 0
    if (idx > 0) navigate(-1)
    else void navigate('/creators')
  }
  return (
    <button
      type="button"
      onClick={goBack}
      className="press inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-black/45 px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ink backdrop-blur hover:border-white/40"
    >
      ← Back
    </button>
  )
}

