/**
 * Top navigation.
 *
 * Three things were wrong here beyond the styling.
 *
 * The bar was `bg-blue-900` while every section beneath it is slate-950. That is
 * why it read as a strip pasted on top of the page rather than part of it — the
 * page has one accent (cyan) and the navigation was using a different hue
 * entirely, at full saturation, above a near-black body.
 *
 * The "AI Performance" link pointed at `/#features`, and no element with that id
 * exists — the performance section is `id="performance"`. The link scrolled
 * nowhere and had done since the section was renamed.
 *
 * The "Learn More" button had no handler at all — a control styled as a button
 * that did nothing when pressed. It is removed rather than given a destination,
 * because the page it would have pointed at was already reachable: "About AI"
 * sat two links to its left. The link list is now the only navigation, which is
 * also what lets the bar breathe.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, LogIn, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import LoginDialog from "./login-dialog";

interface NavigationProps {
  user?: any;
  onLoginSuccess?: (user: any) => void;
  /**
   * Lets the page own the login dialog.
   *
   * The homepage renders its own LoginDialog for the hero's "Access platform"
   * button, and this component rendered a second one — two instances of the same
   * dialog, with separate form state, mounted at once. When a page passes this,
   * no second dialog is created.
   */
  onLoginClick?: () => void;
  /**
   * Keeps the bar opaque instead of fading in on scroll.
   *
   * The transparent-until-scrolled behaviour assumes a dark hero underneath —
   * the bar's text is white and its links slate-400. On a page that follows the
   * theme, that means white-on-white at the top of the light theme. Pages
   * without a dark hero pass this and get a solid dark header bar, which reads
   * as deliberate over either theme.
   */
  solid?: boolean;
}

const NAV_LINKS = [
  { href: "/", label: "Home", kind: "route" as const },
  { href: "performance", label: "AI Performance", kind: "anchor" as const },
  { href: "detection", label: "Coverage", kind: "anchor" as const },
  { href: "/genomics", label: "Genomics", kind: "route" as const },
  { href: "/about", label: "About", kind: "route" as const },
];

export default function Navigation({
  user,
  onLoginSuccess,
  onLoginClick,
  solid = false,
}: NavigationProps) {
  const [location] = useLocation();
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // The bar is transparent over the hero and gains a background once the page
  // moves, so the hero reads as full-bleed instead of starting under a band.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openLogin = () => (onLoginClick ? onLoginClick() : setShowLoginDialog(true));

  return (
    <>
      <nav
        className={`sticky top-0 z-50 transition-colors duration-300 ${
          solid || scrolled
            ? "bg-slate-950/85 backdrop-blur-md border-b border-slate-800"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-10">
              <Link href="/" className="flex items-center gap-2.5 group">
                <span className="grid place-items-center w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 group-hover:border-cyan-500/60 transition-colors">
                  <Activity className="h-4 w-4 text-cyan-400" />
                </span>
                <span className="text-[15px] font-semibold tracking-tight text-white">
                  Health<span className="text-cyan-400">AI</span>
                </span>
              </Link>

              <div className="hidden md:flex items-center gap-1">
                {NAV_LINKS.map((link) =>
                  link.kind === "anchor" ? (
                    <button
                      key={link.href}
                      onClick={() => scrollToSection(link.href)}
                      className="px-3 py-2 text-sm text-slate-400 hover:text-white rounded-md hover:bg-slate-800/60 transition-colors"
                    >
                      {link.label}
                    </button>
                  ) : (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-3 py-2 text-sm rounded-md transition-colors ${
                        location === link.href
                          ? "text-white bg-slate-800/60"
                          : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                      }`}
                    >
                      {link.label}
                    </Link>
                  )
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle className="bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" />
              {!user && (
                <Button
                  onClick={openLogin}
                  size="sm"
                  className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold h-9 px-4"
                >
                  <LogIn className="w-4 h-4 mr-1.5" />
                  Sign in
                </Button>
              )}

              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden text-slate-300 hover:text-white hover:bg-slate-800"
                    aria-label="Open menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="bg-slate-950 border-slate-800 w-72">
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-[15px] font-semibold text-white">
                      Health<span className="text-cyan-400">AI</span>
                    </span>
                    <SheetClose asChild>
                      <Button variant="ghost" size="icon" className="text-slate-400" aria-label="Close menu">
                        <X className="h-4 w-4" />
                      </Button>
                    </SheetClose>
                  </div>
                  <div className="flex flex-col gap-1">
                    {NAV_LINKS.map((link) => (
                      <SheetClose asChild key={link.href}>
                        {link.kind === "anchor" ? (
                          <button
                            onClick={() => scrollToSection(link.href)}
                            className="text-left px-3 py-2.5 text-slate-300 hover:text-white hover:bg-slate-900 rounded-md transition-colors"
                          >
                            {link.label}
                          </button>
                        ) : (
                          <Link
                            href={link.href}
                            className="px-3 py-2.5 text-slate-300 hover:text-white hover:bg-slate-900 rounded-md transition-colors"
                          >
                            {link.label}
                          </Link>
                        )}
                      </SheetClose>
                    ))}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </nav>

      {/* Only when the page has not taken ownership of it. */}
      {!onLoginClick && (
        <LoginDialog
          open={showLoginDialog}
          onOpenChange={setShowLoginDialog}
          onLoginSuccess={onLoginSuccess || (() => {})}
        />
      )}
    </>
  );
}
