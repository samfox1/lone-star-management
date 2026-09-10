'use client'

/**
 * Connecting a Shopify store, and PROVING it worked (MERCH_PLAN step 7).
 *
 * WHAT IT REPLACED. Two bare inputs and a Connect button. Pasting a token told you
 * nothing: the panel said "Connected to x.myshopify.com" whether the token was right,
 * wrong, revoked, or missing the one scope that lets it read products. The only way to
 * find out was to press Pull merch and see whether anything arrived — and when nothing
 * did, all four causes looked identical.
 *
 * SO THE PROOF IS THEIR OWN MERCH. Test connection reads one page from the store and
 * shows it back: their Tour Tee, beside the domain it came from. Products alone prove
 * some store answered; products plus the domain prove it was the store they typed.
 *
 * THE IMAGES SIT ON NEAR-BLACK on purpose. The real merch page renders products cut out
 * on a dark ground, which only works with an alpha channel. A flat JPG uploaded by the
 * artist's team comes back with a white box baked in — `preferredContentType: PNG` cannot
 * invent transparency — and here that box is plainly visible. Seeing it beats any check
 * we could write, and detecting alpha would mean decoding every image server-side.
 *
 * NO INSTRUCTION COPY (Sam's standing rule, 2026-08-12, extended 2026-08-28). The default
 * panel carries no explanatory prose at all. The Shopify admin steps sit behind a
 * disclosure, and the fix text appears only once a test has actually FAILED — that is an
 * error message, not a caption. The rule says to redesign a control that needs explaining;
 * these steps happen on Shopify's screens, which no design of ours can make self-evident,
 * so the answer is to keep them out of sight until someone is looking for them.
 */
import { useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SaveForm } from '../save-form'
import { ActionButton } from '../action-button'
import { probeAdvice, previewFlags, type ShopifyProbe } from '@/lib/merch/probe'

type ConnectAction = (formData: FormData) => Promise<{ error?: string }>
type PullAction = () => Promise<{ ok: boolean; error?: string }>
type DisconnectAction = () => Promise<{ error?: string }>
type ProbeAction = () => Promise<ShopifyProbe & { storeDomain?: string }>

/** Where the token is made. Linked rather than described — a live path beats a sentence
 *  about a path, and Shopify moves its admin around more often than we redeploy. */
const ADMIN_STEPS = [
  'Shopify Admin → Settings → Apps and sales channels → Develop apps',
  'Create an app (or open yours) → Configuration → Storefront API',
  'Tick unauthenticated_read_product_listings, save, then Install app',
  'API credentials → copy the Storefront API access token',
]

