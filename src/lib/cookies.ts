import { cookies } from "next/headers";
import { isUiLang, type UiLang } from "@/lib/ui";

export const UI_LANG_COOKIE = "leady_ui_lang";
export const ADMIN_COOKIE = "leady_admin";
export const TENANT_COOKIE = "leady_tenant_id";

export async function getUiLang(): Promise<UiLang> {
  const jar = await cookies();
  const raw = jar.get(UI_LANG_COOKIE)?.value;
  return isUiLang(raw) ? raw : "he";
}
