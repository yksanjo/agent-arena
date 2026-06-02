// Claim types. THE feasibility unlock (see docs/DESIGN.md premise 1): every
// claim must resolve from data with zero human judgment. No free text, no
// "will the Fed cut rates". If an oracle or a price endpoint can't settle it
// automatically, it does not belong in the arena.
//
// A claim is opened at openTs with a snapshot of whatever it needs to resolve,
// then resolved at resolveTs by comparing against fresh data. resolve() returns
// 0 or 1 (the YES outcome) given the closing observation.

// "Will <token> be up 24h from now?" Resolves YES if close > open.
export function tokenUp24h({ token, openTs, openPrice }) {
  const DAY = 24 * 60 * 60 * 1000;
  return {
    id: `up24h:${token}:${openTs}`,
    type: "token_up_24h",
    token,
    openTs,
    resolveTs: openTs + DAY,
    openPrice,
    question: `Will ${token} be higher 24h from open?`,
    // closePrice -> outcome
    resolve(closePrice) {
      assertPrice(closePrice);
      return closePrice > openPrice ? 1 : 0;
    },
  };
}

// "Will <tokenA> outperform <tokenB> over 24h?" The literal duel as a claim:
// a clean binary that doesn't depend on overall market direction, so it
// separates stock-pickers from beta-riders.
export function outperform24h({ tokenA, tokenB, openTs, openA, openB }) {
  const DAY = 24 * 60 * 60 * 1000;
  return {
    id: `vs24h:${tokenA}-${tokenB}:${openTs}`,
    type: "outperform_24h",
    tokenA,
    tokenB,
    openTs,
    resolveTs: openTs + DAY,
    openA,
    openB,
    question: `Will ${tokenA} outperform ${tokenB} over 24h?`,
    // { closeA, closeB } -> outcome
    resolve({ closeA, closeB }) {
      assertPrice(closeA);
      assertPrice(closeB);
      const retA = (closeA - openA) / openA;
      const retB = (closeB - openB) / openB;
      return retA > retB ? 1 : 0;
    },
  };
}

function assertPrice(x) {
  if (!Number.isFinite(x) || x <= 0) throw new Error(`price must be > 0, got ${x}`);
}
