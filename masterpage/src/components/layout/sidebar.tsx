"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { navigation } from "@/config/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

function isNavActive(pathname: string, searchParams: URLSearchParams, href: string) {
  const [path, query = ""] = href.split("?");
  if (pathname !== path && !pathname.startsWith(`${path}/`)) return false;
  if (!query) return pathname === path || pathname.startsWith(`${path}/`);
  const expected = new URLSearchParams(query);
  for (const [key, value] of expected.entries()) {
    if (searchParams.get(key) !== value) return false;
  }
  return true;
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200 bg-[#111827] text-slate-100">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EB0A1E] font-black text-white">
            T
          </div>
          <div>
            <p className="text-sm font-bold">{t("appName")}</p>
            <p className="text-xs text-slate-400">{t("appSubtitle")}</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navigation.map((section) => (
          <div key={section.key} className="mb-5">
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {t(section.key)}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isNavActive(pathname, searchParams, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-[#EB0A1E] text-white shadow-lg shadow-[#EB0A1E]/20"
                        : "text-slate-300 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{t(item.key)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
