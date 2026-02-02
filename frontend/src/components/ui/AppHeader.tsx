"use client";

import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

type AppHeaderProps = {
  currentPage: "analyze" | "vods" | "review";
  showReviewLink?: boolean;
};

type NavLinkProps = {
  href: string;
  isActive: boolean;
  children: React.ReactNode;
};

function NavLink({ href, isActive, children }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        isActive
          ? "bg-bg-surface text-fg-default"
          : "text-fg-muted hover:text-fg-default hover:bg-bg-hover"
      }`}
    >
      {children}
    </Link>
  );
}

export function AppHeader({ currentPage, showReviewLink = false }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-bg-base/80 backdrop-blur-sm border-b border-border-subtle">
      <div className="max-w-[1800px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold text-fg-default">
            ClipDetector
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/" isActive={currentPage === "analyze"}>
              Analyze
            </NavLink>
            <NavLink href="/vods" isActive={currentPage === "vods"}>
              VODs
            </NavLink>
            {showReviewLink && (
              <NavLink href="/review" isActive={currentPage === "review"}>
                Review
              </NavLink>
            )}
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
