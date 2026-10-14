import { randomBytes } from "crypto";
import { mpConfigured } from "../config";
import { asReceivePlan, CREDIT_FEE_BY_PLAN, DEFAULT_PIX_FEE_PERCENT, PLATFORM_FEE_PERCENT } from "../lib/fees";
import { mpAuthorizeUrl, mpExchangeCode, mpRefreshToken, type MpTokenResponse } from "../lib/mercadopago";
import { openSecret, sealSecret, secretBoxConfigured } from "../lib/secretBox";
import { supabaseAdmin } from "../lib/supabase";

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

type MpAccountRow = {
  loja_id: string;
  mp_user_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  public_key: string;
  live_mode: boolean;
  token_expires_at: string;
  status: "connected" | "needs_reconnect" | "revoked";
};

type Fail = { ok: false; status: number; error: string };

const CONNECT_SOON = "A conexão com o Mercado Pago estará disponível em breve. Tente de novo mais tarde.";
const TRY_AGAIN = "Não conseguimos concluir agora. Tente de novo em alguns minutos.";

function fail(status: number, error: string): Fail {
  return { ok: false, status, error };
}

async function feesView(lojaId: string) {
  const admin = supabaseAdmin();
  const { data } = admin
    ? await admin
        .from("lojas")
        .select("repassar_taxas, mp_prazo_recebimento, taxa_pix_percent, taxa_pix_observada_em")
        .eq("id", lojaId)
        .maybeSingle()
    : { data: null };
  return {
    platform_percent: PLATFORM_FEE_PERCENT,
    pass_fees: Boolean(data?.repassar_taxas),
    plan: asReceivePlan(data?.mp_prazo_recebimento) ?? "na_hora",
    pix_percent: data ? Number(data.taxa_pix_percent) : DEFAULT_PIX_FEE_PERCENT,
    pix_observed_at: (data?.taxa_pix_observada_em as string | null | undefined) ?? null,
  };
}

export async function connectView(lojaId: string) {
  const admin = supabaseAdmin();
  const available = mpConfigured() && secretBoxConfigured() && Boolean(admin);
  if (!admin) {
    return { available: false, connected: false, status: null, user_id: null, live_mode: null, fees: await feesView(lojaId) };
  }
  const { data } = await admin
    .from("loja_mp_contas")
    .select("mp_user_id, live_mode, status")
    .eq("loja_id", lojaId)
    .maybeSingle();
  return {
    available,
    connected: data?.status === "connected",
    status: (data?.status as string | undefined) ?? null,
    user_id: (data?.mp_user_id as string | undefined) ?? null,
    live_mode: (data?.live_mode as boolean | undefined) ?? null,
    fees: await feesView(lojaId),
  };
}

/** Lojista escolhe se o cliente paga as taxas. Trocar o prazo reinicia a taxa do crédito pela tabela do Mercado Pago. */
export async function updateFees(lojaId: string, input: { passFees?: unknown; plan?: unknown }) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[taxas] SUPABASE_SECRET_KEY ausente");
    return fail(503, TRY_AGAIN);
  }
  const patch: Record<string, unknown> = {};
  if (input.passFees !== undefined) patch.repassar_taxas = input.passFees === true;
  if (input.plan !== undefined) {
    const plan = asReceivePlan(input.plan);
    if (!plan) return fail(400, "Escolha quando você recebe as vendas no crédito.");
    patch.mp_prazo_recebimento = plan;
    patch.taxa_credito_percent = CREDIT_FEE_BY_PLAN[plan];
  }
  if (Object.keys(patch).length === 0) return fail(400, "Nada para salvar.");
  const { error } = await admin.from("lojas").update(patch).eq("id", lojaId);
  if (error) {
    console.error("[taxas] falha ao salvar", error.message);
    return fail(500, TRY_AGAIN);
  }
  return { ok: true as const };
}

