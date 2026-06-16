// Cash-flow rebalancing: distribute a contribution toward underweighted funds.
// All math is in euros; no NAV/price needed. funds: [{fund_key,target}] target in %.
export function computeAllocation(funds, balances, contribution) {
  const keys = funds.map((f) => f.fund_key);
  const current = keys.map((k) => Math.max(0, balances[k] || 0));
  const tgt = funds.map((f) => (f.target || 0) / 100);
  const totalNow = current.reduce((a, b) => a + b, 0);
  const totalAfter = totalNow + contribution;

  const desired = tgt.map((t) => t * totalAfter);
  const deficit = desired.map((d, i) => Math.max(0, d - current[i]));
  const totalDeficit = deficit.reduce((a, b) => a + b, 0);

  let alloc;
  if (totalDeficit <= 0) {
    alloc = tgt.map((t) => t * contribution);
  } else if (contribution >= totalDeficit) {
    const remainder = contribution - totalDeficit;
    alloc = deficit.map((d, i) => d + tgt[i] * remainder);
  } else {
    alloc = deficit.map((d) => contribution * (d / totalDeficit));
  }

  alloc = alloc.map((a) => Math.round(a * 100) / 100);
  const allocSum = alloc.reduce((a, b) => a + b, 0);
  const drift = Math.round((contribution - allocSum) * 100) / 100;
  if (Math.abs(drift) >= 0.01) {
    let idx = 0, max = -1;
    alloc.forEach((a, i) => { if (a > max) { max = a; idx = i; } });
    alloc[idx] = Math.round((alloc[idx] + drift) * 100) / 100;
  }

  const after = current.map((c, i) => c + alloc[i]);
  const afterPct = after.map((a) => (totalAfter > 0 ? (a / totalAfter) * 100 : 0));

  return { keys, current, alloc, after, afterPct, totalNow, totalAfter };
}
