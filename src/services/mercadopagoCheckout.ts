import {
  applicationFeeForStore,
  computeApplicationFeeCents,
  DEFAULT_PIX_FEE_PERCENT,
  totalWithFeesCents,
} from "../lib/fees";
import { mpCreatePixPayment, mpGetPayment, mpProcessorFeeBrl, type MpPayment } from "../lib/mercadopago";
import { supabaseAdmin } from "../lib/supabase";
import { storeAccessToken } from "./mercadopagoConnect";

type StoreRef = { nome: string; mp_status: string | null; repassar_taxas: boolean; taxa_pix_percent: number | string };

type OrderPayRow = {
  id: string;
  loja_id: string;
  token_publico: string;
  status_pagamento: string;
  total_centavos: number;
  nome_completo: string;
  pix_copia_cola: string | null;
  pix_qr_base64: string | null;
  pix_expira_em: string | null;
  lojas: StoreRef | StoreRef[] | null;
};

const PAYMENT_UNAVAILABLE = "Pagamento indisponível no momento. Tente de novo em alguns minutos.";
const TALK_TO_STORE = "Esta loja ainda não está recebendo Pix pelo site. Fale com a loja pelo WhatsApp para combinar o pagamento.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

function paymentStatus(mpStatus: string) {
  if (mpStatus === "approved") return "paid";
  if (mpStatus === "rejected" || mpStatus === "cancelled") return "failed";
  return "pending";
}

function pixFeePercent(store: StoreRef) {
  const value = Number(store.taxa_pix_percent);
  return Number.isFinite(value) && value >= 0 && value < 20 ? value : DEFAULT_PIX_FEE_PERCENT;
}

/** Gera (ou reaproveita) o Pix do pedido na conta da loja, com 1% de application_fee. */
export async function createOrderPix(opts: { pedidoId: string; token: string; email: string }) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[pix] SUPABASE_SECRET_KEY ausente");
    return { ok: false as const, status: 503, error: PAYMENT_UNAVAILABLE };
  }

  const { data, error } = await admin
    .from("pedidos")
    .select(
      "id, loja_id, token_publico, status_pagamento, total_centavos, nome_completo, pix_copia_cola, pix_qr_base64, pix_expira_em, lojas(nome, mp_status, repassar_taxas, taxa_pix_percent)",
    )
    .eq("id", opts.pedidoId)
    .maybeSingle();
  if (error) {
    console.error("[pix] falha ao ler pedido", error.message);
    return { ok: false as const, status: 500, error: PAYMENT_UNAVAILABLE };
  }
  const order = data as OrderPayRow | null;
  if (!order || order.token_publico !== opts.token) {
    return { ok: false as const, status: 404, error: "Pedido não encontrado." };
  }
  if (order.status_pagamento === "paid") {
    return { ok: true as const, paid: true, pix_copia_cola: null, pix_qr_base64: null };
  }

  const store = Array.isArray(order.lojas) ? order.lojas[0] : order.lojas;
  if (!store || store.mp_status !== "connected") {
    return { ok: false as const, status: 409, error: TALK_TO_STORE };
  }

  const stillValid =
    order.pix_copia_cola && order.pix_expira_em && new Date(order.pix_expira_em).getTime() > Date.now() + 60_000;
  if (stillValid) {
    return { ok: true as const, paid: false, pix_copia_cola: order.pix_copia_cola, pix_qr_base64: order.pix_qr_base64 };
  }

  const creds = await storeAccessToken(order.loja_id);
  if (!creds) return { ok: false as const, status: 409, error: TALK_TO_STORE };

  const chargeCents = store.repassar_taxas
    ? totalWithFeesCents(order.total_centavos, pixFeePercent(store))
    : order.total_centavos;
  const fee = applicationFeeForStore(creds.userId, computeApplicationFeeCents(chargeCents));
  const [firstName, ...rest] = order.nome_completo.trim().split(/\s+/);
  const expiresAt = new Date(Date.now() + 31 * 60 * 1000).toISOString();
  const created = await mpCreatePixPayment(creds.accessToken, {
    amountCents: chargeCents,
    applicationFeeCents: fee,
    description: `Pedido ${order.id.slice(0, 8)} - ${store.nome}`,
    externalReference: order.id,
    idempotencyKey: `${order.id}:${chargeCents}:${order.pix_expira_em ?? "novo"}`,
    email: opts.email,
    firstName: firstName || "Cliente",
    lastName: rest.join(" "),
    expiresAt,
  });
  if (!created.ok) {
    console.error("[pix] Mercado Pago recusou a cobrança", created.error);
    if (/without key enabled for QR/i.test(created.error)) {
      return { ok: false as const, status: 409, error: TALK_TO_STORE };
    }
    return { ok: false as const, status: 502, error: "Não conseguimos gerar o Pix agora. Tente de novo em instantes." };
  }

  const payment = created.data;
  const qr = payment.point_of_interaction?.transaction_data;
  await admin
    .from("pedidos")
    .update({
      mp_payment_id: String(payment.id),
      taxa_plataforma_centavos: fee,
      taxa_cliente_centavos: chargeCents - order.total_centavos,
      email_pagador: opts.email,
      pix_copia_cola: qr?.qr_code ?? null,
      pix_qr_base64: qr?.qr_code_base64 ?? null,
      pix_expira_em: payment.date_of_expiration ?? expiresAt,
      status_pagamento: paymentStatus(payment.status),
    })
    .eq("id", order.id);

  return {
    ok: true as const,
    paid: payment.status === "approved",
    pix_copia_cola: qr?.qr_code ?? null,
    pix_qr_base64: qr?.qr_code_base64 ?? null,
  };
}

