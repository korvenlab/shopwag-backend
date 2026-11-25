import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import { config } from "../config";
import { syncPaymentById } from "../services/mercadopagoCheckout";

jest.mock("../services/mercadopagoCheckout", () => ({
  isUuid: jest.fn(() => false),
  createOrderCheckout: jest.fn(),
  syncOrderPayment: jest.fn(),
  syncPaymentById: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/mercadopagoConnect", () => ({
  completeConnect: jest.fn(),
  connectView: jest.fn(),
  disconnectStore: jest.fn(),
  startConnect: jest.fn(),
  updateFees: jest.fn(),
}));

import { mercadopagoRouter } from "./mercadopago";

const SECRET = "segredo-de-teste";

function signature(dataId: string, requestId: string | undefined, ts = "1700000000") {
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

function app() {
  const api = express();
  api.use(express.json());
  api.use("/api/mercadopago", mercadopagoRouter);
  return api;
}

describe("POST /api/mercadopago/webhook", () => {
  const originalSecret = config.mp.webhookSecret;

  beforeEach(() => {
    config.mp.webhookSecret = SECRET;
  });

  afterAll(() => {
    config.mp.webhookSecret = originalSecret;
  });

  it("responde 401 e não sincroniza quando a assinatura é inválida", async () => {
    const response = await request(app())
      .post("/api/mercadopago/webhook")
      .query({ "data.id": "12345", type: "payment" })
      .set("x-signature", "ts=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000")
      .set("x-request-id", "req-1")
      .send({ type: "payment", data: { id: "12345" }, user_id: 4242 });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "invalid signature" });
    expect(syncPaymentById).not.toHaveBeenCalled();
  });

  it("sincroniza o pagamento quando a assinatura confere", async () => {
    const response = await request(app())
      .post("/api/mercadopago/webhook")
      .query({ "data.id": "12345", type: "payment" })
      .set("x-signature", signature("12345", "req-1"))
      .set("x-request-id", "req-1")
      .send({ type: "payment", data: { id: "12345" }, user_id: 4242 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(syncPaymentById).toHaveBeenCalledTimes(1);
    expect(syncPaymentById).toHaveBeenCalledWith("12345", "4242");
  });

  it("ignora IPN antigo sem data.id e sem sincronizar", async () => {
    const response = await request(app()).post("/api/mercadopago/webhook").query({ topic: "payment" }).send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, ignored: "ipn" });
    expect(syncPaymentById).not.toHaveBeenCalled();
  });

  it("sem segredo configurado aceita a notificação, como a função de assinatura faz hoje", async () => {
    config.mp.webhookSecret = "";

    const response = await request(app())
      .post("/api/mercadopago/webhook")
      .query({ "data.id": "77", type: "payment" })
      .send({ type: "payment", data: { id: "77" }, user_id: "77" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(syncPaymentById).toHaveBeenCalledWith("77", "77");
  });
});
