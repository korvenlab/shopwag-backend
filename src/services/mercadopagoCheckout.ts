import { config } from "../config";
import {
  applicationFeeForStore,
  chargeBreakdown,
  DEFAULT_CREDIT_FEE_PERCENT,
  DEFAULT_DEBIT_FEE_PERCENT,
  DEFAULT_PIX_FEE_PERCENT,
} from "../lib/fees";
import {
  mpCreatePreference,
  mpGetPayment,
  mpProcessorFeeBrl,
  mpSearchPayments,
  type MpPayment,
  type PayMethod,
} from "../lib/mercadopago";
import { supabaseAdmin } from "../lib/supabase";
import { storeAccessToken } from "./mercadopagoConnect";

type StoreRef = {
  nome: string;
  slug: string;
  dominio: string | null;
  mp_status: string | null;
  repassar_taxas: boolean;
  taxa_pix_percent: number | string;
  taxa_credito_percent: number | string;
  taxa_debito_percent: number | string;
};

type OrderPayRow = {
  id: string;
  loja_id: string;
  token_publico: string;
  status_pagamento: string;
  total_centavos: number;
  nome_completo: string;
  email_pagador: string | null;
  lojas: StoreRef | StoreRef[] | null;
};

const PAYMENT_UNAVAILABLE = "Pagamento indisponível no momento. Tente de novo em alguns minutos.";
const TALK_TO_STORE =
  "Esta loja ainda não está recebendo pagamentos pelo site. Fale com a loja pelo WhatsApp para combinar o pagamento.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

function paymentStatus(mpStatus: string) {
  if (mpStatus === "approved") return "paid";
  if (mpStatus === "rejected" || mpStatus === "cancelled") return "failed";
  if (mpStatus === "refunded" || mpStatus === "charged_back") return "refunded";
  return "pending";
}

const METHOD_BY_TYPE: Record<string, string> = {
  bank_transfer: "pix",
  credit_card: "credito",
  debit_card: "debito",
};

const FEE_COLUMN: Record<string, string> = {
  bank_transfer: "taxa_pix_percent",
  credit_card: "taxa_credito_percent",
  debit_card: "taxa_debito_percent",
};

const FEE_BY_METHOD: Record<PayMethod, { field: keyof StoreRef; fallback: number }> = {
  pix: { field: "taxa_pix_percent", fallback: DEFAULT_PIX_FEE_PERCENT },
  credito: { field: "taxa_credito_percent", fallback: DEFAULT_CREDIT_FEE_PERCENT },
  debito: { field: "taxa_debito_percent", fallback: DEFAULT_DEBIT_FEE_PERCENT },
};

/** A taxa de serviço é sempre do cliente; a do Mercado Pago (Pix ou cartão) só quando a loja repassa. */
function chargeFor(store: StoreRef, totalCents: number, method: PayMethod) {
  if (!store.repassar_taxas) return chargeBreakdown(totalCents, null);
  const { field, fallback } = FEE_BY_METHOD[method];
  const percent = Number(store[field]);
  return chargeBreakdown(totalCents, Number.isFinite(percent) && percent >= 0 && percent < 20 ? percent : fallback);
}

function receiptUrl(store: StoreRef, order: { id: string; token_publico: string }) {
  const host = store.dominio || `${store.slug}.${config.storeDomain}`;
  return `https://${host}/pedido/${order.id}?t=${order.token_publico}`;
}

