# Player Accounts, Dashboard, Settings & Branding — Design

Status: Approved by user, 2026-07-20

## 1. Purpose

Three follow-ups agreed during the cloud-hosting migration (see
`docs/superpowers/specs/2026-07-20-cloud-hosting-migration-design.md`, §2, "out of
scope for this spec"), plus a fourth that emerged during brainstorming and expands
the scope of all three: a real brand logo, a homepage/dashboard shown after login,
and a settings page for password/personal-info updates — now built on top of a
genuine **player self-signup and account-linking system**, not just the existing
admin-only login.

Today only admins can log in (Supabase Auth account + a row in `admin_users`).
Players are rows in the `players` table with no login of their own — they're
viewed publicly (leaderboard, profiles, match history, all unauthenticated). This
spec adds public signup for anyone, a way for a signed-up account to link itself to
an existing player (subject to admin approval), and a dashboard/settings
experience that adapts to three states: admin, linked player, and signed-up-but-
unlinked.

## 2. Scope decisions locked in during brainstorming

- **Anyone can self-signup** (email + password, public `/signup` page) — no invite
  required, no admin action needed to create the login itself.
- **A signed-up account can exist forever unlinked to any player** (e.g. a
  spectator/fan account). This is a supported, permanent state, not a transient
  one.
- **Signup never auto-creates a player row and never auto-links by email.** Joining
  the league roster and creating a login account are two independent things.
- **Linking an account to an existing player is a claim-and-approve flow**: the
  account holder picks their name from the player roster in Settings; an admin
  must approve the claim before the account is treated as that player anywhere
  (dashboard, self-service photo). This prevents anyone from claiming to be a
  different real player.
- **`admin_users` and `requireAdmin()` are untouched.** Admin provisioning stays
  exactly as it is today (a row inserted out-of-band); this spec is purely
  additive on top of it. This was a deliberate rejection of folding admin/player
  into one generalized `accounts`-with-role-enum table, specifically because
  `admin_users` is called out in `CLAUDE.md` as the sole load-bearing
  authorization gate for every admin write — reshaping it is a disproportionate
  risk for what this feature needs.
- **Linked players get self-service photo management** (upload/replace/remove
  their own photo from Settings), extending the existing admin-only photo feature
  rather than replacing it — an admin can still override any player's photo from
  the Players page.
- **A linked player's league name (`players.full_name`) stays admin-managed, not
  self-editable.** Settings shows it read-only; renaming a player is still done
  from the admin Players page. The public leaderboard's authoritative name should
  only ever change through the admin path.
- **Claim review happens on the existing `/admin/players` page** (a new "Pending
  claims" section), not a new admin subpage — kept alongside the page that already
  manages the player roster.
- **Login/signup routes move out from under `/admin/`** (`/admin/login` →
  `/login`, etc.) because login is no longer admin-specific. `/admin/*` remains
  exclusively the four admin actions plus the Players page.
- **Dashboard and Settings are each a single page with role-conditional sections**,
  not separate pages/routes per role — the divergence between admin/player/
  unlinked content is a handful of cards, not enough to justify separate URLs or
  page components.
- **Logo**: a standalone icon — two crossed cue strokes over a ball ("Crossed
  Cues"), in the app's existing green→cyan / purple→magenta gradient palette,
  chosen from four concepts reviewed visually during brainstorming (rack triangle,
  banded ball crest, crossed cues, hex shield crest). Delivered as an inline React
  SVG component so it can be recolored/resized via props, not a static image
  asset. Becomes the favicon and replaces the 🎱 emoji in `TopNav` and the login/
  signup pages.
- **Out of scope**: any moderation/reporting tooling beyond the single
  approve/reject action on a claim; email verification requirements beyond
  Supabase Auth's own defaults; a "forgot which player is me" recovery flow if a
  claim is rejected (the account simply stays unlinked and can submit a new claim).

## 3. Architecture

```
                     ┌────────────────────────────────────┐
                     │           auth.users                │
                     │  (Supabase Auth — anyone can sign up)│
                     └───────────────┬──────────────────────┘
                                      │ trigger on insert
                                      ▼
                     ┌────────────────────────────────────┐
                     │           user_profiles              │
                     │  id (=auth.users.id)                 │
                     │  linked_player_id  (nullable)        │
                     └───────────────┬──────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                     │
                    ▼                                     ▼
      ┌───────────────────────┐              ┌───────────────────────┐
      │     player_claims      │  player_id   │        players         │
      │ user_id, player_id,    │─────(FK)─────▶  (existing, public)    │
      │ status, reviewed_by    │              └───────────────────────┘
      └───────────┬─────────────┘
                  │ reviewed by
                  ▼
      ┌─────────────────────────────┐
      │  review-player-claim         │  admin-gated (requireAdmin()),
      │  (5th Edge Function)         │  transactional (dbTransaction.ts),
      └─────────────────────────────┘  same pattern as the 4 existing ones
```

On `approve`, `review-player-claim` writes back up to
`user_profiles.linked_player_id` (not to `players` itself — `players` stays
exactly as it is today, only gaining the new self-service *photo* write path in
§4).

`admin_users` sits entirely outside this diagram — an admin account is still just
an `auth.users` row with a matching `admin_users` row, provisioned exactly as
today. A single account happens to be able to be *both* an admin and a linked
player (both are independent, orthogonal facts about the same `auth.users.id`).

## 4. Data model changes

New migration, append-only per existing convention:

```sql
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  linked_player_id uuid references players(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_set_updated_at before update on user_profiles
  for each row execute function set_updated_at();

-- Auto-provision a profile row for every new signup, admin-provisioned account
-- included (harmless — admins simply get an always-unlinked profile row too).
create function handle_new_user() returns trigger
  language plpgsql security definer as $$
begin
  insert into user_profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table player_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  player_id uuid not null references players(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references admin_users(id),
  reviewed_at timestamptz
);

create index player_claims_player_idx on player_claims (player_id);
create index player_claims_user_idx on player_claims (user_id);

-- RLS
alter table user_profiles enable row level security;
create policy "self read user_profiles" on user_profiles for select using (auth.uid() = id);

alter table player_claims enable row level security;
create policy "self read own claims" on player_claims for select using (auth.uid() = user_id);
create policy "admin read all claims" on player_claims for select
  using (exists (select 1 from admin_users a where a.id = auth.uid()));
create policy "self insert own claim" on player_claims for insert
  with check (auth.uid() = user_id and status = 'pending');

-- Linked player self-service photo (mirrors the existing admin photo policy
-- added in 20260719000000_player_photos.sql)
create policy "linked player update own photo" on players
  for update
  using (exists (select 1 from user_profiles up where up.id = auth.uid() and up.linked_player_id = players.id))
  with check (exists (select 1 from user_profiles up where up.id = auth.uid() and up.linked_player_id = players.id));
  -- column grant on photo_url already exists (authenticated) from the prior migration

-- Admin can edit their own display name (previously read-only)
create policy "self update admin_users" on admin_users
  for update using (auth.uid() = id) with check (auth.uid() = id);
grant update (display_name) on admin_users to authenticated;
```

Storage: a matching pair of `storage.objects` policies for the `player-photos`
bucket, scoped to filenames prefixed with the caller's own `linked_player_id`
(object names are `${player.id}-${timestamp}.${ext}`, so a `like
(up.linked_player_id::text || '-%')` predicate is sufficient), for `insert`,
`update`, and `delete` — mirroring the existing admin storage policies exactly.

**No changes to `admin_users`, `players`' existing columns, `matches`, or any
existing view.** `players.email` (already present, currently unused by any code
path) stays as league-roster contact info; it is deliberately *not* used for
auto-linking (§2).

## 5. New Edge Function: `review-player-claim`

The one genuinely transactional operation, so it follows the same shape as the
four existing admin write functions:

- **Auth**: `requireAdmin()`, same as every other admin write.
- **Input**: `{ claimId: string, decision: 'approve' | 'reject' }`.
- **Transaction** (`dbTransaction.ts`, row locks in ascending id order per
  existing convention):
  1. Lock and re-read the target claim row; if it's no longer `pending`, error
     (someone else already reviewed it — re-check-after-lock per existing
     convention).
  2. On `approve`: set `user_profiles.linked_player_id = claim.player_id` for
     `claim.user_id`; mark this claim `approved`, `reviewed_by`/`reviewed_at` set;
     auto-reject any *other* still-`pending` claims on the same `player_id` (a
     player row can only ever be linked to one account), recording the same
     `reviewed_by`.
  3. On `reject`: mark this claim `rejected`, `reviewed_by`/`reviewed_at` set. No
     other rows touched.
- **Errors surface verbatim**, per existing convention.

## 6. Routing & navigation

- `/admin/login` → **`/login`**, `/admin/forgot-password` → **`/forgot-password`**,
  `/admin/reset-password` → **`/reset-password`**. New **`/signup`** alongside
  `/login`. All four are public, outside any guard.
- New **`AuthRouteGuard`**: requires only a session (no admin check), redirects to
  `/login` if none. Wraps `/dashboard` and `/settings`.
- `AdminRouteGuard` unchanged except its no-session redirect target becomes
  `/login`.
- Login and signup redirect to **`/dashboard`** on success (was
  `/admin/enter-match`).
- **`TopNav`** gains an account menu: logged-out shows "Log in" / "Sign up"
  (replacing "Admin login"); logged-in shows an avatar/name dropdown with
  Dashboard, Settings, Logout, and — only when the account has an `admin_users`
  row — a link into `/admin/*`. `AdminSidebar`'s standalone Logout button is
  removed (now centralized in `TopNav`); `AdminSidebar` keeps only its 5 admin
  action links.

## 7. Dashboard (`/dashboard`)

One `DashboardPage`, role/state resolved via the existing `useIsAdmin` hook plus a
new `useUserProfile(userId)` hook (returns `{ linkedPlayerId, pendingClaim,
isLoading }`), rendering one of three sections:

- **Admin**: active season name/status, a "pending player claims" card (count +
  link to `/admin/players`), quick-link tiles to the 5 admin actions, a recent-
  matches feed (reuses `MatchTable`).
- **Linked player**: current rating, `GradeBadge`, leaderboard rank, season
  points, a rating-history sparkline (reuses `RatingChart`), their own recent
  matches, a link to their full public profile (`/players/:id`).
- **Unlinked account**: short welcome, a "Claim your player profile" CTA into
  Settings (or a "claim pending review" status if one's outstanding), a teaser of
  the top of the public leaderboard.

An account that is both admin and linked player sees the admin section (admin
status takes precedence for the *dashboard's* primary content — nothing stops a
future iteration from showing both, but that's not needed now).

## 8. Settings (`/settings`)

One `SettingsPage`, sections shown based on role/state:

- **Everyone**: change password (`supabase.auth.updateUser({ password })`);
  change account email (`updateUser({ email })`, using Supabase Auth's own
  re-confirmation flow — no custom backend work).
- **Admin**: editable display name (writes to `admin_users.display_name`, using
  the new self-update policy from §4).
- **Linked player**: read-only "Linked to: {player name}" line; a photo
  upload/replace/remove widget. The widget's logic is extracted from the existing
  admin `PlayerPhotoRow` (in `ManagePlayers.tsx`) into a shared component so both
  the admin Players page and this page use the same upload code against the same
  storage bucket.
- **Unlinked account**: a picker over the player roster (reuses the existing
  `usePlayers` hook) to submit one `player_claims` row; while a claim is
  `pending`, shows its status instead of the picker. Once `linked_player_id` is
  set, the picker never reappears (§7/§8's "linked player" branch takes over
  instead). Neither of these is enforced at the RLS/database level — `self insert
  own claim` only requires `status = 'pending'` on the new row, it doesn't check
  whether the user already has a pending claim or is already linked. This is a
  deliberate choice, not a gap: the UI is what a real user interacts with, the
  only actor who can act on any claim is an admin either way, and an
  already-linked or already-pending user submitting an extra row is cosmetic
  clutter for an admin to reject, not a security issue.

## 9. Branding: the "Crossed Cues" icon

- New `web/src/components/Logo.tsx`: an inline SVG React component (two crossed
  cue strokes over a ball, using the app's existing green→cyan gradient for the
  primary stroke and purple→magenta for the crossing stroke, matching the visual
  concept approved during brainstorming), accepting `size` and optional color
  overrides as props.
- Replaces the 🎱 emoji in `TopNav`, and appears on `/login` and `/signup`.
- Becomes the site favicon (replacing Vite's default), generated as a static
  asset from the same mark for `index.html`/`public/`.

## 10. Testing

- **`user_profiles`/`player_claims` migrations**: `src/db` integration tests
  (against the scratch-schema pattern already established post-cloud-migration) —
  the `handle_new_user` trigger actually fires on a real `auth.users` insert; RLS
  policies actually restrict cross-user reads (a second user's session cannot
  read another user's `player_claims` row) and actually allow the admin case; the
  linked-player photo-update policy actually rejects an update from an unlinked or
  wrongly-linked account.
- **`review-player-claim`**: `src/api` integration tests (real HTTP calls against
  the real Edge Function, per existing convention) — reject non-admin callers;
  approve sets `linked_player_id` and auto-rejects sibling pending claims on the
  same player; reject leaves `user_profiles` untouched; re-reviewing an
  already-decided claim errors instead of double-processing.
- **Frontend**: `AuthRouteGuard`, the dashboard's three role branches, the
  settings page's role-conditional sections, and the claim-submission/claim-review
  UI get component tests following this codebase's existing Vitest + Testing
  Library patterns (see e.g. `AdminRouteGuard.test.tsx`, `ManagePlayers` coverage
  patterns). `Logo.tsx` needs no behavioral test beyond a render smoke test.

## 11. Out of scope

Everything listed under "Out of scope" in §2, plus: any change to how admin
accounts are provisioned; any change to the public (unauthenticated) leaderboard/
profile/grades/matches pages; a "remember which players I've claimed before"
history if a claim is rejected and resubmitted; notifications/emails on claim
approval or rejection (the account simply sees the updated status next time it
loads Settings or the Dashboard).
