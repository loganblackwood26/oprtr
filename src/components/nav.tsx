"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, Home, KanbanSquare, MessageSquare, Settings, Users } from "lucide-react";
import clsx from "clsx";

const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, badge: true, hideFor: ["crew"] },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings, hideFor: ["crew"] },
];

export function Nav({ pending, role, mobile }: { pending: number; role: string; mobile?: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => !i.hideFor?.includes(role));
  return (
    <nav className={clsx(mobile ? "flex justify-around h-16" : "flex flex-col gap-0.5")}>
      {items.map(({ href, label, icon: Icon, badge }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "relative flex items-center gap-3 rounded-xl text-[15px] transition-colors",
              mobile ? "flex-col justify-center gap-1 text-[11px] flex-1" : "px-3 h-10",
              active ? "text-accent font-medium" : "text-ink-2 hover:bg-surface-2",
              active && !mobile && "bg-accent-soft/60",
            )}
          >
            <Icon className={mobile ? "h-5 w-5" : "h-[18px] w-[18px]"} />
            <span>{label}</span>
            {badge && pending > 0 && (
              <span className={clsx("absolute bg-accent text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center", mobile ? "top-1 right-[calc(50%-20px)]" : "right-3")}>{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
