/**
 * The human layer.
 *
 * Every chain in this demo starts with a named person on a named team. That is not
 * decoration: the one rule the whole system exists to enforce is that an agent can
 * never create authority, only inherit a narrowed slice of someone else's. So the
 * root of every chain has a face and a job title, and every refusal further down can
 * name the person whose grant set the boundary.
 *
 * This file holds the *human* vocabulary only — people, and the plain-language words
 * they use for permissions. The translation into Passport claims lives in `seed.ts`,
 * which imports this. Nothing here imports `seed.ts`, so the dependency runs one way:
 * people → Passports, never the reverse.
 *
 * Zero React imports.
 */

export const TEAM_NAME = 'Business Analytics Team';

export interface TeamMember {
  /** Also the identity a root Passport is issued under, and the key it is signed with. */
  id: string;
  name: string;
  role: string;
  /** Shown in the avatar. Derived once here rather than sliced at render time. */
  initials: string;
}

export const TEAM_MEMBERS: TeamMember[] = [
  { id: 'jordan-lee', name: 'Jordan Lee', role: 'Operations Lead', initials: 'JL' },
  { id: 'priya-nair', name: 'Priya Nair', role: 'Analyst', initials: 'PN' },
  { id: 'marcus-cole', name: 'Marcus Cole', role: 'Analyst', initials: 'MC' },
  { id: 'dana-kim', name: 'Dana Kim', role: 'Data Steward', initials: 'DK' },
];

export const MEMBER_BY_ID: Record<string, TeamMember> = Object.fromEntries(
  TEAM_MEMBERS.map((m) => [m.id, m]),
);

/** Who authorizes by default: the Operations Lead. */
export const DEFAULT_HOLDER_ID = 'jordan-lee';

export function isTeamMember(id: string): boolean {
  return id in MEMBER_BY_ID;
}

/** "Jordan Lee · Business Analytics Team" — person first, for receipts and toasts. */
export function holderLine(id: string): string {
  const member = MEMBER_BY_ID[id];
  return member ? `${member.name} · ${TEAM_NAME}` : id;
}

/** "Business Analytics Team · Jordan Lee" — team first, for the root node and trace. */
export function teamLine(id: string): string {
  const member = MEMBER_BY_ID[id];
  return member ? `${TEAM_NAME} · ${member.name}` : id;
}

// ---------------------------------------------------------------------------
// Plain-language authority
// ---------------------------------------------------------------------------

/**
 * What a person thinks they are granting. These are deliberately not the Passport
 * field names: the form is filled in by an operations lead, not by a verifier.
 *
 * `send-external` is the odd one out, and on purpose. Sending results *somewhere* is
 * part of every one of these tasks, so the `send` action is always on the root grant;
 * what this box controls is whether an external destination is on it at all. Keeping
 * the verb constant and bounding the destination is what lets a refusal three hops
 * down say "you may send, but never there" instead of "you may not send" — which is
 * the distinction the whole demo turns on.
 */
export type Capability = 'read' | 'classify' | 'write' | 'send-external' | 'delegate';

export interface CapabilityOption {
  key: Capability;
  label: string;
  hint: string;
  /** Rendered in red, with the caution line. */
  caution?: string;
  /** This box is the delegation switch, so it reads and writes `canDelegate`. */
  bindsToDelegation?: boolean;
}

export const CAPABILITIES: CapabilityOption[] = [
  { key: 'read', label: 'Read data', hint: 'Look at the records you allow below.' },
  { key: 'classify', label: 'Classify', hint: 'Sort and label what it reads.' },
  { key: 'write', label: 'Write', hint: 'Draft summaries and edit tickets.' },
  {
    key: 'send-external',
    label: 'Send externally',
    hint: 'Off: results stay inside the company.',
    caution: 'On, data may leave the company boundary — and every agent below inherits that.',
  },
  {
    key: 'delegate',
    label: 'Delegate to other agents',
    hint: 'Hand parts of the job to helper agents.',
    bindsToDelegation: true,
  },
];

/** What a person thinks the agent is touching. Maps onto context scopes in `seed.ts`. */
export type DataScope = 'ticket.text' | 'ticket.metadata' | 'ticket.customer.pii';

export interface DataScopeOption {
  key: DataScope;
  label: string;
  hint: string;
  sensitive?: boolean;
}

export const DATA_SCOPES: DataScopeOption[] = [
  { key: 'ticket.text', label: 'Ticket text', hint: 'What the customer wrote.' },
  { key: 'ticket.metadata', label: 'Metadata', hint: 'Dates, queues, tags, status.' },
  {
    key: 'ticket.customer.pii',
    label: 'Customer PII',
    hint: 'Names, emails, account numbers.',
    sensitive: true,
  },
];

export const EXPIRY_CHOICES = [6, 12, 24] as const;
export type ExpiryHours = (typeof EXPIRY_CHOICES)[number];

export const MIN_HOPS = 1;
export const MAX_HOPS = 3;

/**
 * The whole authority form, in the words the person filling it in would use. One of
 * these is everything a human decides; everything below the root is derived from it.
 */
export interface AuthorityForm {
  capabilities: Capability[];
  dataScopes: DataScope[];
  budgetUsd: number;
  expiresInHours: ExpiryHours;
  canDelegate: boolean;
  maxHops: number;
}
