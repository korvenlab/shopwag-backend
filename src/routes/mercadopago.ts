import { Router } from "express";
import { config } from "../config";
import { requireMerchant, type MerchantLocals } from "../lib/auth";
import { mpWebhookSignatureValid } from "../lib/mercadopago";
import { createOrderCheckout, isUuid, syncOrderPayment, syncPaymentById } from "../services/mercadopagoCheckout";
import { completeConnect, connectView, disconnectStore, startConnect, updateFees } from "../services/mercadopagoConnect";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const body = (req.body ?? {}) as { pass_fees?: unknown; plan?: unknown };
  const saved = await updateFees(lojaId, { passFees: body.pass_fees, plan: body.plan });
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

mercadopagoRouter.post("/checkout", async (req, res) => {
  const body = (req.body ?? {}) as { pedido_id?: unknown; token?: unknown; email?: unknown; metodo?: unknown };
  const pedidoId = String(body.pedido_id ?? "").trim();
  const token = String(body.token ?? "").trim();
  const email = String(body.email ?? "").trim();
  const method = body.metodo === "pix" || body.metodo === "credito" || body.metodo === "debito" ? body.metodo : null;
  if (!isUuid(pedidoId) || !isUuid(token) || (email !== "" && !EMAIL.test(email))) {
    res.status(400).json({ error: "Informe um e-mail válido para o pagamento." });
    return;
  }
  if (!method) {
    res.status(400).json({ error: "Escolha como quer pagar." });
    return;
  }
  const result = await createOrderCheckout({ pedidoId, token, email, method });
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
  const body = (req.body ?? {}) as { data?: { id?: unknown }; type?: unknown; user_id?: unknown };
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
    const sellerUserId = body.user_id == null ? null : String(body.user_id);
    await syncPaymentById(dataId, sellerUserId && /^\d+$/.test(sellerUserId) ? sellerUserId : null);
  }
  res.json({ received: true });
});
