# Chain of Custody

**AI Passport Ideathon · Agents track**

Jordan Lee, Operations Lead on the Business Analytics Team, authorizes one agent to clean up three years of support tickets. That agent delegates, and its delegate delegates again. This demo shows the human's permission travelling down that chain and getting **strictly narrower at every hop** — then shows what happens when the last agent tries to exceed what it inherited: the request **fails a guard** and **falls back** to requiring human authority, and the refusal is written to the append-only audit log, naming the guard and the human who set the boundary. Authority is monotonically non-increasing down the chain, enforced structurally rather than by convention: a broader Passport cannot be signed into existence, and if one were forged, the verifier re-derives the same guards and rejects it.

Every Passport carries a stage in one loop: **draft → active → revoked**. A Passport that fails a guard never leaves `draft`; one that passes every guard to a live human root is `active`; one withdrawn or lapsed is `revoked`. The stage is derived from the chain on every render, never stored.

```bash
npm install
npm run dev      # http://localhost:3000
```

The app has three tabs. **Team Dashboard** is where authority comes from: a named person on a named team fills in a plain-language form — what the agent may do, what data it may touch, what it may spend, when it expires, whether it may hand work on — and signs a root Passport. **Agent Chain** is what the agents inherited from that. **AI Passport** is the credentials themselves, one card per Passport: stamps for the permissions it holds, numbered data-page fields, an authority meter, and an ICAO-style machine-readable strip generated from the real Ed25519 signature. Tap a card to turn it over for the per-hop guards and its chain of custody. The dashboard leads because there is no other door into the system: agents can never create authority, only inherit a narrower slice of a person's.

The scenario is seeded on first paint, with real Ed25519 signatures, so opening **Agent Chain** directly shows a populated chain already attributed to Jordan Lee · Business Analytics Team. There is no database and no login — reload, or press **Reset demo**, to start over.

## Demo script — five clicks, under a minute

1. **On the Team Dashboard, pick who's authorizing and press "Issue Passport & launch chain."** A named person signs the root Passport, the app switches to **Agent Chain**, and the whole chain below is derived from exactly what was ticked. Change something first — untick *Write*, or switch delegation off — and watch it disappear from every agent below, because there was nothing there to inherit.
2. **Read the chain.** Business Analytics Team · Jordan Lee → Agent A → Agent B → Agent C, with a second branch A → D → E. Every card carries a stage pill (`active`) and shows the authority its Passport holds *against what the human granted*: chips the agent gave up stay in place, dimmed and struck through, and the authority bar shortens each hop (100% → 55% → 37%). `external-webhook` is struck through on every card, including the root — the human never granted it, so no descendant could acquire it.
3. **Click "Classify ticket internally."** Allowed. The audit entry traces the authority through 3 Passports back to Jordan Lee, every guard passing.
4. **Click "Send data to external service."** Fails `guard:requested-destination` at hop 3 and falls back to requiring human authority. The refusal entry names the guard, what was requested (`external-webhook`), what the inherited authority permits (`internal-only`), what it fell back to, and who set the boundary (`Jordan Lee · Business Analytics Team`, in the root Passport).
5. **In the delegation sandbox, click "Ask for external transfer," then "Mint child Passport."** The draft stays a draft — no Passport is created, because it fails `guard:destinations`. Agent B cannot grant what it does not hold. Turn the toggle back off and mint again to watch a genuinely narrower child pass every guard, go `active`, and join the graph.
6. **Click "Revoke Agent B's branch."** B and C move to `revoked` immediately; D and E stay `active`. Then try the allowed action again — it now fails `guard:revocation`, citing the revoked ancestor.
7. **Open the AI Passport tab.** The same chain as five credential cards, left to right. The stamps thin out (9 → 6 → 5 → 4), the authority meter drops (100% → 55% → 37%), and the machine-readable strip differs on every card because each was signed by a different holder over narrower claims. Turn a revoked or refused card over to find `REVOKED` or `DENIED` struck across it.

Every decision, allow and refusal alike, lands in the append-only audit log of actions, accesses, and refusals.

## How the chain stays honest

**Signatures link each Passport to its parent.** Each Passport is a JSON claim set signed with Ed25519 (`@noble/ed25519`) by its *issuer*: the root by the human holder, each child by the delegating agent. The signed message includes the **parent's signature**, which hash-links the chain like a certificate chain. You cannot edit a claim, and you cannot re-parent a Passport, without invalidating the signature. Keys are generated in memory and never leave the browser; only public keys reach the verifier.

