import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";

/**
 * 404.
 *
 * The page background was `bg-gray-50`, hardcoded, so under the dark theme a
 * near-white sheet framed a dark card — the one place a visitor lands when
 * something has already gone wrong.
 *
 * The body text read "Did you forget to add the page to the router?", which is a
 * note from one developer to another, shown to whoever mistyped a URL.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-7 w-7 text-red-500 shrink-0" />
            <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            That address does not match anything on this platform. It may have moved,
            or the link may be incomplete.
          </p>

          <Link href="/">
            <Button variant="outline" className="mt-6">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to the home page
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
