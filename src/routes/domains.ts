import { Router } from "express";
import { config } from "../config";
import { requireMerchant, type MerchantLocals } from "../lib/auth";
import { supabaseAdmin } from "../lib/supabase";

export const domainsRouter = Router();

const TRY_AGAIN = "Não conseguimos ativar o endereço agora. Tente de novo em alguns minutos.";
const RESERVED = new Set([
  "www", "app", "api", "admin", "painel", "dashboard", "mail", "email", "smtp", "ftp",
  "blog", "ajuda", "suporte", "status", "cdn", "static", "wagoo", "shopwag",
]);

type AddressView = { host: string | null; status: "off" | "manual" | "pending" | "active" };

function lojaId(locals: Record<string, unknown>) {
  return (locals.merchant as MerchantLocals).lojaId;
}

function vercelReady() {
  return Boolean(config.vercel.token && config.vercel.projectId);
}

async function vercel(path: string, init: RequestInit = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.vercel.teamId) url.searchParams.set("teamId", config.vercel.teamId);
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${config.vercel.token}`, "content-type": "application/json" },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

function hostFor(slug: string) {
  if (!config.storeDomain || RESERVED.has(slug) || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return null;
  return `${slug}.${config.storeDomain}`;
}

async function loadStore(id: string) {
  const { data } = await supabaseAdmin()!.from("lojas").select("slug, dominio").eq("id", id).maybeSingle();
  return data as { slug: string; dominio: string | null } | null;
}

async function view(host: string | null, activated: boolean): Promise<AddressView> {
  if (!host) return { host: null, status: "off" };
  if (!vercelReady()) return { host, status: "manual" };
  if (!activated) return { host, status: "pending" };
  const info = await vercel(`/v9/projects/${config.vercel.projectId}/domains/${host}`);
  return { host, status: info.ok && info.data.verified === true ? "active" : "pending" };
}

domainsRouter.get("/", requireMerchant, async (_req, res) => {
  const store = await loadStore(lojaId(res.locals));
  const host = store ? hostFor(store.slug) : null;
  res.json(await view(host, Boolean(host && store?.dominio === host)));
});

/** Liga {slug}.STORE_DOMAIN ao projeto da Vercel. Chamado ao salvar a loja ou trocar o endereço. */
domainsRouter.post("/sync", requireMerchant, async (_req, res) => {
  const id = lojaId(res.locals);
  const store = await loadStore(id);
  const host = store ? hostFor(store.slug) : null;
  if (!store || !host) {
    res.json(await view(null, false));
    return;
  }
  if (!vercelReady()) {
    res.json(await view(host, false));
    return;
  }
  const project = config.vercel.projectId;
  if (store.dominio && store.dominio !== host) {
    await vercel(`/v9/projects/${project}/domains/${store.dominio}`, { method: "DELETE" });
  }
  if (store.dominio !== host) {
    const added = await vercel(`/v10/projects/${project}/domains`, { method: "POST", body: JSON.stringify({ name: host }) });
    const code = (added.data.error as { code?: string } | undefined)?.code;
    if (!added.ok && code !== "domain_already_in_use" && code !== "domain_already_exists") {
      console.error("[domains] vercel recusou", added.status, JSON.stringify(added.data).slice(0, 300));
      res.status(502).json({ error: TRY_AGAIN });
      return;
    }
    const { error } = await supabaseAdmin()!.from("lojas").update({ dominio: host }).eq("id", id);
    if (error) {
      console.error("[domains] falha ao salvar", error.message);
      res.status(500).json({ error: TRY_AGAIN });
      return;
    }
  }
  res.json(await view(host, true));
});