/** Abre o Checkout Pro do pedido na conta da loja; a taxa de serviço vai para a Shopwag como marketplace_fee. */
export async function createOrderCheckout(opts: { pedidoId: string; token: string; email: string; method: PayMethod }) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[checkout] SUPABASE_SECRET_KEY ausente");
    return { ok: false as const, status: 503, error: PAYMENT_UNAVAILABLE };
  }

  const { data, error } = await admin
    .from("pedidos")
    .select(
      "id, loja_id, token_publico, status_pagamento, total_centavos, nome_completo, email_pagador, lojas(nome, slug, dominio, mp_status, repassar_taxas, taxa_pix_percent, taxa_credito_percent, taxa_debito_percent)",
    )
    .eq("id", opts.pedidoId)
    .maybeSingle();
  if (error) {
    console.error("[checkout] falha ao ler pedido", error.message);
    return { ok: false as const, status: 500, error: PAYMENT_UNAVAILABLE };
  }
  const order = data as OrderPayRow | null;
  if (!order || order.token_publico !== opts.token) {
    return { ok: false as const, status: 404, error: "Pedido não encontrado." };
  }
  if (order.status_pagamento === "paid") return { ok: true as const, paid: true, url: null };

  const store = Array.isArray(order.lojas) ? order.lojas[0] : order.lojas;
  if (!store || store.mp_status !== "connected") {
    return { ok: false as const, status: 409, error: TALK_TO_STORE };
  }
  const creds = await storeAccessToken(order.loja_id);
  if (!creds) return { ok: false as const, status: 409, error: TALK_TO_STORE };

  const email = opts.email || order.email_pagador || "";
  if (!email) return { ok: false as const, status: 400, error: "Informe um e-mail válido para o pagamento." };
  const charge = chargeFor(store, order.total_centavos, opts.method);
  const chargeCents = charge.total;
  const fee = applicationFeeForStore(creds.userId, charge.service);
  const [firstName, ...rest] = order.nome_completo.trim().split(/\s+/);
  const created = await mpCreatePreference(creds.accessToken, {
    method: opts.method,
    amountCents: chargeCents,
    marketplaceFeeCents: fee,
    title: `Pedido ${order.id.slice(0, 8)} - ${store.nome}`,
    externalReference: order.id,
    email,
    firstName: firstName || "Cliente",
    lastName: rest.join(" "),
    returnUrl: receiptUrl(store, order),
  });
  if (!created.ok || !created.data.init_point) {
    console.error("[checkout] Mercado Pago recusou o checkout", created.ok ? "sem init_point" : created.error);
    return { ok: false as const, status: 502, error: "Não conseguimos abrir o pagamento agora. Tente de novo em instantes." };
  }

  await admin
    .from("pedidos")
    .update({
      metodo_pagamento: opts.method,
      taxa_plataforma_centavos: charge.service,
      taxa_cliente_centavos: chargeCents - order.total_centavos,
      email_pagador: email,
    })
    .eq("id", order.id);

  return { ok: true as const, paid: false, url: created.data.init_point };
}

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

/** Aprovado vence qualquer outra tentativa; senão vale a mais recente. */
function pickPayment(payments: MpPayment[]) {
  return payments.find((payment) => payment.status === "approved") ?? payments[0] ?? null;
}

async function applyPayment(order: { id: string; loja_id: string; status_pagamento: string }, payment: MpPayment) {
  const admin = supabaseAdmin();
  if (!admin) return order.status_pagamento;
  const next = paymentStatus(payment.status);
  const method = METHOD_BY_TYPE[payment.payment_type_id ?? ""];
  await admin
    .from("pedidos")
    .update({ mp_payment_id: String(payment.id), status_pagamento: next, ...(method ? { metodo_pagamento: method } : {}) })
    .eq("id", order.id);
  if (next === "paid" && order.status_pagamento !== "paid") await calibrateFee(order.loja_id, payment);
  return next;
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
    .select("id, loja_id, token_publico, status_pagamento")
    .eq("id", pedidoId)
    .maybeSingle();
  if (error) {
    console.error("[status] falha ao ler pedido", error.message);
    return { ok: false as const, status: 500, error: PAYMENT_UNAVAILABLE };
  }
  if (!data || data.token_publico !== token) return { ok: false as const, status: 404, error: "Pedido não encontrado." };

  const order = { id: String(data.id), loja_id: String(data.loja_id), status_pagamento: String(data.status_pagamento) };
  if (order.status_pagamento === "paid") return { ok: true as const, status_pagamento: order.status_pagamento };

  const creds = await storeAccessToken(order.loja_id);
  if (!creds) return { ok: true as const, status_pagamento: order.status_pagamento };
  const found = await mpSearchPayments(creds.accessToken, order.id);
  const payment = found.ok ? pickPayment(found.data.results ?? []) : null;
  if (!payment) return { ok: true as const, status_pagamento: order.status_pagamento };
  return { ok: true as const, status_pagamento: await applyPayment(order, payment) };
}

/** Webhook: o pagamento é da conta da loja (user_id), e o pedido vem do external_reference. */
export async function syncPaymentById(paymentId: string, sellerUserId: string | null) {
  const admin = supabaseAdmin();
  if (!admin) return;

  const { data: known } = await admin.from("pedidos").select("id, token_publico").eq("mp_payment_id", paymentId).maybeSingle();
  if (known) {
    await syncOrderPayment(String(known.id), String(known.token_publico));
    return;
  }
  if (!sellerUserId) return;

  const { data: account } = await admin
    .from("loja_mp_contas")
    .select("loja_id")
    .eq("mp_user_id", sellerUserId)
    .maybeSingle();
  if (!account) return;
  const lojaId = String(account.loja_id);
  const creds = await storeAccessToken(lojaId);
  if (!creds) return;
  const payment = await mpGetPayment(creds.accessToken, paymentId);
  const reference = payment.ok ? String(payment.data.external_reference ?? "") : "";
  if (!isUuid(reference)) return;

  const { data: order } = await admin
    .from("pedidos")
    .select("id, loja_id, token_publico")
    .eq("id", reference)
    .eq("loja_id", lojaId)
    .maybeSingle();
  if (!order) return;
  await syncOrderPayment(String(order.id), String(order.token_publico));
}
