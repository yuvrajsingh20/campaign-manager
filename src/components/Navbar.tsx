"use client";

import React from "react";
import Link from "next/link";
import { PhoneCall, LayoutDashboard, Megaphone, Users, Settings } from "lucide-react";

export function Navbar() {
  const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard, active: true },
    { label: "Campaigns", href: "/campaigns", icon: Megaphone, active: false },
    { label: "Contacts", href: "/contacts", icon: Users, active: false },
    { label: "Settings", href: "/settings", icon: Settings, active: false },
  ];

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm">
                <PhoneCall className="w-5 h-5" />
              </div>
              <span className="font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
                Campaign Manager
              </span>
            </Link>

            <nav className="hidden md:flex space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      item.active
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

          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Acme Inc</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Default Workspace</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 flex items-center justify-center text-xs font-semibold">
              AI
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

