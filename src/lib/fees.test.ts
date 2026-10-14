import assert from "node:assert/strict";
import { test } from "node:test";
import { computeApplicationFeeCents, totalWithFeesCents } from "./fees";

test("1% do total, arredondado", () => {
  assert.equal(computeApplicationFeeCents(10000), 100);
  assert.equal(computeApplicationFeeCents(12345), 123);
});

test("mínimo de 1 centavo e nunca o total inteiro", () => {
  assert.equal(computeApplicationFeeCents(20), 1);
  assert.equal(computeApplicationFeeCents(1), 0);
  assert.equal(computeApplicationFeeCents(0), 0);
});

test("repasse: a loja fica com o valor do catálogo depois das duas taxas", () => {
  for (const base of [990, 10000, 15990, 123456]) {
    const total = totalWithFeesCents(base, 0.99);
    const mpFee = Math.round((total * 0.99) / 100);
    const platformFee = computeApplicationFeeCents(total);
    assert.ok(total - mpFee - platformFee >= base, `base ${base} total ${total}`);
    assert.ok(total - mpFee - platformFee - base <= 2, `sobra demais em ${base}`);
  }
});

test("repasse com R$ 100,00 e Pix 0,99%", () => {
  assert.equal(totalWithFeesCents(10000, 0.99), 10204);
});
