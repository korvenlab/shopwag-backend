import { createHmac } from "crypto";
import { config } from "../config";
import { mpWebhookSignatureValid } from "./mercadopago";

const SECRET = "segredo-de-teste";

function headerFor(manifest: string, secret = SECRET) {
  const ts = manifest.match(/ts:([^;]+);$/)?.[1];
  if (!ts) throw new Error(`manifesto sem ts: ${manifest}`);
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("mpWebhookSignatureValid", () => {
  const originalSecret = config.mp.webhookSecret;

  beforeEach(() => {
    config.mp.webhookSecret = SECRET;
  });

  afterAll(() => {
    config.mp.webhookSecret = originalSecret;
  });

  it("aceita o manifesto com request-id", () => {
    const manifest = "id:12345;request-id:req-1;ts:1700000000;";
    expect(
      mpWebhookSignatureValid({
        signature: headerFor(manifest),
        requestId: "req-1",
        dataId: "12345",
      }),
    ).toBe(true);
  });

  it("aceita o manifesto sem request-id e com espaços no cabeçalho", () => {
    const manifest = "id:99;ts:1700000001;";
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    expect(
      mpWebhookSignatureValid({
        signature: `ts=1700000001, v1=${v1}`,
        requestId: undefined,
        dataId: "99",
      }),
    ).toBe(true);
  });

  it("compara o data id alfanumérico em minúsculas", () => {
    const manifest = "id:abc12;request-id:r;ts:1700000002;";
    expect(
      mpWebhookSignatureValid({
        signature: headerFor(manifest),
        requestId: "r",
        dataId: "AbC12",
      }),
    ).toBe(true);
  });

  it("não altera data id que não é só alfanumérico", () => {
    const manifest = "id:ABC-1;ts:1700000003;";
    expect(
      mpWebhookSignatureValid({
        signature: headerFor(manifest),
        requestId: undefined,
        dataId: "ABC-1",
      }),
    ).toBe(true);
    expect(
      mpWebhookSignatureValid({
        signature: headerFor("id:abc-1;ts:1700000003;"),
        requestId: undefined,
        dataId: "ABC-1",
      }),
    ).toBe(false);
  });

  it("rejeita assinatura de outro segredo", () => {
    const manifest = "id:12345;request-id:req-1;ts:1700000000;";
    expect(
      mpWebhookSignatureValid({
        signature: headerFor(manifest, "outro-segredo"),
        requestId: "req-1",
        dataId: "12345",
      }),
    ).toBe(false);
  });

  it("rejeita v1 adulterado do mesmo tamanho", () => {
    const manifest = "id:12345;ts:1700000000;";
    const header = headerFor(manifest).replace(/v1=([0-9a-f])/, (_match, digit: string) => `v1=${digit === "0" ? "1" : "0"}`);
    expect(mpWebhookSignatureValid({ signature: header, requestId: undefined, dataId: "12345" })).toBe(false);
  });

  it("rejeita cabeçalho sem ts ou sem v1", () => {
    expect(mpWebhookSignatureValid({ signature: "ts=1700000000", requestId: "r", dataId: "1" })).toBe(false);
    expect(mpWebhookSignatureValid({ signature: undefined, requestId: "r", dataId: "1" })).toBe(false);
    expect(mpWebhookSignatureValid({ signature: "v1=abc", requestId: undefined, dataId: "1" })).toBe(false);
  });

  it("rejeita v1 de tamanho diferente sem chamar timingSafeEqual de forma insegura", () => {
    expect(
      mpWebhookSignatureValid({
        signature: "ts=1700000000,v1=abc",
        requestId: undefined,
        dataId: "1",
      }),
    ).toBe(false);
  });

  it("sem segredo configurado aceita a notificação", () => {
    config.mp.webhookSecret = "";
    expect(mpWebhookSignatureValid({ signature: undefined, requestId: undefined, dataId: "1" })).toBe(true);
    expect(mpWebhookSignatureValid({ signature: "lixo", requestId: "r", dataId: "1" })).toBe(true);
  });
});
