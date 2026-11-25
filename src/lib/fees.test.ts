import { config } from "../config";
import { applicationFeeForStore, asReceivePlan, chargeBreakdown, serviceFeeCents } from "./fees";

describe("serviceFeeCents", () => {
  it("cobra 2% arredondado", () => {
    expect(serviceFeeCents(10000)).toBe(200);
    expect(serviceFeeCents(12345)).toBe(247);
  });

  it("tem mínimo de 1 centavo e zera base vazia ou negativa", () => {
    expect(serviceFeeCents(20)).toBe(1);
    expect(serviceFeeCents(0)).toBe(0);
    expect(serviceFeeCents(-50)).toBe(0);
  });

  it("arredonda a base fracionária antes de aplicar o percentual", () => {
    expect(serviceFeeCents(10.6)).toBe(1);
  });
});

describe("chargeBreakdown", () => {
  it("sem repasse o cliente paga só a taxa de serviço", () => {
    expect(chargeBreakdown(10000, null)).toEqual({ service: 200, paymentFee: 0, total: 10200 });
  });

  it("com repasse a loja fica com o valor do catálogo depois do Mercado Pago e da taxa de serviço", () => {
    for (const base of [990, 10000, 15990, 123456]) {
      for (const percent of [0.99, 3.99, 4.98]) {
        const { service, total } = chargeBreakdown(base, percent);
        const mpFee = Math.round((total * percent) / 100);
        const store = total - mpFee - service;
        expect(store).toBeGreaterThanOrEqual(base);
        expect(store - base).toBeLessThanOrEqual(2);
      }
    }
  });

  it("R$ 100,00 no crédito com repasse", () => {
    expect(chargeBreakdown(10000, 4.98)).toEqual({ service: 200, paymentFee: 535, total: 10735 });
  });

  it("R$ 100,00 no Pix com repasse", () => {
    expect(chargeBreakdown(10000, 0.99)).toEqual({ service: 200, paymentFee: 102, total: 10302 });
  });

  it("base zero não gera taxa mesmo com percentual de repasse", () => {
    expect(chargeBreakdown(0, 0.99)).toEqual({ service: 0, paymentFee: 0, total: 0 });
  });

  it("recusa taxa de pagamento que zera o denominador", () => {
    expect(() => chargeBreakdown(10000, 100)).toThrow("Taxa de pagamento inválida para repasse.");
    expect(() => chargeBreakdown(10000, 150)).toThrow("Taxa de pagamento inválida para repasse.");
  });
});

describe("asReceivePlan", () => {
  it("aceita os prazos conhecidos", () => {
    expect(asReceivePlan("na_hora")).toBe("na_hora");
    expect(asReceivePlan("14_dias")).toBe("14_dias");
    expect(asReceivePlan("30_dias")).toBe("30_dias");
  });

  it("rejeita valor fora da lista", () => {
    expect(asReceivePlan("7_dias")).toBeNull();
    expect(asReceivePlan(14)).toBeNull();
    expect(asReceivePlan(undefined)).toBeNull();
  });
});

describe("applicationFeeForStore", () => {
  const originalPlatform = config.mp.platformUserId;
  const originalToken = config.mp.accessToken;

  afterEach(() => {
    config.mp.platformUserId = originalPlatform;
    config.mp.accessToken = originalToken;
  });

  it("zera a marketplace fee quando a loja é a conta da aplicação", () => {
    config.mp.platformUserId = "123456";
    config.mp.accessToken = "";
    expect(applicationFeeForStore("123456", 200)).toBe(0);
  });

  it("mantém a taxa para outra loja", () => {
    config.mp.platformUserId = "123456";
    config.mp.accessToken = "APP_USR-example-123456";
    expect(applicationFeeForStore("999", 200)).toBe(200);
  });

  it("usa o sufixo numérico do access token quando não há platform user id", () => {
    config.mp.platformUserId = "";
    config.mp.accessToken = "APP_USR-example-424242";
    expect(applicationFeeForStore("424242", 150)).toBe(0);
    expect(applicationFeeForStore("1", 150)).toBe(150);
  });

  it("devolve a taxa quando não há conta da aplicação para comparar", () => {
    config.mp.platformUserId = "";
    config.mp.accessToken = "";
    expect(applicationFeeForStore("999", 80)).toBe(80);
  });
});
