import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";

export type MerchantLocals = { userId: string; lojaId: string };

/** Valida o access token do Supabase enviado pelo painel e carrega a loja do usuário. */
export async function requireMerchant(req: Request, res: Response, next: NextFunction) {
  const admin = supabaseAdmin();
  if (!admin) {
    console.error("[auth] SUPABASE_SECRET_KEY ausente");
    res.status(503).json({ error: "Pagamentos indisponíveis no momento. Tente de novo em alguns minutos." });
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Entre na sua conta para continuar." });
    return;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Sua sessão terminou. Entre de novo para continuar." });
    return;
  }
  const { data: store, error: storeError } = await admin
    .from("lojas")
    .select("id")
    .eq("owner_id", data.user.id)
    .maybeSingle();
  if (storeError) {
    console.error("[auth] falha ao ler loja", storeError.message);
    res.status(500).json({ error: "Não conseguimos abrir sua loja agora. Tente de novo." });
    return;
  }
  if (!store) {
    res.status(409).json({ error: "Crie a loja antes de conectar o Mercado Pago." });
    return;
  }
  res.locals.merchant = { userId: data.user.id, lojaId: String(store.id) } satisfies MerchantLocals;
  next();
}
