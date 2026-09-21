"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant={locale === "en" ? "default" : "outline"}
          size="sm"
          onClick={() => setLocale("en")}
        >
          EN
        </Button>
        <Button
          variant={locale === "ar" ? "default" : "outline"}
          size="sm"
          onClick={() => setLocale("ar")}
        >
          AR
        </Button>
        <Button variant="ghost" size="sm">
          {t("logout")}
        </Button>
      </div>
    </header>
  );
}