**Narrowing is a set of guards, not a convention.** `guardViolations()` in [lib/passport.ts](lib/passport.ts) is the single source of truth for "is this child within its parent's authority?" One guard per field, each named on every refusal:

| Guard | Holds |
| --- | --- |
| `guard:actions` | `actions` ⊆ parent's actions |
| `guard:context` | `contextScopes` ⊆ parent's scopes, hierarchically — a child may narrow into `ticket.text.anonymized` under a parent's `ticket.text`, but never reach sideways to `ticket.customer.pii` |
| `guard:destinations` | `allowedDestinations` ⊆ parent's destinations |
| `guard:budget` | `budgetUsd` ≤ parent's budget |
| `guard:expiry` | `expiresAt` ≤ parent's expiry |
| `guard:depth` | each hop consumes one unit of the remaining delegation allowance |
| `guard:holder` | only the agent *holding* a Passport can delegate from it |
| `guard:signature` | Ed25519 over canonical claims + the parent's signature |
| `guard:revocation` | no Passport in the ancestry is withdrawn |
| `guard:requested-action` / `guard:requested-destination` | the request itself, against the leaf Passport |

Those guards run at **both** ends:

- `delegate()` runs them at mint time, so an over-broad child is never created — the draft stays a draft, and the failed guards come back itemised.
- `verifyChain()` runs them again at verify time, so the verifier never takes the minter's word for anything. A hand-forged Passport with a *valid* signature and inflated claims still fails, at the hop where it exceeds its parent.

**Revocation cascades for free.** `revoke()` flags one Passport. Nothing walks down the tree. Because `verifyChain()` walks *up* to the root, every descendant of a revoked Passport moves to `revoked` the instant the flag is set, and sibling branches are untouched. Revocation is verifier-side state asserted after issuance, so it deliberately sits outside the issuer's signature — withdrawing a Passport retires it rather than forging it.

**Refusals are audit entries.** `authorizeAction()` returns an `AllowReceipt` or a `RefusalReceipt`, never an exception. A refusal carries the attempting agent, the authority it inherited, what it requested, the guard it failed, the hop number, what it fell back to (always human authority — nothing below the root can widen a chain), and the human at the root who set the boundary.

## Layout

| Path | What it is |
| --- | --- |
| [lib/passport.ts](lib/passport.ts) | The SDK: `issueRoot`, `delegate`, `verifyChain`, `authorizeAction`, `revoke`, and `guardViolations`. Zero React imports. |
| [lib/authority.ts](lib/authority.ts) | Presentation-side derivations: `lifecycleOf` (draft → active → revoked), the authority meter, time formatting. |
| [lib/crypto.ts](lib/crypto.ts) | Ed25519 signing, canonical JSON, hash-linking to the parent signature. |
| [lib/seed.ts](lib/seed.ts) | The canonical scenario, minted with real signatures so the judge lands on a populated chain. |
| [lib/passport.test.ts](lib/passport.test.ts) | 23 unit tests over the guards, verification, revocation, the lifecycle, and audit entries. |
| [app/api/verify/route.ts](app/api/verify/route.ts) | The verifier as a separate service. Holds no secrets; re-derives every guard. |
| [components/](components/) | Chain graph, Passport drawer, action console, delegation sandbox, revocation, audit log. |

```bash
npm test          # 23 unit tests, including the four demo guarantees
npm run build     # production build
```

The action console posts to `/api/verify` so the "verifier is a separate service" story is literal: the browser sends the public registry and a requested action, and the route walks the chain itself. The audit entry shows which verifier decided it. If the request fails, the client falls back to deciding in-process so the demo never dead-ends.

## Deploy

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

No environment variables, no database, no external services. Pushing the repo to GitHub and importing it at [vercel.com/new](https://vercel.com/new) works with zero configuration.

## Judging alignment

The **How it works** panel at the bottom of the page names each item the Agents track asks for: the holder (Jordan Lee, a named person on a named team), the agents (A–E), the verifier (`/api/verify`), the guards, the lifecycle (draft → active → revoked), the permission scope (chips on every node), expiry (a live countdown on every Passport) and revocation rules, the audit log, and what happens outside scope (the blocked external send).

> This is for an operations lead, who needs to prove to every downstream service that an agent's authority came from them and never grew — so work gets delegated safely without giving away more context than necessary.
