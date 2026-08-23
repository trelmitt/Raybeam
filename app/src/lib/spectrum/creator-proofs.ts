// ─────────────────────────────────────────────────────────────────────────────
// THE READ SIDE of the X link-back — what the FE is allowed to call verified.
//
// The flag comes from a BUILD artifact (scripts/build-creator-proofs.mjs), not
// from the creator's own profile. That is the whole point: a creator supplies
// a proof, the build decides, and nothing a creator can write makes their own
// badge read "verified".
//
// Three states, and the middle one is the honest default:
//   verified  — the build checked the post: it is from that handle and it
//               names this address.
//   claimed   — a handle, and maybe a proof, that this build has not (yet)
//               confirmed. Never rendered as verification.
//   none      — no handle at all.
// ─────────────────────────────────────────────────────────────────────────────
import proofs from '../../generated/creator-proofs.json'
import { bareHandle, xProofUrl } from './x-proof'

interface ProofFile {
  v: number
  checkedAt: string
  verified: Record<string, { handle: string; postId: string }>
}

const FILE = proofs as ProofFile

export type XStandingKind = 'verified' | 'claimed' | 'none'

export interface XStanding {
  kind: XStandingKind
  /** Bare handle (no '@'), or null. */
  handle: string | null
  /** The public link to their X, when the handle is X-shaped. */
  profileUrl: string | null
  /** The link to the proof post — only ever present when verified. */
  proofUrl: string | null
  /** The date the build last confirmed it (YYYY-MM-DD), when verified. */
  checkedAt: string | null
}

const NONE: XStanding = { kind: 'none', handle: null, profileUrl: null, proofUrl: null, checkedAt: null }

/**
 * What this build can honestly say about a creator's X.
 *
 * ⚠ The verified entry must agree with the handle the creator currently
 * claims. If they changed their handle after the build verified the old one,
 * that is a CLAIM again, not a verification — otherwise a rename would carry a
 * badge onto a handle nobody checked.
 */
export function xStandingFor(
  chainId: number,
  address: string | null | undefined,
  claimedHandle: string | null | undefined,
): XStanding {
  const handle = bareHandle(claimedHandle)
  if (!handle) return NONE
  const profileUrl = xProofUrl(handle, '1') ? `https://x.com/${handle}` : null
  const claimed: XStanding = { kind: 'claimed', handle, profileUrl, proofUrl: null, checkedAt: null }
  if (!address) return claimed

  const hit = FILE?.verified?.[`${chainId}:${address.toLowerCase()}`]
  if (!hit) return claimed
  if (bareHandle(hit.handle).toLowerCase() !== handle.toLowerCase()) return claimed

  return {
    kind: 'verified',
    handle,
    profileUrl,
    proofUrl: xProofUrl(hit.handle, hit.postId),
    checkedAt: FILE.checkedAt ?? null,
  }
}

/** The date this site last re-checked its proofs, for an "as of" line. */
export function proofsCheckedAt(): string | null {
  return FILE?.checkedAt ?? null
}
