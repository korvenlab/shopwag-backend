import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

let admin: SupabaseClient | null = null;

/** Cliente service role. Só existe no servidor; ignora RLS. */
export function supabaseAdmin(): SupabaseClient | null {
  if (!config.supabaseSecretKey) return null;
  admin ??= createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
