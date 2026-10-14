import { config } from "../config";

/** Taxa de serviço da Shopwag, sempre paga pelo cliente. */
export const PLATFORM_FEE_PERCENT = 2;

/** Taxa Pix padrão do Mercado Pago até a primeira cobrança real recalibrar. */
export const DEFAULT_PIX_FEE_PERCENT = 0.99;

/** Taxas de cartão do Checkout Pro com recebimento na hora, até a primeira venda recalibrar. */
export const DEFAULT_CREDIT_FEE_PERCENT = 4.98;
export const DEFAULT_DEBIT_FEE_PERCENT = 3.99;

/** Taxa de serviço sobre produtos + frete. */
export function serviceFeeCents(baseCents: number) {
  const base = Math.max(0, Math.round(baseCents));
  if (base <= 0) return 0;
  return Math.max(1, Math.round((base * PLATFORM_FEE_PERCENT) / 100));
}

/**
 * Quanto o cliente paga: produtos + frete + taxa de serviço e, quando a loja repassa a taxa do
 * cartão, essa taxa por cima de tudo, para a loja receber o valor do catálogo.
 */
export function chargeBreakdown(baseCents: number, cardFeePercent: number | null) {
  const base = Math.max(0, Math.round(baseCents));
  const service = serviceFeeCents(base);
  const subtotal = base + service;
  if (cardFeePercent == null || subtotal <= 0) return { service, cardFee: 0, total: subtotal };
  const denom = 1 - cardFeePercent / 100;
  if (denom <= 0) throw new Error("Taxa de cartão inválida para repasse.");
  const total = Math.ceil(subtotal / denom);
  return { service, cardFee: total - subtotal, total };
}

/** O Mercado Pago recusa marketplace_fee quando a loja é a própria conta da aplicação. */
export function applicationFeeForStore(storeUserId: string, feeCents: number) {
  const platform = config.mp.platformUserId || config.mp.accessToken.match(/-(\d+)$/)?.[1] || "";
  return platform && platform === storeUserId ? 0 : feeCents;
}
