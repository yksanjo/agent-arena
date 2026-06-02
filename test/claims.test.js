import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenUp24h, outperform24h } from "../src/claims.js";

test("token_up_24h resolves YES only when price rose", () => {
  const c = tokenUp24h({ token: "BONK", openTs: 1000, openPrice: 0.00002 });
  assert.equal(c.resolveTs, 1000 + 24 * 3600 * 1000);
  assert.equal(c.resolve(0.000021), 1); // up
  assert.equal(c.resolve(0.000019), 0); // down
  assert.equal(c.resolve(0.00002), 0); // flat is not "up"
});

test("token_up_24h rejects garbage closing prices", () => {
  const c = tokenUp24h({ token: "X", openTs: 0, openPrice: 1 });
  assert.throws(() => c.resolve(0));
  assert.throws(() => c.resolve(-5));
  assert.throws(() => c.resolve(NaN));
});

test("outperform_24h compares returns, not raw prices", () => {
  // A goes 100->110 (+10%), B goes 1->1.05 (+5%). A outperforms despite lower price.
  const c = outperform24h({ tokenA: "A", tokenB: "B", openTs: 0, openA: 100, openB: 1 });
  assert.equal(c.resolve({ closeA: 110, closeB: 1.05 }), 1);
  // Now B wins: A +1%, B +20%.
  assert.equal(c.resolve({ closeA: 101, closeB: 1.2 }), 0);
});

test("claim ids are unique per token+time", () => {
  const a = tokenUp24h({ token: "SOL", openTs: 1, openPrice: 100 });
  const b = tokenUp24h({ token: "SOL", openTs: 2, openPrice: 100 });
  const c = tokenUp24h({ token: "BTC", openTs: 1, openPrice: 100 });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
});
