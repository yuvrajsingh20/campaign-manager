"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Megaphone, LogOut, Radio } from "lucide-react";
import { AuthUser } from "@/types";
import { Badge } from "./ui/Badge";

function NavbarContent() {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  useEffect(() => {
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
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      router.push("/login");
    }
  };

  const isSuperadmin = currentUser?.role === "SUPERADMIN";

  const navItems = [
    ...(isSuperadmin
      ? [{ label: "Organisations", href: "/admin", icon: Building2, show: true }]
      : []),
    { label: "Campaigns", href: "/", icon: Megaphone, show: true },
  ];

  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-40 text-slate-900 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center space-x-6 sm:space-x-8">
            <Link
              href={isSuperadmin ? "/admin" : "/"}
              className="flex items-center space-x-2.5 font-semibold text-slate-900 hover:text-blue-600 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Radio className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">Campaign Manager</span>
            </Link>

            <nav className="flex space-x-1">
              {navItems
                .filter((item) => item.show)
                .map((item) => {
                  const isActive =
                    item.href === "/"
                      ? pathname === "/" || pathname.startsWith("/campaigns")
                      : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.label}
                    </Link>
                  );
                })}
            </nav>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            {currentUser ? (
              <>
                <div className="hidden sm:flex flex-col text-right">
                  <div className="flex items-center justify-end space-x-1.5">
                    <span className="font-medium text-slate-900">
                      {isSuperadmin
                        ? "Superadmin"
                        : currentUser.organization?.name || "Organisation"}
                    </span>
                    <Badge variant={isSuperadmin ? "purple" : "success"} className="text-[10px] py-0 px-2">
                      {currentUser.role}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-slate-500 truncate max-w-[200px]">
                    {currentUser.email}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign out"
                  className="px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors cursor-pointer text-xs font-medium flex items-center gap-1.5 shadow-2xs"
                >
                  <LogOut className="w-3.5 h-3.5 text-slate-500" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export function Navbar() {
  return (
    <Suspense
      fallback={
        <header className="border-b border-slate-200 bg-white sticky top-0 z-40 h-16 flex items-center">
          <div className="max-w-7xl mx-auto px-4 w-full flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Campaign Manager</span>
          </div>
        </header>
      }
    >
      <NavbarContent />
    </Suspense>
  );
}
