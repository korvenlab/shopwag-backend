import { Router } from "express";
import { config } from "../config";
import { requireMerchant, type MerchantLocals } from "../lib/auth";
import { mpWebhookSignatureValid } from "../lib/mercadopago";
import {
  createOrderCardPayment,
  createOrderPix,
  isUuid,
  syncOrderPayment,
  syncPaymentById,
} from "../services/mercadopagoCheckout";
import {
  completeConnect,
  connectView,
  disconnectStore,
  startConnect,
  storePublicKey,
  updateFees,
} from "../services/mercadopagoConnect";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CARD_ATTEMPTS_PER_HOUR = 6;
const cardAttempts = new Map<string, number[]>();

function cardAttemptAllowed(pedidoId: string) {
  const now = Date.now();
  const recent = (cardAttempts.get(pedidoId) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  if (recent.length >= CARD_ATTEMPTS_PER_HOUR) return false;
  recent.push(now);
  cardAttempts.set(pedidoId, recent);
  if (cardAttempts.size > 5000) cardAttempts.delete(cardAttempts.keys().next().value as string);
  return true;
}

export const mercadopagoRouter = Router();

function merchant(locals: Record<string, unknown>) {
  return locals.merchant as MerchantLocals;
}

mercadopagoRouter.get("/connect", requireMerchant, async (_req, res) => {
  res.json(await connectView(merchant(res.locals).lojaId));
});

mercadopagoRouter.get("/connect/start", requireMerchant, async (_req, res) => {
  const started = await startConnect(merchant(res.locals).lojaId);
  if (!started.ok) {
    res.status(started.status).json({ error: started.error });
    return;
  }
  res.json({ url: started.url });
});

mercadopagoRouter.delete("/connect", requireMerchant, async (_req, res) => {
  const { lojaId } = merchant(res.locals);
  await disconnectStore(lojaId);
  res.json(await connectView(lojaId));
});

mercadopagoRouter.patch("/connect/fees", requireMerchant, async (req, res) => {
  const { lojaId } = merchant(res.locals);
  const body = (req.body ?? {}) as { pass_fees?: unknown; pix_percent?: unknown };
  const saved = await updateFees(lojaId, { passFees: body.pass_fees, pixPercent: body.pix_percent });
  if (!saved.ok) {
    res.status(saved.status).json({ error: saved.error });
    return;
  }
  res.json(await connectView(lojaId));
});

mercadopagoRouter.get("/oauth/callback", async (req, res) => {
  const back = new URL("/dashboard/loja", config.frontendUrl);
  if (req.query.error) {
    back.searchParams.set("mercadopago", "denied");
    res.redirect(back.toString());
    return;
  }
  const done = await completeConnect(String(req.query.state || ""), String(req.query.code || ""));
  if (done.ok) {
    back.searchParams.set("mercadopago", "connected");
  } else {
    back.searchParams.set("mercadopago", "error");
    back.searchParams.set("message", done.error.slice(0, 180));
  }
  res.redirect(back.toString());
});

mercadopagoRouter.post("/pix", async (req, res) => {
  const body = (req.body ?? {}) as { pedido_id?: unknown; token?: unknown; email?: unknown };
  const pedidoId = String(body.pedido_id ?? "").trim();
  const token = String(body.token ?? "").trim();
  const email = String(body.email ?? "").trim();
  if (!isUuid(pedidoId) || !isUuid(token) || !EMAIL.test(email)) {
    res.status(400).json({ error: "Informe um e-mail válido para o Pix." });
    return;
  }
  const result = await createOrderPix({ pedidoId, token, email });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

mercadopagoRouter.get("/public-key", async (req, res) => {
  const lojaId = String(req.query.loja || "");
  if (!isUuid(lojaId)) {
    res.status(400).json({ error: "Loja não encontrada." });
    return;
  }
  const publicKey = await storePublicKey(lojaId);
  if (!publicKey) {
    res.status(409).json({ error: "Esta loja ainda não está recebendo cartão pelo site." });
    return;
  }
  res.json({ public_key: publicKey });
});

mercadopagoRouter.post("/card", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pedidoId = String(body.pedido_id ?? "").trim();
  const token = String(body.token ?? "").trim();
  const email = String(body.email ?? "").trim();
  const method = body.metodo === "debito" ? "debito" : body.metodo === "credito" ? "credito" : null;
  const cardToken = String(body.card_token ?? "").trim();
  const paymentMethodId = String(body.payment_method_id ?? "").trim();
  const installments = Number(body.installments ?? 1);
  const issuer = body.issuer_id == null || body.issuer_id === "" ? null : String(body.issuer_id);
  const identification = body.identification as { type?: unknown; number?: unknown } | undefined;
  if (
    !isUuid(pedidoId) ||
    !isUuid(token) ||
    !EMAIL.test(email) ||
    !method ||
    !/^[\w-]{8,}$/.test(cardToken) ||
    !/^[a-z_]{2,30}$/.test(paymentMethodId) ||
    !Number.isInteger(installments) ||
    installments < 1 ||
    installments > 12 ||
    (method === "debito" && installments !== 1)
  ) {
    res.status(400).json({ error: "Confira os dados do cartão." });
    return;
  }
  if (!cardAttemptAllowed(pedidoId)) {
    res.status(429).json({ error: "Muitas tentativas neste pedido. Pague com Pix ou tente mais tarde." });
    return;
  }
  const result = await createOrderCardPayment({
    pedidoId,
    token,
    email,
    method,
    card: {
      cardToken,
      paymentMethodId,
      issuerId: issuer,
      installments,
      identification:
        identification?.type && identification?.number
          ? { type: String(identification.type), number: String(identification.number).replace(/\D/g, "") }
          : null,
    },
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

mercadopagoRouter.get("/status", async (req, res) => {
  const pedidoId = String(req.query.pedido || "");
  const token = String(req.query.t || "");
  if (!isUuid(pedidoId) || !isUuid(token)) {
    res.status(400).json({ error: "Pedido não encontrado." });
    return;
  }
  const result = await syncOrderPayment(pedidoId, token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

mercadopagoRouter.post("/webhook", async (req, res) => {
  const body = (req.body ?? {}) as { data?: { id?: unknown }; type?: unknown };
  if (req.query.topic && !req.query["data.id"]) {
    res.json({ received: true, ignored: "ipn" });
    return;
  }
  const dataId = String(req.query["data.id"] || body.data?.id || "");
  const type = String(req.query.type || body.type || "");
  if (
    dataId &&
    !mpWebhookSignatureValid({
      signature: req.header("x-signature"),
      requestId: req.header("x-request-id"),
      dataId,
    })
  ) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  if (type === "payment" && /^\d+$/.test(dataId)) {
    await syncPaymentById(dataId);
  }
  res.json({ received: true });
});