export async function startConnect(lojaId: string) {
  const admin = supabaseAdmin();
  if (!mpConfigured() || !secretBoxConfigured() || !admin) {
    console.error("[mp] conexão indisponível: confira MP_CLIENT_ID/SECRET, MP_TOKEN_SECRET e SUPABASE_SECRET_KEY");
    return fail(503, CONNECT_SOON);
  }

  await admin.from("mp_oauth_states").delete().lt("expira_em", new Date().toISOString());
  const state = randomBytes(24).toString("hex");
  const { error } = await admin.from("mp_oauth_states").insert({
    state,
    loja_id: lojaId,
    expira_em: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[mp] falha ao gravar state", error.message);
    return fail(500, TRY_AGAIN);
  }
  return { ok: true as const, url: mpAuthorizeUrl(state) };
}

function expiresAt(token: MpTokenResponse) {
  const seconds = Number(token.expires_in);
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 180 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export async function completeConnect(state: string, code: string) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[mp] SUPABASE_SECRET_KEY ausente no retorno da conexão");
    return fail(503, TRY_AGAIN);
  }
  if (!/^[0-9a-f]{48}$/.test(state)) return fail(400, "Este link de conexão não vale mais. Clique em Conectar de novo.");

  const { data: consumed } = await admin
    .from("mp_oauth_states")
    .delete()
    .eq("state", state)
    .gt("expira_em", new Date().toISOString())
    .select("loja_id");
  const lojaId = consumed?.[0]?.loja_id as string | undefined;
  if (!lojaId) return fail(400, "A conexão demorou demais. Clique em Conectar de novo.");
  if (!code) return fail(400, "O Mercado Pago não concluiu a conexão. Tente de novo.");

  const token = await mpExchangeCode(code);
  if (!token.ok) {
    console.error("[mp] troca do código falhou", token.error);
    return fail(502, "O Mercado Pago não concluiu a conexão. Tente de novo.");
  }
  const account = token.data;
  if (!account.access_token || !account.refresh_token || !account.public_key || account.user_id == null) {
    console.error("[mp] resposta OAuth incompleta");
    return fail(502, "O Mercado Pago não concluiu a conexão. Tente de novo.");
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("loja_mp_contas").upsert(
    {
      loja_id: lojaId,
      mp_user_id: String(account.user_id),
      access_token_enc: sealSecret(account.access_token),
      refresh_token_enc: sealSecret(account.refresh_token),
      public_key: account.public_key,
      live_mode: account.live_mode !== false,
      token_expires_at: expiresAt(account),
      status: "connected",
      conectado_em: now,
      atualizado_em: now,
    },
    { onConflict: "loja_id" },
  );
  if (error) {
    console.error("[mp] falha ao salvar conexão", error.message);
    return fail(500, TRY_AGAIN);
  }

  await admin.from("lojas").update({ mp_status: "connected" }).eq("id", lojaId);
  return { ok: true as const, lojaId };
}

export async function disconnectStore(lojaId: string) {
  const admin = supabaseAdmin();
  if (!admin) return;
  await admin.from("loja_mp_contas").delete().eq("loja_id", lojaId);
  await admin.from("lojas").update({ mp_status: "revoked" }).eq("id", lojaId);
}

/** Token da loja para cobrar em nome dela, renovando quando faltam menos de 7 dias. */
export async function storeAccessToken(lojaId: string) {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const { data } = await admin.from("loja_mp_contas").select("*").eq("loja_id", lojaId).maybeSingle();
  const row = data as MpAccountRow | null;
  if (!row || row.status !== "connected") return null;

  const expiresAtMs = new Date(row.token_expires_at).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > REFRESH_MARGIN_MS) {
    return { accessToken: openSecret(row.access_token_enc), userId: row.mp_user_id };
  }

  const renewed = await mpRefreshToken(openSecret(row.refresh_token_enc));
  if (!renewed.ok || !renewed.data.access_token || !renewed.data.refresh_token) {
    if (!renewed.ok && renewed.status < 500 && renewed.status !== 429) {
      await admin
        .from("loja_mp_contas")
        .update({ status: "needs_reconnect", atualizado_em: new Date().toISOString() })
        .eq("loja_id", lojaId);
      await admin.from("lojas").update({ mp_status: "needs_reconnect" }).eq("id", lojaId);
    }
    return null;
  }

  await admin
    .from("loja_mp_contas")
    .update({
      access_token_enc: sealSecret(renewed.data.access_token),
      refresh_token_enc: sealSecret(renewed.data.refresh_token),
      ...(renewed.data.public_key ? { public_key: renewed.data.public_key } : {}),
      token_expires_at: expiresAt(renewed.data),
      atualizado_em: new Date().toISOString(),
    })
    .eq("loja_id", lojaId);

  return { accessToken: renewed.data.access_token, userId: row.mp_user_id };
}
