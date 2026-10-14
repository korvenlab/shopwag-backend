import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";

export type MerchantLocals = { userId: string; lojaId: string };

/** Valida o access token do Supabase enviado pelo painel e carrega a loja do usuário. */
export async function requireMerchant(req: Request, res: Response, next: NextFunction) {
  const admin = supabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: "Servidor sem SUPABASE_SECRET_KEY." });
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Sessão expirada" });
    return;
  }
  const { data: store } = await admin.from("lojas").select("id").eq("owner_id", data.user.id).maybeSingle();
  if (!store) {
    res.status(409).json({ error: "Crie a loja antes de conectar o Mercado Pago." });
    return;
  }
  res.locals.merchant = { userId: data.user.id, lojaId: String(store.id) } satisfies MerchantLocals;
  next();
}
