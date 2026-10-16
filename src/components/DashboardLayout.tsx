"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  Megaphone,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Radio,
  Zap,
} from "lucide-react";
import { AuthUser } from "@/types";
import { Badge } from "./ui/Badge";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  currentUser?: AuthUser | null;
}

export function DashboardLayout({
  children,
  title,
  breadcrumbs = [],
  actions,
  currentUser: initialUser,
}: DashboardLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(initialUser || null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (initialUser) return;
    let ignore = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.success && data?.data?.user) {
          setCurrentUser(data.data.user);
        }
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [initialUser]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      router.push("/login");
    } finally {
      setLoggingOut(false);
    }
  };

  const isSuperadmin = currentUser?.role === "SUPERADMIN";

  const navigationItems = isSuperadmin
    ? [
        {
          name: "Organisations",
          href: "/admin",
          icon: Building2,
          current: pathname.startsWith("/admin"),
        },
        {
          name: "Campaigns",
          href: "/",
          icon: Megaphone,
          current: pathname === "/" || pathname.startsWith("/campaigns"),
        },
      ]
    : [
        {
          name: "Campaigns",
          href: "/",
          icon: Megaphone,
          current: pathname === "/" || pathname.startsWith("/campaigns"),
        },
      ];

  const orgRps = currentUser?.organization?.maxRequestsPerSecond;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      {/* Brand logo & title */}
      <div className="h-16 flex items-center px-6 border-b border-slate-200/80">
        <Link
          href={isSuperadmin ? "/admin" : "/"}
          className="flex items-center gap-3 group"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs group-hover:bg-blue-700 transition-colors">
            <Radio className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-900 leading-tight">
              Campaign Manager
            </span>
            <span className="text-[11px] text-slate-500 font-normal">
              Outbound Voice Engine
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation links */}
      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Navigation
        </div>
        {navigationItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                item.current
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              <Icon
                className={`w-4 h-4 ${
                  item.current ? "text-blue-600" : "text-slate-400"
                }`}
              />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>

      {/* Organisation context pill (if org user) */}
      {currentUser && (
        <div className="p-4 border-t border-slate-200/80 bg-slate-50/50 space-y-3">
          <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Tenant Context</span>
              <Badge
                variant={isSuperadmin ? "purple" : "success"}
                className="text-[10px] px-2 py-0"
              >
                {isSuperadmin ? "Superadmin" : currentUser.role}
              </Badge>
            </div>
            <div className="font-semibold text-slate-900 text-xs truncate">
              {isSuperadmin
                ? "Platform Control Plane"
                : currentUser.organization?.name || "My Organisation"}
            </div>
            {orgRps !== undefined && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                <Zap className="w-3 h-3 text-amber-500 shrink-0" />
                <span>Limit: <strong>{orgRps} req/sec</strong></span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex flex-col truncate pr-2">
              <span className="text-xs font-medium text-slate-800 truncate">
                {currentUser.name || currentUser.email.split("@")[0]}
              </span>
              <span className="text-[11px] text-slate-400 truncate">
                {currentUser.email}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans text-slate-900">
      {/* Desktop Sidebar (fixed 260px) */}
      <aside className="hidden lg:block w-64 shrink-0 fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-white shadow-xl z-50">
            <div className="absolute top-4 right-4 z-10">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Area (offset by sidebar width on desktop) */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumbs or Title */}
            {breadcrumbs.length > 0 ? (
              <nav className="flex items-center gap-1.5 text-sm text-slate-500 overflow-hidden truncate">
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <React.Fragment key={idx}>
                      {idx > 0 && (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      {crumb.href && !isLast ? (
                        <Link
                          href={crumb.href}
                          className="hover:text-slate-900 transition-colors font-medium truncate"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span
                          className={`truncate ${
                            isLast ? "font-semibold text-slate-900" : ""
                          }`}
                        >
                          {crumb.label}
                        </span>
                      )}
                    </React.Fragment>
                  );
                })}
              </nav>
            ) : title ? (
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">
                {title}
              </h1>
            ) : null}
          </div>

          {/* Right Header items */}
          <div className="flex items-center gap-3 shrink-0">
            {actions}

            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-200">
                <div className="flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-900 truncate max-w-[150px]">
                    {currentUser.name || currentUser.email}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase font-medium">
                    {isSuperadmin
                      ? "Superadmin"
                      : currentUser.organization?.name || "Organization"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
