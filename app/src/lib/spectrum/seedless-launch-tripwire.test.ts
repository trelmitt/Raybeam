// ─────────────────────────────────────────────────────────────────────────────
// THE SEEDLESS-LAUNCH TRIPWIRE (owner 2026-08-21, from the creator-funnel audit)
//
// /create has two engines. The studio wizard deploys AND makes the first mint in
// one batch (launch-first-mint.ts), because a deployed-but-unfunded basket lets
// anyone else make the first mint with a deliberately starved leg: contracts
// measured $5,000 of attacker capital turning a $10,000 honest mint into $4,255,
// a 57% loss. The default bundle ceremony does NOT do that — it deploys with no
// seed on purpose ("no seed — the bundle ceremony deploys; buying comes after",
// PublishBundleModal) and offers the deposit afterwards through SeedBundleDoor,
// which is dismissible and states no minimum.
//
// That is SAFE TODAY, and only today. launch-first-mint.ts says why in its own
// words: "today's factories give the caller no split field, so the trap cannot
// be set. It arms the moment the packing factory is seated." Every marketing CTA
// on the site points at the seedless path, so the day a packing factory seats,
// the default creator route is the exposed one.
//
// A comment cannot hold that. This test watches the SHIPPING FACTORY ABI — the
// one artefact that has to change before the trap can exist — and fails the
// moment a caller-supplied split/funding argument appears on the deploy or mint
// surface while the seedless path is still reachable. It asserts nothing about
// today's behaviour beyond the fact that the window is shut; it exists to make
// the day it opens loud, in the suite, on the commit that opens it.
//
// WHEN THIS TEST FAILS, the fix is not to loosen it. It is one of:
//   1. the bundle ceremony batches the first mint the way the studio does, or
//   2. the seedless path refuses until the basket is funded, or
//   3. the factory's split is not caller-supplied after all — then narrow the
//      matcher below and say why in this comment.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import { factoryAbi, factoryDeployAbi } from './abis-v2'
import { FIRST_DEPOSIT_REQUIRED, MIN_FIRST_DEPOSIT_USDC } from './launch-first-mint'

/** Words a caller-chosen funding split would have to introduce on the deploy
 *  surface. Deliberately broad: a false alarm costs one read of this file, a
 *  miss costs a creator's first buyer up to 57%. */
const SPLIT_ARG = /\b(split|splits|funding|fundingSplit|amounts|perLeg|legAmounts|deposits)\b/i

/** Does this deploy/mint signature hand the caller the split? The one predicate,
 *  so the live check and the liveness check below cannot drift apart. */
const letsCallerChooseSplit = (sig: string) => /^(deployBasket|mint|firstMint)\(/i.test(sig) && SPLIT_ARG.test(sig)

/** Every function signature the factory ABI exposes, as text. viem's parseAbi
 *  output is objects, so rebuild the readable shape rather than trusting a
 *  stringify order. */
function factorySignatures(): string[] {
  return ([...factoryAbi, ...factoryDeployAbi] as readonly unknown[])
    .filter((e): e is { type: string; name?: string; inputs?: { name?: string; type?: string; components?: { name?: string }[] }[] } => {
      const x = e as { type?: string }
      return x.type === 'function'
    })
    .map((f) => {
      const flat = (f.inputs ?? []).flatMap((i) => [i.name ?? '', ...(i.components ?? []).map((c) => c.name ?? '')])
      return `${f.name ?? ''}(${flat.join(',')})`
    })
}

describe('seedless launch tripwire', () => {
  it('the default ceremony deploys seedless, so the factory must not let a caller choose the split', () => {
    const offenders = factorySignatures().filter(letsCallerChooseSplit)
    // A caller-supplied split on the deploy/mint surface is exactly the
    // condition launch-first-mint.ts calls "the trap can be set". If this fires,
    // read this file's header before changing anything.
    expect(offenders, `a caller-chosen split appeared on the deploy surface while the seedless bundle ceremony is still reachable: ${offenders.join(' · ')}`).toEqual([])
  })

  // A CANARY THAT HAS NEVER SUNG IS NOT A CANARY. The check above passes today
  // because the condition is genuinely absent, which is indistinguishable from a
  // matcher that can never match. So run the same predicate over the packing
  // shapes we are watching for and require it to catch them.
  it('the same predicate actually catches a packing-factory shape', () => {
    const packingShapes = [
      'deployBasket(salt,name,symbol,basket,startSqrtPriceX96,maxCost,feeConfig,fundingSplit)',
      'deployBasket(salt,name,symbol,basket,amounts,feeConfig)',
      'firstMint(to,perLeg)',
      'mint(to,deposits)',
    ]
    expect(packingShapes.filter(letsCallerChooseSplit)).toEqual(packingShapes)
    // and it must not fire on today's real shapes, or it would be noise
    expect(factorySignatures().filter(letsCallerChooseSplit)).toEqual([])
  })

  it('the atomic first-mint remedy is still armed for the path that uses it', () => {
    // If this ever flips to false the studio path stops batching the first mint
    // too, and then NO path closes the window.
    expect(FIRST_DEPOSIT_REQUIRED).toBe(true)
    // mirrors SpectrumBasket.MIN_FIRST_DEPOSIT; a drift here means the form
    // refuses at a different number than the contract does
    expect(MIN_FIRST_DEPOSIT_USDC).toBe(10)
  })
})
