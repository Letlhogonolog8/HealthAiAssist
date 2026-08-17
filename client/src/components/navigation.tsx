import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Heart, Search, LogIn, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import LoginDialog from "./login-dialog";

interface NavigationProps {
  user?: any;
  onLoginSuccess?: (user: any) => void;
}

export default function Navigation({ user, onLoginSuccess }: NavigationProps) {
  const [location] = useLocation();
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/#features", label: "AI Performance" },
    { href: "/#detection", label: "Cancer Types" },
    { href: "/genomics", label: "Genomics" },
    { href: "/about", label: "About AI" },
  ];

  const handleNavClick = (href: string) => {
    if (href.startsWith("/#")) {
      const elementId = href.substring(2);
      const element = document.getElementById(elementId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  return (
    <>
      <nav className="bg-blue-900 border-b border-blue-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Link href="/" className="flex items-center space-x-2">
                <Heart className="h-8 w-8 text-cyan-500" />
                <span className="text-xl font-bold text-white">HAI</span>
              </Link>
              <div className="hidden md:flex space-x-6">
                {navLinks.map((link) => (
                  <div key={link.href}>
                    {link.href.startsWith("/#") ? (
                      <button
                        onClick={() => handleNavClick(link.href)}
                        className="text-blue-200 hover:text-white transition-colors duration-200 font-medium"
                      >
                        {link.label}
                      </button>
                    ) : (
                      <Link
                        href={link.href}
                        className={`transition-colors duration-200 font-medium ${
                          location === link.href
                            ? "text-white"
                            : "text-blue-200 hover:text-white"
                        }`}
                      >
                        {link.label}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:flex bg-blue-700 hover:bg-blue-600 text-white border-blue-600 hover:border-blue-500"
              >
                <Search className="w-4 h-4 mr-2" />
                Learn More
              </Button>
              {!user && (
                <Button
                  onClick={() => setShowLoginDialog(true)}
                  size="sm"
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  Login
                </Button>
              )}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden text-white">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="bg-blue-900 border-blue-800">
                  <div className="flex flex-col space-y-4 mt-8">
                    {navLinks.map((link) => (
                      <div key={link.href}>
                        {link.href.startsWith("/#") ? (
                          <button
                            onClick={() => handleNavClick(link.href)}
                            className="text-blue-200 hover:text-white transition-colors duration-200 font-medium text-left w-full"
                          >
                            {link.label}
                          </button>
                        ) : (
                          <Link
                            href={link.href}
                            className={`block transition-colors duration-200 font-medium ${
                              location === link.href
                                ? "text-white"
                                : "text-blue-200 hover:text-white"
                            }`}
                          >
                            {link.label}
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </nav>

      <LoginDialog
        open={showLoginDialog}
        onOpenChange={setShowLoginDialog}
        onLoginSuccess={onLoginSuccess || (() => {})}
      />
    </>
  );
}
