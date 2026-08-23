import { useEffect, useState } from 'react'
import { showSymbol } from '../../lib/spectrum/safe-copy'
import { Link } from 'react-router'
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from 'wagmi'
import { isAddress, parseAbi, type Address } from 'viem'
import { useQueryClient } from '@tanstack/react-query'
import { encodeProfileJson, fetchOnchainProfile, NOTE_KINDS, onchainToIdentityMeta, notesRegistryAbi } from '../../lib/spectrum/profile-registry'
import {
  buildCreatorIdentity,
  clearLocalIdentity,
  hasPublishableIdentity,
  identityBlobJson,
  identityConventionPath,
  loadLocalIdentity,
  MAX_PICKS,
  resolveCreatorIdentityAny,
  saveLocalIdentity,
  signCreatorIdentity,
  xUrlForHandle,
  type SignedCreatorIdentity,
} from '../../lib/spectrum/creator-identity'
import { useActiveChainId } from '../../lib/chain/active-chain'
import { chainCfg } from '../../lib/chain/chains'
import { clientFor } from '../../lib/chain/rpc'
import { AssetLogo } from '../AssetLogo'
import { BasketAvatar } from '../BasketAvatar'
import { searchTokens, type TokenHit } from '../../lib/spectrum/token-search'
import { WalletButton } from '../WalletButton'
import { WALLET_ENABLED } from '../../lib/config/features'
import { shortAddr } from '../../lib/spectrum/format'
import { creatorPath } from '../../lib/spectrum/handle-registry'
import { useHandleForAddress } from '../../lib/spectrum/use-handles'
import { useNetworkSwitch } from '../WrongNetwork'
import { parseProofPostId, proofPostText, xProofUrl } from '../../lib/spectrum/x-proof'
import { sanitizeImageUrl } from '../../lib/spectrum/creator-metadata'

// ─────────────────────────────────────────────────────────────────────────────
// Creator sign-up (lab 2026-07-28) — the /creators self-serve profile editor.
// Connect a wallet → fill a profile (name, @handle, avatar/banner, bio, the
// tokens you're bullish on) → SIGN it (EIP-712, creator-identity.ts) → the
// profile is live on /creator/<you> in this browser at once (localStorage rung),
// and the downloaded JSON is what the operator commits at
// app/metadata/creators/<chainId>/<address>.json to make it live for everyone.
// The FE owns no key and no DB; the signature is the whole trust story.
// ─────────────────────────────────────────────────────────────────────────────

const symbolAbi = parseAbi(['function symbol() view returns (string)'])

interface PickDraft {
  address: string
  note: string
  symbol: string | null // resolved live; null = unresolved/pending
}

const field =
  'w-full rounded-lg border border-white/12 bg-black/30 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-cyan/60 focus:outline-none'
const label = 'font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint'

function draftFromExisting(blob: SignedCreatorIdentity | null): {
  name: string
  handle: string
  avatarUrl: string
  bannerUrl: string
  bio: string
  picks: PickDraft[]
  delegate: string
  xProof: string
} {
  const m = blob?.metadata
  return {
    name: m?.name ?? '',
    handle: m?.handle ?? '',
    avatarUrl: m?.avatarUrl ?? '',
    bannerUrl: m?.bannerUrl ?? '',
    bio: m?.bio ?? '',
    picks: (m?.picks ?? []).map((a, i) => ({ address: a, note: m?.pickNotes[i] ?? '', symbol: null })),
    delegate: m?.delegate ?? '',
    xProof: m?.xProof ?? '',
  }
}

