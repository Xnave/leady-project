import { cookies } from "next/headers";
import { isUiLang, isUiTheme, type UiLang, type UiTheme } from "@/lib/ui";

export const UI_LANG_COOKIE = "zapidly_ui_lang";
export const UI_THEME_COOKIE = "zapidly_ui_theme";
export const TENANT_COOKIE = "zapidly_tenant_id";

export async function getUiLang(): Promise<UiLang> {
  const jar = await cookies();
  const raw = jar.get(UI_LANG_COOKIE)?.value;
  return isUiLang(raw) ? raw : "he";
}

export async function getUiTheme(): Promise<UiTheme> {
  const jar = await cookies();
  const raw = jar.get(UI_THEME_COOKIE)?.value;
  return isUiTheme(raw) ? raw : "system";
}