/** Ajusta a taxa Pix da loja à taxa real do Mercado Pago, para o próximo repasse cobrir o valor certo. */
async function calibratePixFee(lojaId: string, payment: MpPayment) {
  const feeBrl = mpProcessorFeeBrl(payment);
  const amount = Number(payment.transaction_amount);
  if (feeBrl == null || !(amount > 0)) return;
  const observed = Math.round((feeBrl / amount) * 100 * 100) / 100;
  if (!(observed >= 0 && observed < 20)) return;
  const admin = supabaseAdmin();
  if (!admin) return;
  await admin
    .from("lojas")
    .update({ taxa_pix_percent: observed, taxa_pix_observada_em: new Date().toISOString() })
    .eq("id", lojaId)
    .neq("taxa_pix_percent", observed);
}

/** Relê o pagamento no Mercado Pago. Nunca confia em status vindo do navegador ou do corpo do webhook. */
export async function syncOrderPayment(pedidoId: string, token: string) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[status] SUPABASE_SECRET_KEY ausente");
    return { ok: false as const, status: 503, error: PAYMENT_UNAVAILABLE };
  }
  const { data, error } = await admin
    .from("pedidos")
    .select("id, loja_id, token_publico, status_pagamento, mp_payment_id")
    .eq("id", pedidoId)
    .maybeSingle();
  if (error) {
    console.error("[status] falha ao ler pedido", error.message);
    return { ok: false as const, status: 500, error: PAYMENT_UNAVAILABLE };
  }
  if (!data || data.token_publico !== token) return { ok: false as const, status: 404, error: "Pedido não encontrado." };

  const current = String(data.status_pagamento);
  if (current === "paid" || !data.mp_payment_id) return { ok: true as const, status_pagamento: current };

  const lojaId = String(data.loja_id);
  const creds = await storeAccessToken(lojaId);
  if (!creds) return { ok: true as const, status_pagamento: current };
  const payment = await mpGetPayment(creds.accessToken, String(data.mp_payment_id));
  if (!payment.ok) return { ok: true as const, status_pagamento: current };

  const next = paymentStatus(payment.data.status);
  if (next !== current) {
    await admin.from("pedidos").update({ status_pagamento: next }).eq("id", pedidoId);
    if (next === "paid") await calibratePixFee(lojaId, payment.data);
  }
  return { ok: true as const, status_pagamento: next };
}

export async function syncPaymentById(paymentId: string) {
  const admin = supabaseAdmin();
  if (!admin) return;
  const { data } = await admin.from("pedidos").select("id, token_publico").eq("mp_payment_id", paymentId).maybeSingle();
  if (!data) return;
  await syncOrderPayment(String(data.id), String(data.token_publico));
}
