import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config";

const MP_API = "https://api.mercadopago.com";

export function mpWebhookUrl() {
  if (config.mp.webhookUrl) return config.mp.webhookUrl;
  return `${new URL(config.mp.redirectUri).origin}/api/mercadopago/webhook`;
}

export function mpAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: config.mp.clientId,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: config.mp.redirectUri,
  });
  return `https://auth.mercadopago.com.br/authorization?${params.toString()}`;
}

export type MpResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function mpRequest<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; form?: URLSearchParams; idempotencyKey?: string } = {},
): Promise<MpResult<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.form) headers["content-type"] = "application/x-www-form-urlencoded";
  else if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["x-idempotency-key"] = opts.idempotencyKey;

  try {
    const response = await fetch(`${MP_API}${path}`, {
      method,
      headers,
      body: opts.form ? opts.form : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const body = json as { message?: string; error?: string; cause?: { description?: string }[] } | null;
      const cause = Array.isArray(body?.cause)
        ? body.cause.map((item) => item.description).filter(Boolean).join("; ")
        : "";
      return {
        ok: false,
        status: response.status,
        error: [body?.message, cause].filter(Boolean).join(" | ") || body?.error || text.slice(0, 200) || `MP HTTP ${response.status}`,
      };
    }
    return { ok: true, data: json as T };
  } catch (error) {
    return { ok: false, status: 502, error: error instanceof Error ? error.message : "Erro de rede no Mercado Pago" };
  }
}

export type MpTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  public_key?: string;
  user_id?: number | string;
  live_mode?: boolean;
  expires_in?: number;
};

export function mpExchangeCode(code: string) {
  const form = new URLSearchParams({
    client_id: config.mp.clientId,
    client_secret: config.mp.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.mp.redirectUri,
  });
  if (config.mp.oauthTestToken) form.set("test_token", "true");
  return mpRequest<MpTokenResponse>("POST", "/oauth/token", { form });
}

export function mpRefreshToken(refreshToken: string) {
  const form = new URLSearchParams({
    client_id: config.mp.clientId,
    client_secret: config.mp.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return mpRequest<MpTokenResponse>("POST", "/oauth/token", { form });
}

export type MpPayment = {
  id: number;
  status: string;
  status_detail?: string;
  payment_type_id?: string;
  transaction_amount: number;
  external_reference?: string | null;
  date_created?: string;
  fee_details?: { type?: string; amount?: number }[];
};

export type MpPreference = { id: string; init_point: string };

/** Checkout Pro na conta da loja: o cliente escolhe Pix ou cartão na página do Mercado Pago. */
export function mpCreatePreference(
  token: string,
  input: {
    amountCents: number;
    marketplaceFeeCents: number;
    title: string;
    externalReference: string;
    email: string;
    firstName: string;
    lastName: string;
    returnUrl: string;
  },
) {
  return mpRequest<MpPreference>("POST", "/checkout/preferences", {
    token,
    body: {
      items: [{ title: input.title.slice(0, 250), quantity: 1, unit_price: input.amountCents / 100, currency_id: "BRL" }],
      ...(input.marketplaceFeeCents > 0 ? { marketplace_fee: input.marketplaceFeeCents / 100 } : {}),
      external_reference: input.externalReference,
      notification_url: mpWebhookUrl(),
      payer: {
        email: input.email,
        name: input.firstName.slice(0, 60),
        surname: (input.lastName || input.firstName).slice(0, 60),
      },
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 12 },
      back_urls: { success: input.returnUrl, pending: input.returnUrl, failure: input.returnUrl },
      auto_return: "approved",
      statement_descriptor: input.title.slice(0, 22),
    },
  });
}

/** Pagamentos da conta da loja ligados a um pedido, do mais recente para o mais antigo. */
export function mpSearchPayments(token: string, externalReference: string) {
  const params = new URLSearchParams({
    external_reference: externalReference,
    sort: "date_created",
    criteria: "desc",
    limit: "10",
  });
  return mpRequest<{ results?: MpPayment[] }>("GET", `/v1/payments/search?${params.toString()}`, { token });
}

/** Taxa de processamento que o Mercado Pago cobrou da loja, em reais. */
export function mpProcessorFeeBrl(payment: MpPayment): number | null {
  const fee = payment.fee_details?.find((item) => item.type === "mercadopago_fee");
  return fee && Number.isFinite(Number(fee.amount)) ? Number(fee.amount) : null;
}

export function mpGetPayment(token: string, paymentId: string) {
  return mpRequest<MpPayment>("GET", `/v1/payments/${encodeURIComponent(paymentId)}`, { token });
}

export function mpWebhookSignatureValid(opts: { signature: string | undefined; requestId: string | undefined; dataId: string }) {
  if (!config.mp.webhookSecret) return true;
  const parts = Object.fromEntries(
    String(opts.signature || "")
      .split(",")
      .map((part) => part.split("=").map((item) => item.trim()) as [string, string]),
  );
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(opts.dataId) ? opts.dataId.toLowerCase() : opts.dataId;
  let manifest = `id:${id};`;
  if (opts.requestId) manifest += `request-id:${opts.requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = createHmac("sha256", config.mp.webhookSecret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && timingSafeEqual(a, b);
}
