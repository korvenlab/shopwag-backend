import { Router } from "express";
import { config } from "../config";
import { requireMerchant, type MerchantLocals } from "../lib/auth";
import { supabaseAdmin } from "../lib/supabase";

export const domainsRouter = Router();

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const RESERVED = /(^|\.)(vercel\.app|onrender\.com|shopwag\.com\.br)$/;
const TRY_AGAIN = "Não conseguimos configurar o domínio agora. Tente de novo em alguns minutos.";

type DomainStatus = "none" | "pending" | "active" | "manual";
type DomainView = {
  dominio: string | null;
  status: DomainStatus;
  records: Array<{ type: string; name: string; value: string }>;
};

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

function dnsRecords(domain: string) {
  const labels = domain.split(".").length;
  const secondLevel = /\.(com|net|org|art|blog|eco|app|tec|ind|adv)\.br$/.test(domain);
  return labels === (secondLevel ? 3 : 2)
    ? [{ type: "A", name: "@", value: "76.76.21.21" }]
    : [{ type: "CNAME", name: domain.split(".")[0], value: "cname.vercel-dns.com" }];
}

async function view(domain: string | null): Promise<DomainView> {
  if (!domain) return { dominio: null, status: "none", records: [] };
  const records = dnsRecords(domain);
  if (!vercelReady()) return { dominio: domain, status: "manual", records };
  const project = config.vercel.projectId;
  const [info, dns] = await Promise.all([
    vercel(`/v9/projects/${project}/domains/${domain}`),
    vercel(`/v6/domains/${domain}/config`),
  ]);
  const verification = Array.isArray(info.data.verification)
    ? (info.data.verification as Array<{ type: string; domain: string; value: string }>).map((item) => ({
        type: item.type,
        name: item.domain,
        value: item.value,
      }))
    : [];
  const active = info.ok && info.data.verified === true && dns.ok && dns.data.misconfigured === false;
  return { dominio: domain, status: active ? "active" : "pending", records: [...records, ...verification] };
}

async function currentDomain(id: string) {
  const admin = supabaseAdmin();
  const { data } = await admin!.from("lojas").select("dominio").eq("id", id).maybeSingle();
  return (data?.dominio as string | null) ?? null;
}

domainsRouter.get("/", requireMerchant, async (_req, res) => {
  res.json(await view(await currentDomain(lojaId(res.locals))));
});

domainsRouter.put("/", requireMerchant, async (req, res) => {
  const id = lojaId(res.locals);
  const domain = String((req.body ?? {}).dominio ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!DOMAIN.test(domain) || RESERVED.test(domain)) {
    res.status(400).json({ error: "Confira o domínio. Exemplo: www.sualoja.com.br" });
    return;
  }
  const previous = await currentDomain(id);
  const admin = supabaseAdmin()!;
  const { error } = await admin.from("lojas").update({ dominio: domain }).eq("id", id);
  if (error) {
    const taken = error.code === "23505";
    if (!taken) console.error("[domains] falha ao salvar", error.message);
    res.status(taken ? 409 : 500).json({ error: taken ? "Esse domínio já está em uso por outra loja." : TRY_AGAIN });
    return;
  }
  if (vercelReady()) {
    const project = config.vercel.projectId;
    if (previous && previous !== domain) await vercel(`/v9/projects/${project}/domains/${previous}`, { method: "DELETE" });
    const added = await vercel(`/v10/projects/${project}/domains`, { method: "POST", body: JSON.stringify({ name: domain }) });
    const code = (added.data.error as { code?: string } | undefined)?.code;
    if (!added.ok && code !== "domain_already_in_use" && code !== "domain_already_exists") {
      console.error("[domains] vercel recusou", added.status, JSON.stringify(added.data).slice(0, 300));
      await admin.from("lojas").update({ dominio: previous }).eq("id", id);
      res.status(502).json({ error: added.status === 409 ? "Esse domínio já está ligado a outro site." : TRY_AGAIN });
      return;
    }
  }
  res.json(await view(domain));
});

domainsRouter.delete("/", requireMerchant, async (_req, res) => {
  const id = lojaId(res.locals);
  const previous = await currentDomain(id);
  if (previous && vercelReady()) {
    await vercel(`/v9/projects/${config.vercel.projectId}/domains/${previous}`, { method: "DELETE" });
  }
  await supabaseAdmin()!.from("lojas").update({ dominio: null }).eq("id", id);
  res.json(await view(null));
});
