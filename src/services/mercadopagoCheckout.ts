import {
  applicationFeeForStore,
  computeApplicationFeeCents,
  DEFAULT_CREDIT_FEE_PERCENT,
  DEFAULT_DEBIT_FEE_PERCENT,
  DEFAULT_PIX_FEE_PERCENT,
  totalWithFeesCents,
} from "../lib/fees";
import {
  mpCreateCardPayment,
  mpCreatePixPayment,
  mpGetPayment,
  mpProcessorFeeBrl,
  type MpCardInput,
  type MpPayment,
} from "../lib/mercadopago";
import { supabaseAdmin } from "../lib/supabase";
import { storeAccessToken } from "./mercadopagoConnect";

type StoreRef = {
  nome: string;
  mp_status: string | null;
  repassar_taxas: boolean;
  taxa_pix_percent: number | string;
  taxa_credito_percent: number | string;
  taxa_debito_percent: number | string;
};

export type CardMethod = "credito" | "debito";

const STORE_FIELDS = "lojas(nome, mp_status, repassar_taxas, taxa_pix_percent, taxa_credito_percent, taxa_debito_percent)";

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

function validPercent(value: number | string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 20 ? parsed : fallback;
}

function pixFeePercent(store: StoreRef) {
  return validPercent(store.taxa_pix_percent, DEFAULT_PIX_FEE_PERCENT);
}

function cardFeePercent(store: StoreRef, method: CardMethod) {
  return method === "credito"
    ? validPercent(store.taxa_credito_percent, DEFAULT_CREDIT_FEE_PERCENT)
    : validPercent(store.taxa_debito_percent, DEFAULT_DEBIT_FEE_PERCENT);
}

const CARD_REJECTED: Record<string, string> = {
  cc_rejected_insufficient_amount: "Saldo ou limite insuficiente. Tente outro cartão.",
  cc_rejected_bad_filled_security_code: "Código de segurança incorreto. Confira o CVV.",
  cc_rejected_bad_filled_date: "Validade do cartão incorreta.",
  cc_rejected_bad_filled_card_number: "Número do cartão incorreto.",
  cc_rejected_bad_filled_other: "Confira os dados do cartão.",
  cc_rejected_call_for_authorize: "O banco pediu autorização. Ligue para o seu banco e tente de novo.",
  cc_rejected_card_disabled: "Cartão bloqueado. Ligue para o seu banco ou use outro cartão.",
  cc_rejected_duplicated_payment: "Você já fez um pagamento igual agora há pouco.",
  cc_rejected_max_attempts: "Muitas tentativas. Use outro cartão.",
  cc_rejected_high_risk: "Pagamento recusado por segurança. Tente outro cartão ou pague com Pix.",
};

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
      `id, loja_id, token_publico, status_pagamento, total_centavos, nome_completo, pix_copia_cola, pix_qr_base64, pix_expira_em, ${STORE_FIELDS}`,
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
      metodo_pagamento: "pix",
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

/** Cobra o cartão na conta da loja, com 1% de application_fee. binary_mode: aprova ou recusa na hora. */
export async function createOrderCardPayment(opts: {
  pedidoId: string;
  token: string;
  email: string;
  method: CardMethod;
  card: MpCardInput;
}) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[cartao] SUPABASE_SECRET_KEY ausente");
    return { ok: false as const, status: 503, error: PAYMENT_UNAVAILABLE };
  }

  const { data, error } = await admin
    .from("pedidos")
    .select(`id, loja_id, token_publico, status_pagamento, total_centavos, nome_completo, ${STORE_FIELDS}`)
    .eq("id", opts.pedidoId)
    .maybeSingle();
  if (error) {
    console.error("[cartao] falha ao ler pedido", error.message);
    return { ok: false as const, status: 500, error: PAYMENT_UNAVAILABLE };
  }
  const order = data as Omit<OrderPayRow, "pix_copia_cola" | "pix_qr_base64" | "pix_expira_em"> | null;
  if (!order || order.token_publico !== opts.token) {
    return { ok: false as const, status: 404, error: "Pedido não encontrado." };
  }
  if (order.status_pagamento === "paid") return { ok: true as const, status_pagamento: "paid" };

  const store = Array.isArray(order.lojas) ? order.lojas[0] : order.lojas;
  if (!store || store.mp_status !== "connected") {
    return { ok: false as const, status: 409, error: TALK_TO_STORE };
  }
  const creds = await storeAccessToken(order.loja_id);
  if (!creds) return { ok: false as const, status: 409, error: TALK_TO_STORE };

  const chargeCents = store.repassar_taxas
    ? totalWithFeesCents(order.total_centavos, cardFeePercent(store, opts.method))
    : order.total_centavos;
  const fee = applicationFeeForStore(creds.userId, computeApplicationFeeCents(chargeCents));
  const [firstName, ...rest] = order.nome_completo.trim().split(/\s+/);
  const created = await mpCreateCardPayment(creds.accessToken, {
    ...opts.card,
    amountCents: chargeCents,
    applicationFeeCents: fee,
    description: `Pedido ${order.id.slice(0, 8)} - ${store.nome}`,
    externalReference: order.id,
    idempotencyKey: `${order.id}:${opts.card.cardToken}`,
    email: opts.email,
    firstName: firstName || "Cliente",
    lastName: rest.join(" "),
  });
  if (!created.ok) {
    console.error("[cartao] Mercado Pago recusou a cobrança", created.error);
    return { ok: false as const, status: 402, error: "Não conseguimos processar o cartão. Confira os dados e tente de novo." };
  }

  const payment = created.data;
  const next = paymentStatus(payment.status);
  await admin
    .from("pedidos")
    .update({
      mp_payment_id: String(payment.id),
      metodo_pagamento: opts.method,
      taxa_plataforma_centavos: fee,
      taxa_cliente_centavos: chargeCents - order.total_centavos,
      email_pagador: opts.email,
      status_pagamento: next,
    })
    .eq("id", order.id);

  if (next === "paid") await calibrateFee(order.loja_id, payment);
  if (next === "failed") {
    const reason = CARD_REJECTED[payment.status_detail ?? ""] ?? "Pagamento recusado pelo banco. Tente outro cartão ou pague com Pix.";
    return { ok: false as const, status: 402, error: reason };
  }
  return { ok: true as const, status_pagamento: next };
}

const FEE_COLUMN: Record<string, string> = {
  bank_transfer: "taxa_pix_percent",
  credit_card: "taxa_credito_percent",
  debit_card: "taxa_debito_percent",
};

/** Ajusta a taxa do meio de pagamento à taxa real do Mercado Pago, para o próximo repasse cobrir o valor certo. */
async function calibrateFee(lojaId: string, payment: MpPayment) {
  const column = FEE_COLUMN[payment.payment_type_id ?? ""];
  const feeBrl = mpProcessorFeeBrl(payment);
  const amount = Number(payment.transaction_amount);
  if (!column || feeBrl == null || !(amount > 0)) return;
  const observed = Math.round((feeBrl / amount) * 100 * 100) / 100;
  if (!(observed >= 0 && observed < 20)) return;
  const admin = supabaseAdmin();
  if (!admin) return;
  const patch: Record<string, unknown> = { [column]: observed };
  if (column === "taxa_pix_percent") patch.taxa_pix_observada_em = new Date().toISOString();
  await admin.from("lojas").update(patch).eq("id", lojaId).neq(column, observed);
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
    if (next === "paid") await calibrateFee(lojaId, payment.data);
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
