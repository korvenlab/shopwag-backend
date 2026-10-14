import assert from "node:assert/strict";
import { test } from "node:test";
import { chargeBreakdown, serviceFeeCents } from "./fees";

test("taxa de serviço de 2%, arredondada", () => {
  assert.equal(serviceFeeCents(10000), 200);
  assert.equal(serviceFeeCents(12345), 247);
});

test("taxa de serviço mínima de 1 centavo", () => {
  assert.equal(serviceFeeCents(20), 1);
  assert.equal(serviceFeeCents(0), 0);
});

test("sem repasse do cartão o cliente paga só a taxa de serviço", () => {
  assert.deepEqual(chargeBreakdown(10000, null), { service: 200, cardFee: 0, total: 10200 });
});

test("com repasse a loja fica com o valor do catálogo depois do cartão e da taxa de serviço", () => {
  for (const base of [990, 10000, 15990, 123456]) {
    for (const percent of [3.99, 4.98]) {
      const { service, total } = chargeBreakdown(base, percent);
      const mpFee = Math.round((total * percent) / 100);
      const store = total - mpFee - service;
      assert.ok(store >= base, `base ${base} total ${total}`);
      assert.ok(store - base <= 2, `sobra demais em ${base}`);
    }
  }
});

test("R$ 100,00 no crédito com repasse", () => {
  assert.deepEqual(chargeBreakdown(10000, 4.98), { service: 200, cardFee: 535, total: 10735 });
});