export function CreatorSignup() {
  const { address, isConnected, chainId: walletChainId } = useAccount()
  // "Your page" prefers your claimed name (the address form always works).
  const { lookup: myHandle } = useHandleForAddress(address)
  const myPage = creatorPath(address ?? '', myHandle.status === 'found' ? myHandle.owner : null)
  const chainId = useActiveChainId()
  const cfg = chainCfg(chainId)
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const queryClient = useQueryClient()

  // On-chain registry configured → publishing is ONE tx, live for everyone on
  // every site instantly. No registry on this chain → signed-blob fallback
  // (localStorage + download for the operator to commit).
  const registry = cfg.notesRegistry
  // The house switch affordance (owner 2026-08-16: the publish gate "doesnt
  // allow / detect the rh switch") — the old shape was a press-time error
  // string, which neither offered the switch nor updated when the wallet
  // moved. The hook's mismatch is reactive and switchNow() is dapp-initiated,
  // which propagates even where an in-wallet manual switch does not.
  const sw = useNetworkSwitch(chainId)
  const [draft, setDraft] = useState(() => draftFromExisting(null))
  const [pickInput, setPickInput] = useState('')
  const [pickError, setPickError] = useState<string | null>(null)
  // THE REAL TOKEN SEARCH (owner 2026-08-15: "this section should literally
  // use the search we have for tokens in the create system") — the same
  // searchTokens engine the pickers run, debounced; a pasted address still
  // adds directly.
  const [pickResults, setPickResults] = useState<TokenHit[]>([])
  useEffect(() => {
    const q = pickInput.trim()
    if (q.length < 2 || isAddress(q, { strict: false })) {
      setPickResults([])
      return
    }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      // House-pinned identities transcend the active chain HERE (owner
      // 2026-08-16: "if you type in prism anywhere in the ticker search
      // system including what assets you're bullish on it should always show
      // 0xcf4d…e040 first"). A bullish pick is an identity claim, not a leg
      // on this chain, so the mainnet sweep's house pins may lead the list.
      // Leg pickers must NOT do this: a chain-1 address cannot be a leg of a
      // basket on another chain.
      void Promise.all([
        searchTokens(q, chainId, ctl.signal),
        chainId !== 1 ? searchTokens(q, 1, ctl.signal).catch(() => [] as TokenHit[]) : Promise.resolve([] as TokenHit[]),
      ])
        .then(([hits, ethHits]) => {
          const pinned = ethHits.filter((h) => h.housePinned)
          const seen = new Set(pinned.map((h) => h.address.toLowerCase()))
          setPickResults([...pinned, ...hits.filter((h) => !seen.has(h.address.toLowerCase()))].slice(0, 6))
        })
        .catch(() => {})
    }, 250)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [pickInput, chainId])
  const addPickHit = (hit: TokenHit) => {
    if (draft.picks.some((x) => x.address.toLowerCase() === hit.address.toLowerCase())) {
      setPickError('Already in your list.')
      return
    }
    if (draft.picks.length >= MAX_PICKS) {
      setPickError(`Up to ${MAX_PICKS} tokens.`)
      return
    }
    setPickError(null)
    setPickInput('')
    setPickResults([])
    setDraft((d) => ({ ...d, picks: [...d.picks, { address: hit.address, note: '', symbol: hit.symbol }] }))
  }
  const [proofCopied, setProofCopied] = useState(false)
  /** The chain an EXISTING on-chain profile lives on, when it is not the one
   *  being edited - the fork guard's whole state. */
  const [homeChain, setHomeChain] = useState<number | null>(null)
  const [resolving, setResolving] = useState(false)
  const [signing, setSigning] = useState(false)
  const [published, setPublished] = useState<SignedCreatorIdentity | null>(null)
  const [publishedOnchain, setPublishedOnchain] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill: this browser's draft first, else the creator's LIVE on-chain
  // profile (so "edit" from another device starts from what everyone sees).
  useEffect(() => {
    if (!address) return
    setHomeChain(null)
    const existing = loadLocalIdentity(chainId, address)
    setDraft(draftFromExisting(existing))
    setPublished(null)
    setPublishedOnchain(false)
    setError(null)
    if (!existing && registry && publicClient) {
      void fetchOnchainProfile(publicClient, registry, address)
        .then((hit) => {
          if (hit) {
            const m = onchainToIdentityMeta(hit.json, address, hit.blockNumber)
            setDraft((d) =>
              d.name || d.bio || d.picks.length > 0
                ? d // the user already started typing — never clobber
                : {
                    name: m.name,
                    handle: m.handle,
                    avatarUrl: m.avatarUrl,
                    bannerUrl: m.bannerUrl,
                    bio: m.bio,
                    picks: m.picks.map((a, i) => ({ address: a, note: m.pickNotes[i] ?? '', symbol: null })),
                    delegate: m.delegate ?? '',
                    xProof: m.xProof ?? '',
                  },
            )
            return null
          }
          // ⚠ THE FORK GUARD (found live 2026-08-23: the owner's profile lives
          // on Ethereum's registry while the site toggle sat on Robinhood).
          // The active-chain read missing does NOT mean no profile - it means
          // not HERE. Without this fallback the editor opened EMPTY over a
          // published identity, and republishing would have forked it onto a
          // second chain, which the page resolver would then shadow forever.
          return resolveCreatorIdentityAny(address)
        })
        .then((any) => {
          if (!any) return
          setHomeChain(any.chainId)
          setDraft((d) =>
            d.name || d.bio || d.picks.length > 0
              ? d
              : {
                  name: any.name ?? '',
                  handle: any.handle ?? '',
                  avatarUrl: any.avatarUrl ?? '',
                  bannerUrl: any.bannerUrl ?? '',
                  bio: any.bio ?? '',
                  picks: any.picks.map((p) => ({ address: p.address, note: p.note ?? '', symbol: null })),
                  delegate: any.delegate ?? '',
                  // the verified view drops the proof id; editing the real
                  // record happens on its home chain, which the warning routes to
                  xProof: '',
                },
          )
        })
        .catch(() => {})
    }
  }, [address, chainId, registry, publicClient])

  // Resolve pick symbols live (display-only; junk stays visible as an address).
  useEffect(() => {
    const unresolved = draft.picks.filter((p) => p.symbol === null && isAddress(p.address, { strict: false }))
    if (unresolved.length === 0) return
    let stale = false
    void Promise.all(
      unresolved.map(async (p) => {
        const symbol = await clientFor(chainId)
          .readContract({ address: p.address as Address, abi: symbolAbi, functionName: 'symbol' })
          .then((s) => (typeof s === 'string' && s ? s.slice(0, 16) : '?'))
          .catch(() => '?')
        return { address: p.address, symbol }
      }),
    ).then((resolved) => {
      if (stale) return
      setDraft((d) => ({
        ...d,
        picks: d.picks.map((p) => {
          const hit = resolved.find((r) => r.address === p.address)
          return hit ? { ...p, symbol: hit.symbol } : p
        }),
      }))
    })
    return () => {
      stale = true
    }
  }, [draft.picks, chainId])

  function addPick() {
    const a = pickInput.trim()
    if (!isAddress(a, { strict: false })) {
      setPickError('That is not a token address (0x…40 hex).')
      return
    }
    if (draft.picks.some((p) => p.address.toLowerCase() === a.toLowerCase())) {
      setPickError('Already in your list.')
      return
    }
    if (draft.picks.length >= MAX_PICKS) {
      setPickError(`Up to ${MAX_PICKS} tokens.`)
      return
    }
    setPickError(null)
    setPickInput('')
    setResolving(true)
    setDraft((d) => ({ ...d, picks: [...d.picks, { address: a, note: '', symbol: null }] }))
    setResolving(false)
  }

  // The X chip shows in the preview exactly when it will show on the page:
  // xUrlForHandle is the single authority on what links (1-15 of [A-Za-z0-9_]),
  // so a handle that will never link cannot draw a chip here either.
  const xHandle = (xUrlForHandle(draft.handle) ?? '').replace('https://x.com/', '') || null

  // The proof post, normalized to digits the moment it is read: whatever they
  // paste, only an id is ever stored (x-proof.ts explains why).
  const proofId = parseProofPostId(draft.xProof)
  const proofLink = xHandle ? xProofUrl(xHandle, proofId ?? '') : null
  // The post they copy (owner 2026-08-23: interesting, no full wallet, link
  // their page). With a claimed kit name the NAME is the binding, so no hex;
  // without one the full address stays the binding. The page link is for
  // humans - the check never reads URLs (t.co truncation), so a localhost
  // origin during a dev walk is cosmetic.
  const kitHandle = myHandle.status === 'found' ? myHandle.owner.display : null
  const proofText = address
    ? proofPostText(address, {
        kitHandle,
        pageUrl: `${(import.meta.env.VITE_SITE_URL ?? '').trim() || window.location.origin}${myPage}`,
      })
    : ''

  // THE PREVIEW SHOWS WHAT THE PAGE WILL SHOW, not what was typed. The page
  // runs every image URL through sanitizeImageUrl at the verified gate (https,
  // ipfs via the gateway, or a small data URI - http and everything else
  // become house art). A preview that rendered the raw draft let a creator
  // watch an http banner "work", publish, and never see it again.
  const previewBanner = sanitizeImageUrl(draft.bannerUrl)
  const previewAvatar = sanitizeImageUrl(draft.avatarUrl)

  const [avatarNote, setAvatarNote] = useState<string | null>(null)
  /** Downscale an uploaded image to a 64px raster data URI small enough to live
   *  INSIDE the on-chain profile note (the registry caps notes at 16KB; the
   *  sanitizer accepts raster data URIs to ~10KB). SVG never accepted. */
  async function inlineAvatar(file: File) {
    setAvatarNote(null)
    try {
      const bmp = await createImageBitmap(file)
      // 128, not 64 (owner 2026-08-23: "better resolution"): the hero draws
      // the avatar at 120px, so a 64px inline upscaled and read soft. The
      // byte caps below are unchanged - a 128px webp usually lands 4-8KB, and
      // anything that will not fit still says to use a URL, which remains the
      // full-resolution path.
      const side = 128
      const canvas = document.createElement('canvas')
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      // cover-crop to square
      const s = Math.min(bmp.width, bmp.height)
      ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, side, side)
      let uri = canvas.toDataURL('image/webp', 0.82)
      if (!uri.startsWith('data:image/webp')) uri = canvas.toDataURL('image/jpeg', 0.82)
      if (uri.length > 14_000) {
        uri = canvas.toDataURL('image/jpeg', 0.6)
      }
      if (uri.length > 14_000) {
        setAvatarNote('That image will not compress small enough to store on-chain — use a URL instead.')
        return
      }
      setDraft((d) => ({ ...d, avatarUrl: uri }))
      setAvatarNote(`Inlined at 128px (${(uri.length / 1024).toFixed(1)}KB) — travels inside your on-chain profile.`)
    } catch {
      setAvatarNote('Could not read that image.')
    }
  }

  async function publish() {
    if (!address) return
    const factory = cfg.factory
    if (!factory) {
      setError(`No factory is configured for ${cfg.name} — a profile signs against this site's deployment.`)
      return
    }
    const meta = buildCreatorIdentity(
      {
        name: draft.name,
        handle: draft.handle,
        avatarUrl: draft.avatarUrl,
        bannerUrl: draft.bannerUrl,
        bio: draft.bio,
        picks: draft.picks.map((p) => ({ address: p.address, note: p.note })),
      },
      address,
      Math.floor(Date.now() / 1000),
    )
    if (!hasPublishableIdentity(meta)) {
      setError('Add at least one thing: a name, a thesis, or a token pick.')
      return
    }
    setSigning(true)
    setError(null)
    try {
      if (registry && publicClient) {
        // ── ON-CHAIN publish: one tx, live for everyone on every site ──
        if (walletChainId !== chainId) {
          setError(`Switch your wallet to ${cfg.name} to publish (the registry lives there).`)
          return
        }
        // Encode from the CAPPED meta, not the raw draft (audit L5) — the
        // signed path already applied the caps, and the URL fields have no
        // maxLength, so a pasted data-URI could sail past them.
        const json = encodeProfileJson({
          name: meta.name,
          handle: meta.handle,
          avatarUrl: meta.avatarUrl,
          bannerUrl: meta.bannerUrl,
          bio: meta.bio,
          picks: meta.picks.map((a, i) => ({ address: a, note: meta.pickNotes[i] ?? '' })),
          delegate: draft.delegate, // posting key only — validated in the encoder
          xProof: draft.xProof, // normalized to a digits-only id by the encoder
        })
        // Pre-check the contract's byte cap so an oversized note fails HERE
        // with a readable reason instead of as an opaque revert after gas.
        const noteBytes = new TextEncoder().encode(json).length
        if (noteBytes > 16_384) {
          setError(
            `This profile is ${(noteBytes / 1024).toFixed(1)}KB and the on-chain limit is 16KB. Shorten the thesis, or use image URLs instead of pasted image data.`,
          )
          return
        }
        const h = await writeContractAsync({
          address: registry,
          abi: notesRegistryAbi,
          functionName: 'setNote',
          args: [address, NOTE_KINDS.profile, json], // a profile is a note about yourself
          chainId,
        })
        await publicClient.waitForTransactionReceipt({ hash: h })
        clearLocalIdentity(chainId, address) // the chain is now the source of truth
        setPublishedOnchain(true)
        setPublished(null)
      } else {
        // ── fallback: signed blob (this browser now; operator commits for all) ──
        const blob = await signCreatorIdentity({
          meta,
          signer: address,
          chainId,
          factory,
          signTypedDataAsync: (args) => signTypedDataAsync(args as never),
        })
        saveLocalIdentity(chainId, address, blob)
        setPublished(blob)
      }
      // The creator page reads this query — refresh it so /creator/<me> is live now.
      void queryClient.invalidateQueries({ queryKey: ['spectrum', 'creatorIdentity', address.toLowerCase()] })
    } catch (e) {
      setError(e instanceof Error ? (e.message.split('\n')[0] ?? 'Publishing failed.') : 'Publishing failed.')
    } finally {
      setSigning(false)
    }
  }

  function downloadBlob(blob: SignedCreatorIdentity) {
    try {
      const url = URL.createObjectURL(new Blob([identityBlobJson(blob)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${blob.metadata.creator.toLowerCase()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      /* best-effort — localStorage already holds it */
    }
  }

  if (!WALLET_ENABLED) return null

  return (
    <div className="rounded-3xl card-surface backdrop-blur-md">
      <div className="p-6 sm:p-8">
        {!isConnected || !address ? (
          <div className="flex flex-col items-start gap-4">
            <p className="max-w-xl text-sm leading-relaxed text-ink-dim">
              Connect the wallet you launch baskets with. Your page lives at your address — the profile
              you sign here is what visitors see on it.
            </p>
            <WalletButton />
          </div>
        ) : publishedOnchain ? (
          <div className="space-y-4">
            <h3 className="font-display text-xl font-bold uppercase tracking-tight text-teal">Profile published on-chain, live everywhere</h3>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
              Your profile now lives on {cfg.name} itself. Every visitor, on this site and on any other
              site running this kit, reads it straight from the chain. No account, no database, no
              operator step; update it any time with another transaction.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={myPage}
                className="rounded-lg bg-cyan px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-void press hover:opacity-90"
              >
                View your page →
              </Link>
              <button
                type="button"
                onClick={() => setPublishedOnchain(false)}
                className="rounded-lg border border-white/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-faint press hover:text-ink"
              >
                Edit again
              </button>
            </div>
          </div>
        ) : published ? (
          <div className="space-y-4">
            <h3 className="font-display text-xl font-bold uppercase tracking-tight text-teal">Profile signed — you're live</h3>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
              This browser shows it immediately. To make it visible to <span className="text-ink">everyone</span>,
              download the signed file and have the site operator commit it at{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-cyan">
                app/metadata/{identityConventionPath(chainId, address)}
              </code>{' '}
              — it ships in the next build. No account, no database; the signature is the proof it's yours.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={myPage}
                className="rounded-lg bg-cyan px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-void press hover:opacity-90"
              >
                View your page →
              </Link>
              <button
                type="button"
                onClick={() => downloadBlob(published)}
                className="rounded-lg border border-white/15 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-dim press hover:border-cyan/50 hover:text-cyan"
              >
                Download signed profile
              </button>
              <button
                type="button"
                onClick={() => setPublished(null)}
                className="rounded-lg border border-white/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-faint press hover:text-ink"
              >
                Edit again
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* THE LIVE PREVIEW (owner 2026-08-15: "way more visual, way less
                text, more fun") — you are not filling a form, you are watching
                your page assemble, live on every keystroke.

                It mirrors the CURRENT hero (CreatorHero: photo overlapping the
                band, name centred, thesis under it), not the left-aligned card
                the page used before 2026-08-22 — a preview of a layout that no
                longer exists is worse than no preview, because it is believed.

                It carries the band's OWN two gradients, and that is the point:
                they decide what an uploaded banner actually LOSES. The outer
                12% of each side and the foot fade into the page, so a logo
                parked in a corner is gone — and without showing it here the
                creator only discovers that after publishing. */}
            <Link
              to={myPage}
              className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-void pb-6"
              title="Open your public page"
            >
              <span className="relative block h-24 w-full sm:h-28">
                {previewBanner ? (
                  <img src={previewBanner} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover transition-opacity group-hover:opacity-90" />
                ) : (
                  <span aria-hidden className="absolute inset-0 opacity-40" style={{ background: 'linear-gradient(120deg,var(--color-cyan),var(--color-violet-bright),var(--color-magenta))' }} />
                )}
                {/* the real band's fades, to scale */}
                <span aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(90deg, var(--color-void) 0%, transparent 12%, transparent 88%, var(--color-void) 100%)' }} />
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-14" style={{ background: 'linear-gradient(180deg, transparent, var(--color-void))' }} />
              </span>

              <span className="absolute left-4 top-3 z-10 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
                preview · {shortAddr(address)} on {cfg.name}
              </span>
              <span className="absolute right-4 top-3 z-10 font-mono text-[9px] uppercase tracking-[0.2em] text-cyan opacity-0 transition-opacity group-hover:opacity-100">
                your page →
              </span>

              {/* the identity, centred and climbing into the band */}
              <span className="relative z-10 -mt-5 block px-4 text-center">
                <span className="relative inline-block">
                  <span
                    aria-hidden
                    className="absolute -inset-1 rounded-full opacity-60 blur-md"
                    style={{ background: 'linear-gradient(135deg, var(--color-violet-bright), var(--color-cyan))' }}
                  />
                  <span className="relative block overflow-hidden rounded-full ring-4 ring-void">
                    <BasketAvatar address={address} symbol={draft.name || 'you'} imageUrl={previewAvatar ?? undefined} size={64} />
                  </span>
                </span>

                <span className="mt-3 block font-mono text-[9px] uppercase tracking-[0.25em] text-ink-faint">Creator</span>
                <span className="mt-1 block truncate font-display text-2xl font-bold leading-tight tracking-tight text-ink">
                  {draft.name.trim() || 'Your name'}
                </span>

                {xHandle && (
                  <span className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-2.5 font-mono text-[10px] tracking-[0.04em] text-ink-dim">
                    <svg viewBox="0 0 24 24" aria-hidden className="h-2.5 w-2.5 fill-current">
                      <path d="M18.9 2H22l-7 8 7.6 12H16l-5-7.6L4.9 22H2l7.4-8.4L2 2h6.7l4.7 7.1L18.9 2Z" />
                    </svg>
                    @{xHandle}
                  </span>
                )}

                <span className="mt-4 block font-mono text-[9px] uppercase tracking-[0.25em] text-ink-faint">Their thesis</span>
                <span className="mx-auto mt-1.5 block max-w-[52ch] text-[13px] leading-relaxed text-ink-dim">
                  {draft.bio.trim() || 'Your thesis: what you back, and why.'}
                </span>
              </span>
            </Link>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className={label}>Display name</div>
                <input className={field} maxLength={48} placeholder="Basket Chef" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              {/* IT LINKS NOW (owner 2026-08-22, xUrlForHandle's own note), so
                  the old "shown, never linked" label was a promise the page had
                  stopped keeping. maxLength was 20 while X names stop at 15, so
                  a 16-char handle silently drew no link and said nothing. */}
              <div className="space-y-1.5">
                <div className={label}>X handle</div>
                <input className={field} maxLength={16} placeholder="@basketchef" value={draft.handle} onChange={(e) => setDraft({ ...draft, handle: e.target.value })} />
                {draft.handle.trim() && !xHandle ? (
                  <p className="font-mono text-[10px] text-amber-300/90">
                    Up to 15 letters, numbers or underscores. This one will not link.
                  </p>
                ) : (
                  <p className="font-mono text-[10px] text-ink-faint">
                    Links to x.com/{xHandle ?? 'yourname'} from your page.
                  </p>
                )}
              </div>
              {/* PROVE IT IS YOURS. Signing proves the WALLET; it cannot prove
                  the account. The missing half is a post from that account
                  naming this address, which only its owner can write. The site
                  checks it at build time (no key, no account, nothing to sign
                  up for) and re-checks daily, so a deleted post or a sold
                  handle drops the tick on its own.

                  ⚠ GATED ON `registry`, exactly like the delegate field below
                  and for the same reason: the proof id travels ONLY on the
                  on-chain profile note, and build-creator-proofs.mjs reads only
                  those notes. Where there is no registry the signed-blob
                  fallback carries no proof and nothing would ever check it, so
                  showing this box there would send a creator off to post on X
                  for a result that could never arrive. */}
              {registry && xHandle && (
                <div className="space-y-1.5 sm:col-span-2">
                  <div className={label}>Prove this handle is yours (optional)</div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <p className="text-[12px] leading-relaxed text-ink-dim">
                      Post this from <span className="text-ink">@{xHandle}</span>, then paste the link:
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 whitespace-pre-line rounded bg-white/[0.06] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-cyan">
                        {proofText}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            void navigator.clipboard.writeText(proofText)
                            setProofCopied(true)
                            setTimeout(() => setProofCopied(false), 1600)
                          } catch {
                            /* clipboard blocked: the text is right there to select */
                          }
                        }}
                        className="press shrink-0 rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim hover:border-cyan/50 hover:text-cyan"
                      >
                        {proofCopied ? 'copied ✓' : 'copy'}
                      </button>
                    </div>
                    <input
                      className={`${field} mt-2`}
                      placeholder="https://x.com/…/status/…"
                      value={draft.xProof}
                      onChange={(e) => setDraft({ ...draft, xProof: e.target.value })}
                    />
                    {draft.xProof.trim() && !proofId ? (
                      <p className="mt-1.5 font-mono text-[10px] text-amber-300/90">
                        That is not a post link. It should end in /status/ and a number.
                      </p>
                    ) : proofLink ? (
                      <p className="mt-1.5 font-mono text-[10px] text-ink-faint">
                        Saved as {proofLink}. Checked when the site next builds.
                      </p>
                    ) : (
                      <p className="mt-1.5 font-mono text-[10px] text-ink-faint">
                        Keep the post short so your address is not cut off.
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <div className={label}>Avatar (url, ipfs or upload)</div>
                <div className="flex items-center gap-2">
                  <input className={field} placeholder="https://…/avatar.png" value={draft.avatarUrl} onChange={(e) => setDraft({ ...draft, avatarUrl: e.target.value })} />
                  <label className="press shrink-0 cursor-pointer rounded-lg border border-white/15 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim hover:border-cyan/50 hover:text-cyan">
                    Upload
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void inlineAvatar(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                {avatarNote && <p className="font-mono text-[10px] text-amber-300/90">{avatarNote}</p>}
              </div>
              <div className="space-y-1.5">
                <div className={label}>Banner (url)</div>
                <input className={field} placeholder="https://…/banner.png" value={draft.bannerUrl} onChange={(e) => setDraft({ ...draft, bannerUrl: e.target.value })} />
                {draft.bannerUrl.trim() && !previewBanner ? (
                  <p className="font-mono text-[10px] text-amber-300/90">
                    This link will not show on your page. Use an https or ipfs image link.
                  </p>
                ) : (
                  <p className="font-mono text-[10px] text-ink-faint">Wide and short. The sides and foot fade out, so keep the subject centred.</p>
                )}
              </div>
            </div>

            {/* "bio" is the SIGNED field name (EIP-712 struct, every already
                signed and on-chain profile carries it) so it never moves. The
                page has headed it "Their thesis" since the 2026-08-22 rebuild,
                and a creator asked for a bio writes an about-me where the page
                publishes an investment view. The label is what was wrong. */}
            <div className="space-y-1.5">
              <div className={label}>Your thesis</div>
              <textarea
                className={`${field} min-h-[90px] resize-y`}
                maxLength={600}
                placeholder="I build narrative baskets around infra and AI. Long horizons, no leverage."
                value={draft.bio}
                onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
              />
            </div>

            {/* posting delegate — only meaningful for the on-chain profile
                (the signed-blob fallback has no post feed to delegate) */}
            {registry && (
              <div className="space-y-1.5">
                <div className={label}>Posting wallet (optional)</div>
                <input
                  className={field}
                  placeholder="0x… a hot wallet allowed to post updates as you"
                  value={draft.delegate}
                  onChange={(e) => setDraft({ ...draft, delegate: e.target.value })}
                />
                <p
                  className="font-mono text-[10px] leading-relaxed text-ink-faint"
                  title="It can never edit this profile or your theses; its posts are labeled 'via delegate'. Clear the field and republish to revoke."
                >
                  A hot wallet may post updates as you — this identity stays on your cold key.
                </p>
                {draft.delegate.trim() && !isAddress(draft.delegate.trim(), { strict: false }) && (
                  <p className="font-mono text-[10px] text-magenta">Not a valid address.</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className={label}>Bullish on (up to {MAX_PICKS})</div>
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    className={field}
                    placeholder="Search a token by name — or paste an address"
                    value={pickInput}
                    onChange={(e) => setPickInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      if (isAddress(pickInput.trim(), { strict: false })) addPick()
                      else if (pickResults[0]) addPickHit(pickResults[0])
                    }}
                  />
                  {isAddress(pickInput.trim(), { strict: false }) && (
                    <button
                      type="button"
                      onClick={addPick}
                      disabled={resolving}
                      className="shrink-0 rounded-lg border border-white/15 px-4 font-mono text-xs uppercase tracking-[0.14em] text-ink-dim press hover:border-cyan/50 hover:text-cyan"
                    >
                      Add
                    </button>
                  )}
                </div>
                {/* the create system's own search, six best hits — click to add */}
                {pickResults.length > 0 && (
                  <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-white/12 bg-void/95 shadow-xl backdrop-blur-md">
                    {pickResults.map((h) => (
                      <button
                        key={h.address}
                        type="button"
                        onClick={() => addPickHit(h)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06]"
                      >
                        <AssetLogo address={h.address} symbol={h.symbol} chainId={chainId} size={22} preferredSrc={h.logoURI} />
                        <span className="font-mono text-xs font-semibold text-ink">{showSymbol(h.symbol)}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{h.name}</span>
                        {h.verified && <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-teal">verified</span>}
                        {h.liquidityUsd > 0 && (
                          <span className="font-num text-[10px] tabular-nums text-ink-faint">
                            ${Math.round(h.liquidityUsd).toLocaleString()}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {pickError && <p className="font-mono text-[11px] text-magenta">{pickError}</p>}
              {draft.picks.length > 0 && (
                <div className="space-y-2 pt-1">
                  {draft.picks.map((p, i) => (
                    <div key={p.address} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                      <AssetLogo address={p.address} symbol={p.symbol ?? '?'} chainId={chainId} size={22} />
                      <span className="w-20 shrink-0 truncate font-mono text-xs font-semibold text-ink">
                        {p.symbol ?? shortAddr(p.address)}
                      </span>
                      <input
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-ink-dim placeholder:text-ink-faint focus:border-white/15 focus:outline-none"
                        maxLength={80}
                        placeholder="why? (optional one-liner)"
                        value={p.note}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            picks: d.picks.map((q, j) => (j === i ? { ...q, note: e.target.value } : q)),
                          }))
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${showSymbol(p.symbol ?? p.address)}`}
                        onClick={() => setDraft((d) => ({ ...d, picks: d.picks.filter((_, j) => j !== i) }))}
                        className="shrink-0 font-mono text-xs text-ink-faint press hover:text-magenta"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {homeChain != null && homeChain !== chainId && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-ink-dim">
                Your published profile lives on <span className="text-ink">{chainCfg(homeChain).name}</span>.
                Publishing here writes a separate {cfg.name} copy and your page will keep showing the{' '}
                {chainCfg(homeChain).name} one. Switch the site&rsquo;s network to {chainCfg(homeChain).name} to
                update the profile your page shows.
              </p>
            )}
            {error && <p className="font-mono text-[11px] text-magenta">{error}</p>}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {registry && sw.mismatch ? (
                /* the switch IS the button while the wallet is elsewhere —
                   ClaimHandle's exact grammar; publishing appears the moment
                   the wallet lands on the registry's chain */
                <button
                  type="button"
                  onClick={sw.switchNow}
                  disabled={sw.switching}
                  className="press inline-flex h-12 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 px-7 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-cyan disabled:cursor-wait disabled:opacity-60"
                >
                  {sw.switching ? 'Check your wallet…' : `Switch wallet to ${cfg.name}`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={publish}
                  disabled={signing}
                  className="spectral-btn press inline-flex h-12 items-center justify-center rounded-full px-7 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-void disabled:cursor-wait disabled:opacity-60"
                >
                  {signing ? 'Check your wallet…' : registry ? 'Publish on-chain →' : 'Sign & publish →'}
                </button>
              )}
              <span className="font-mono text-[10px] text-ink-faint">
                {registry && sw.mismatch
                  ? `your wallet is on ${sw.walletWords} · switching signs nothing`
                  : registry
                    ? `one small transaction on ${cfg.name} · lives on the chain, visible on every site`
                    : 'a signature, not a transaction — free'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
