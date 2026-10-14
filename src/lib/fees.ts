import { config } from "../config";

/** Percentual que fica com a Shopwag em cada pagamento. */
export const PLATFORM_FEE_PERCENT = 1;

/** Taxa Pix padrão do Mercado Pago até a primeira cobrança real recalibrar. */
export const DEFAULT_PIX_FEE_PERCENT = 0.99;

/** Taxas de cartão do Checkout Transparente com recebimento na hora, até a primeira venda recalibrar. */
export const DEFAULT_CREDIT_FEE_PERCENT = 4.98;
export const DEFAULT_DEBIT_FEE_PERCENT = 3.99;

export function computeApplicationFeeCents(amountCents: number) {
  if (amountCents <= 0) return 0;
  const fee = Math.round((amountCents * PLATFORM_FEE_PERCENT) / 100);
  if (fee < 1 && amountCents >= 2) return 1;
  if (fee >= amountCents) return Math.max(0, amountCents - 1);
  return fee;
}

/**
 * Valor com as taxas por cima: depois do Mercado Pago descontar a taxa do meio de
 * pagamento e o 1% da Shopwag, a loja fica com o valor do catálogo.
 */
export function totalWithFeesCents(baseCents: number, methodFeePercent: number) {
  const base = Math.max(0, Math.round(baseCents));
  if (base <= 0) return 0;
  const denom = 1 - methodFeePercent / 100 - PLATFORM_FEE_PERCENT / 100;
  if (denom <= 0) throw new Error("Taxa inválida para repasse.");
  return Math.ceil(base / denom);
}

/** O Mercado Pago recusa application_fee quando a loja é a própria conta da aplicação. */
export function applicationFeeForStore(storeUserId: string, feeCents: number) {
  const platform = config.mp.platformUserId || config.mp.accessToken.match(/-(\d+)$/)?.[1] || "";
  return platform && platform === storeUserId ? 0 : feeCents;
}
