# Chain of Custody

**AI Passport Ideathon · Agents track**

An Ops Lead authorizes one agent to clean up three years of support tickets. That agent delegates, and its delegate delegates again. This demo shows the human's permission travelling down that chain and getting **strictly narrower at every hop** — then shows what happens when the last agent tries to exceed what it inherited: the action is blocked and a **refusal receipt** is produced, naming the constraint and the human who set it. Authority is monotonically non-increasing down the chain, enforced structurally rather than by convention: a broader Passport cannot be signed into existence, and if one were forged, the verifier re-derives the same check and rejects it.

```bash
npm install
npm run dev      # http://localhost:3000
```

The scenario is seeded on first paint, with real Ed25519 signatures. There is no database and no login — reload, or press **Reset demo**, to start over.

## Demo script — four clicks, under a minute

1. **Read the chain.** Ops Lead → Agent A → Agent B → Agent C, with a second branch A → D → E. Every card shows the authority its Passport carries *against what the human granted*: chips the agent gave up stay in place, dimmed and struck through, and the authority bar shortens each hop (100% → 55% → 37%). `external-webhook` is struck through on every card, including the root — the human never granted it, so no descendant could acquire it.
2. **Click "Classify ticket internally."** Allowed. A green receipt traces the authority through 3 Passports back to the Ops Lead.
3. **Click "Send data to external service."** Blocked at the destination check, hop 3. The refusal receipt names the violated field (`allowedDestinations`), what was requested (`external-webhook`), what the inherited authority permits (`internal-only`), and who set the boundary (the Ops Lead, in the root Passport).
4. **In the delegation sandbox, click "Ask for external transfer," then "Mint child Passport."** Rejected — no Passport is created. Agent B cannot grant what it does not hold. Turn the toggle back off and mint again to watch a genuinely narrower child succeed and join the graph.
5. **Click "Revoke Agent B's branch."** B and C go dark immediately; D and E keep working. Then try the allowed action again — it now refuses, citing the revoked ancestor.

Every decision, allow and refusal alike, lands in the append-only receipts log.

## How the chain stays honest

**Signatures link each Passport to its parent.** Each Passport is a JSON claim set signed with Ed25519 (`@noble/ed25519`) by its *issuer*: the root by the human holder, each child by the delegating agent. The signed message includes the **parent's signature**, which hash-links the chain like a certificate chain. You cannot edit a claim, and you cannot re-parent a Passport, without invalidating the signature. Keys are generated in memory and never leave the browser; only public keys reach the verifier.

**Narrowing is structural, not advisory.** `narrowingViolations()` in [lib/passport.ts](lib/passport.ts) is the single source of truth for "is this child within its parent's authority?" — a field-by-field subset check over `actions`, `contextScopes` (hierarchical: a child may narrow into `ticket.text.anonymized` under a parent's `ticket.text`, but never reach sideways to `ticket.customer.pii`), `allowedDestinations`, `budgetUsd`, `expiresAt`, and the remaining delegation depth. It also enforces that only the agent *holding* a Passport can delegate from it.

That function is called from **both** ends:

- `delegate()` calls it at mint time, so an over-broad child is never created — it returns itemised `violations` instead.
- `verifyChain()` calls it again at verify time, so the verifier never takes the minter's word for anything. A hand-forged Passport with a *valid* signature and inflated claims still fails, at the hop where it exceeds its parent.

**Revocation cascades for free.** `revoke()` flags one Passport. Nothing walks down the tree. Because `verifyChain()` walks *up* to the root, every descendant of a revoked Passport stops verifying the instant the flag is set, and sibling branches are untouched. Revocation is verifier-side state asserted after issuance, so it deliberately sits outside the issuer's signature — withdrawing a Passport retires it rather than forging it.

**Refusals are receipts.** `authorizeAction()` returns an `AllowReceipt` or a `RefusalReceipt`, never an exception. A refusal carries the attempting agent, the authority it inherited, what it requested, the exact field and check that blocked it, the hop number, and the human at the root who set the boundary.

## Layout

| Path | What it is |
| --- | --- |
| [lib/passport.ts](lib/passport.ts) | The SDK: `issueRoot`, `delegate`, `verifyChain`, `authorizeAction`, `revoke`, and the narrowing invariant. Zero React imports. |
| [lib/crypto.ts](lib/crypto.ts) | Ed25519 signing, canonical JSON, hash-linking to the parent signature. |
| [lib/seed.ts](lib/seed.ts) | The canonical scenario, minted with real signatures so the judge lands on a populated chain. |
| [lib/passport.test.ts](lib/passport.test.ts) | 21 unit tests over the invariant, verification, revocation, and receipts. |
| [app/api/verify/route.ts](app/api/verify/route.ts) | The verifier as a separate service. Holds no secrets; re-derives every check. |
| [components/](components/) | Chain graph, Passport drawer, action console, delegation sandbox, revocation, receipts log. |

```bash
npm test          # 21 unit tests, including the four demo guarantees
npm run build     # production build
```

The action console posts to `/api/verify` so the "verifier is a separate service" story is literal: the browser sends the public registry and a requested action, and the route walks the chain itself. The receipt shows which verifier decided it. If the request fails, the client falls back to deciding in-process so the demo never dead-ends.

## Deploy

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

No environment variables, no database, no external services. Pushing the repo to GitHub and importing it at [vercel.com/new](https://vercel.com/new) works with zero configuration.

## Judging alignment

The **How it works** panel at the bottom of the page names each item the Agents track asks for: the holder (Ops Lead, human), the agents (A–E), the verifier (`/api/verify`), the permission scope (chips on every node), expiry (a live countdown on every Passport) and revocation rules, the action receipts, and what happens outside scope (the blocked external send).

> This is for an operations lead, who needs to prove to every downstream service that an agent's authority came from them and never grew — so work gets delegated safely without giving away more context than necessary.
