import cors from "cors";
import express from "express";
import { config } from "./config";
import { supabaseAdmin } from "./lib/supabase";
import { domainsRouter } from "./routes/domains";
import { mercadopagoRouter } from "./routes/mercadopago";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));

app.get("/health", async (_req, res) => {
  const admin = supabaseAdmin();
  if (!admin) {
    res.json({ ok: true, database: "missing_secret" });
    return;
  }
  const { error } = await admin.from("lojas").select("id", { head: true, count: "exact" }).limit(1);
  res.json({ ok: true, database: error ? "error" : "ok" });
});

// O webhook é chamado pelo Mercado Pago, sem Origin do navegador.
app.use(
  "/api/mercadopago",
  cors({
    origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)),
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type"],
  }),
  mercadopagoRouter,
);

app.use(
  "/api/domains",
  cors({
    origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)),
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"],
  }),
  domainsRouter,
);

app.use((_req, res) => {
  res.status(404).json({ error: "Não encontrado" });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`shopwag-backend ouvindo em 0.0.0.0:${config.port}`);
});
