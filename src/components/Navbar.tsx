"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PhoneCall, LayoutDashboard, ShieldCheck, LogOut } from "lucide-react";
import { AuthUser } from "@/types";

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
    { label: "Campaigns", href: "/", icon: LayoutDashboard, show: true },
    ...(isSuperadmin
      ? [{ label: "Superadmin Portal", href: "/admin", icon: ShieldCheck, show: true }]
      : []),
  ];

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center space-x-6 sm:space-x-8">
            <Link href={isSuperadmin ? "/admin" : "/"} className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
                <PhoneCall className="w-5 h-5" />
              </div>
              <span className="font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
                Campaign Manager
              </span>
            </Link>

            <nav className="flex space-x-1">
              {navItems
                .filter((item) => item.show)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {item.label}
                    </Link>
                  );
                })}
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            {currentUser ? (
              <>
                <div className="hidden sm:flex flex-col text-right">
                  <div className="flex items-center justify-end space-x-2">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {isSuperadmin
                        ? "Superadmin"
                        : currentUser.organization?.name || "Company Portal"}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                        isSuperadmin
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      }`}
                    >
                      {currentUser.role}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {currentUser.email}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
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
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 sticky top-0 z-50 h-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
                <PhoneCall className="w-5 h-5" />
              </div>
              <span className="font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
                Campaign Manager
              </span>
            </div>
          </div>
        </header>
      }
    >
      <NavbarContent />
    </Suspense>
  );
}

