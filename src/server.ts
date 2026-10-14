import cors from "cors";
import express from "express";
import { config } from "./config";
import { mercadopagoRouter } from "./routes/mercadopago";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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

app.use((_req, res) => {
  res.status(404).json({ error: "Não encontrado" });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`shopwag-backend ouvindo em 0.0.0.0:${config.port}`);
});