function Steps() {
  return (
    <ol className="mt-3 space-y-1.5 font-space text-xs text-ink-muted">
      {ADMIN_STEPS.map((s, i) => (
        <li key={s} className="flex gap-2">
          <span className="text-ink-faint">{i + 1}.</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * One product, as evidence. Title, price, and the picture — nothing else, because this is
 * a "do you recognise this?" question, not a catalogue.
 *
 * `data-cutout-ground` marks the dark tile so the test can prove the image really is being
 * shown the way the site shows it; a class name alone would be a styling detail nobody
 * could assert on without pinning the palette. `data-probe-result` on the result block is
 * there for the same reason: the panel says "Connected to …" in two places — the standing
 * state, and the outcome of this test — and an unscoped query would pass on either.
 */
function ProductTile({ title, imageUrl, price, buyable }: {
  title: string; imageUrl: string | null; price: string | null; buyable: boolean
}) {
  return (
    <li className="w-[104px] shrink-0">
      <div data-cutout-ground className="flex h-[104px] w-[104px] items-center justify-center rounded-lg bg-[#0a0a0a] p-2">
        {imageUrl ? (
          // A plain <img>, the same call every other Shopify/remote thumbnail here makes:
          // next/image would need a remotePatterns entry per store CDN, and this is a
          // 104px preview tile that is on screen for one press of a button.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="font-space text-[10px] text-ink-faint">no image</span>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs font-medium text-ink" title={title}>{title}</p>
      {price && <p className="font-space text-[11px] text-ink-muted">{price}</p>}
      {/* A product with no variants renders on the site and then refuses to sell: a cart
          line is built from a variant id, so there is nothing to add. Silent until the
          moment a fan tries to buy, which is the worst possible moment to find out. */}
      {!buyable && <p className="font-space text-[11px] text-accent-red">can’t be bought</p>}
    </li>
  )
}

function ProbeResult({ result }: { result: ShopifyProbe & { storeDomain?: string } }) {
  if (!result.ok) {
    const advice = probeAdvice(result.reason)
    return (
      <div data-probe-result className="mt-3 rounded-lg border border-accent-red/30 bg-danger-soft/40 p-3">
        <p className="text-sm font-bold text-ink">{advice.title}</p>
        <p className="mt-1 font-space text-xs text-ink-muted">{advice.fix}</p>
        {/* Kept verbatim. An unclassified failure with its own text on screen is still
            actionable; a tidy summary throws away the only clue there was. */}
        <p className="mt-1.5 font-space text-[11px] text-ink-faint">{result.detail}</p>
      </div>
    )
  }

  if (result.products.length === 0) {
    return (
      <div data-probe-result className="mt-3 rounded-lg border border-hairline bg-surface p-3">
        <p className="text-sm font-bold text-ink">
          Connected{result.storeDomain ? ` to ${result.storeDomain}` : ''} — no products came back
        </p>
        {/* BOTH causes, deliberately. Shopify answers 200 with [] for each of them and
            gives us nothing to tell them apart, so naming one would be confidently wrong
            half the time. The sales-channel case is the likely one. */}
        <p className="mt-1 font-space text-xs text-ink-muted">
          Either the store has no products yet, or its products are not published to the
          sales channel this token belongs to. In Shopify, open a product → Publishing, and
          add the app you made the token in.
        </p>
      </div>
    )
  }

  return (
    <div data-probe-result className="mt-3">
      <p className="font-space text-xs text-ink-muted">
        Connected{result.storeDomain ? ` to ${result.storeDomain}` : ''} — {result.products.length}{' '}
        {result.products.length === 1 ? 'product' : 'products'} read back
      </p>
      <ul className="mt-2 flex gap-3 overflow-x-auto pb-1">
        {result.products.map((p) => (
          <ProductTile
            key={p.shopify_product_id}
            title={p.title}
            imageUrl={p.image_url}
            price={p.price}
            buyable={previewFlags(p).buyable}
          />
        ))}
      </ul>
    </div>
  )
}

export function ShopifyPanel({
  storeDomain,
  connectAction,
  pullAction,
  disconnectAction,
  probeAction,
}: {
  storeDomain: string | null
  connectAction: ConnectAction
  pullAction: PullAction
  disconnectAction: DisconnectAction
  probeAction: ProbeAction
}) {
  const [result, setResult] = useState<(ShopifyProbe & { storeDomain?: string }) | null>(null)
  const [testing, setTesting] = useState(false)
  const [showSteps, setShowSteps] = useState(false)

  async function runTest() {
    // No busyRef latch on purpose. AGENTS.md rule 5 wants one where a double fire does
    // damage; here the button is DISABLED while testing, and a repeat press that slipped
    // through would only run the probe again — it writes nothing.
    setTesting(true)
    try {
      setResult(await probeAction())
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-hairline bg-paper p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">Shopify</h2>
        {storeDomain && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={runTest} disabled={testing} className={buttonClass('ghost')}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <ActionButton
              action={pullAction}
              savedMessage="Merch pulled"
              busyLabel="Pulling…"
              className={buttonClass('ghost')}
            >
              Pull merch
            </ActionButton>
            <ActionButton
              action={disconnectAction}
              savedMessage="Shopify disconnected"
              confirm="Disconnect this Shopify store? Your synced merch stays, but you'll need to reconnect to pull again."
              className="rounded-md px-2 py-1.5 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
            >
              Disconnect
            </ActionButton>
          </div>
        )}
      </div>

      {storeDomain ? (
        <p className="mt-3 font-space text-sm text-ink-muted">
          Connected to <span className="font-bold text-ink">{storeDomain}</span>
        </p>
      ) : (
        <>
          <SaveForm
            action={connectAction}
            savedMessage="Shopify connected"
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <input name="store_domain" placeholder="store.myshopify.com" className={`flex-1 ${inputClass}`} />
            <input
              name="storefront_token"
              type="password"
              placeholder="Storefront access token"
              className={`flex-1 ${inputClass}`}
            />
            <button type="submit" className={buttonClass('solid')}>
              Connect
            </button>
          </SaveForm>
          {/* One click away, not on screen. The person who needs this is standing in
              Shopify's admin unable to find the thing; everyone else never sees it. */}
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="mt-2 font-space text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Where do I find these?
          </button>
          {showSteps && <Steps />}
        </>
      )}

      {result && <ProbeResult result={result} />}
    </section>
  )
}
