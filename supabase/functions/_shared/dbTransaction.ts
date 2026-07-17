// supabase/functions/_shared/dbTransaction.ts
import postgres from 'npm:postgres@3';

export type TransactionSql = Parameters<Parameters<ReturnType<typeof postgres>['begin']>[0]>[0];

export async function withTransaction<T>(
  fn: (sql: TransactionSql) => Promise<T>,
): Promise<T> {
  const dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!dbUrl) {
    throw new Error(
      'SUPABASE_DB_URL is not set. This is required for transactional writes — see ' +
        'supabase/functions/README.md, "Direct Postgres access (transactions)".',
    );
  }
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin((tx) => fn(tx));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
