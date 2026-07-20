// supabase/functions/review-player-claim/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { withTransaction } from '../_shared/dbTransaction.ts';
import { HttpError } from '../_shared/httpError.ts';
import { isUuid } from '../_shared/validation.ts';

interface ReviewPlayerClaimBody {
  claim_id: string;
  decision: 'approve' | 'reject';
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: ReviewPlayerClaimBody;
  try {
    body = (await req.json()) as ReviewPlayerClaimBody;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }

  if (!isUuid(body.claim_id)) {
    return jsonResponse({ error: 'claim_id must be a valid UUID' }, 400);
  }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return jsonResponse({ error: "decision must be 'approve' or 'reject'" }, 400);
  }

  try {
    await withTransaction(async (sql) => {
      // Lock the *entire* sibling set for this claim's player -- every
      // player_claims row sharing its player_id, in ascending id order --
      // before touching anything else, not just the target row. The sibling
      // sweep below mutates other pending claims on the same player_id, so
      // if we only locked the target row, two admins concurrently approving
      // two different pending claims on the same contested player would each
      // hold their own target row's lock while trying to update the other's
      // row in the sweep -- a genuine deadlock. Locking the whole set up
      // front, in a fixed order, means whichever transaction gets there
      // first acquires every row it could touch (including the other's
      // target) before the loser can acquire anything; the loser just blocks
      // on this first statement (a normal wait, not a deadlock) until the
      // winner commits, then proceeds against fresh data.
      const siblings = await sql`
        select id, user_id, player_id, status
        from player_claims
        where player_id = (select player_id from player_claims where id = ${body.claim_id})
        order by id
        for update
      `;
      const claim = siblings.find((c) => c.id === body.claim_id);
      if (!claim) throw new HttpError(404, 'Claim not found');
      if (claim.status !== 'pending') {
        throw new HttpError(400, 'This claim has already been reviewed');
      }

      const newStatus = body.decision === 'approve' ? 'approved' : 'rejected';
      await sql`
        update player_claims set status = ${newStatus}, reviewed_by = ${admin.id}, reviewed_at = now()
        where id = ${body.claim_id}
      `;

      if (body.decision === 'approve') {
        await sql`
          update user_profiles set linked_player_id = ${claim.player_id}
          where id = ${claim.user_id}
        `;

        // A player row can only ever be linked to one account -- auto-reject
        // any other still-pending claim on this same player so the admin
        // never has to clean those up by hand.
        await sql`
          update player_claims set status = 'rejected', reviewed_by = ${admin.id}, reviewed_at = now()
          where player_id = ${claim.player_id} and status = 'pending' and id <> ${body.claim_id}
        `;
      }
    });

    return jsonResponse(
      { claim_id: body.claim_id, status: body.decision === 'approve' ? 'approved' : 'rejected' },
      200,
    );
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
