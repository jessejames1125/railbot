// A fix loop with a hard cap. The author tries, someone else checks, the author fixes what
// was found. After maxRetries fixes with findings still open, it stops and hands the work
// to a person instead of trying forever.

/**
 * @param {{
 *   attempt: (findings: any[], round: number) => Promise<void>,
 *   check: (round: number) => Promise<{ findings: any[] }>,
 *   maxRetries?: number,
 *   blocking?: (finding: any) => boolean,
 * }} o
 * @returns {Promise<{ status: 'clean'|'escalate', rounds: number, retries: number, findings: any[], history: any[] }>}
 */
export async function fixLoop({ attempt, check, maxRetries = 2, blocking = () => true }) {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw new Error('maxRetries must be a whole number from 0 to 10');
  const history = [];
  await attempt([], 0);
  for (let round = 0; ; round++) {
    const { findings } = await check(round);
    const open = (findings ?? []).filter(blocking);
    history.push({ round, findings: findings ?? [], open: open.length });
    if (!open.length) return { status: 'clean', rounds: round + 1, retries: round, findings: findings ?? [], history };
    if (round >= maxRetries) return { status: 'escalate', rounds: round + 1, retries: round, findings: open, history };
    await attempt(open, round + 1);
  }
}
