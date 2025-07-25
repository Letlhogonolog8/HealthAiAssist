import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Copy, Check, Wifi, Signal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function MobileQRAccess() {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  
  // Get the current URL and construct the mobile-friendly URL
  const currentHost = window.location.host;
  // Replace localhost with server IP for mobile access using environment variable
  const serverIp = import.meta.env.VITE_SERVER_IP || '192.168.0.154';
  const adjustedHost = currentHost.includes('localhost') ? currentHost.replace('localhost', serverIp) : currentHost;
  const mobileUrl = `http://${adjustedHost}:5000`;
  
  // Fix double port issue in QR code URL
  const qrCodeData = mobileUrl.replace(/:5000:5000$/, ':5000');
  // Update QR code URL to use the updated mobileUrl with correct IP
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCodeData)}&bgcolor=ffffff&color=1d4ed8&margin=10`;
  
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(mobileUrl);
      setCopied(true);
      toast({
        title: "URL Copied",
        description: "The mobile URL has been copied to your clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Copy Failed",
        description: "Please manually copy the URL",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <Smartphone className="w-5 h-5 text-blue-600" />
          Mobile Access
        </CardTitle>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Access MedAI on your mobile device
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* QR Code */}
        <div className="flex justify-center">
          <div className="p-4 bg-white rounded-lg border-2 border-gray-200">
            <img 
              src={qrCodeUrl} 
              alt="QR Code for Mobile Access" 
              className="w-48 h-48"
              onError={() => {
                // QR code fallback handled by CSS
              }}
            />
            <div className="hidden w-48 h-48 items-center justify-center bg-gray-100 rounded">
              <p className="text-sm text-gray-500 text-center">QR Code unavailable</p>
            </div>
          </div>
        </div>
        
        {/* Mobile URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Mobile URL:</label>
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              value={mobileUrl}
              readOnly
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-gray-50 dark:bg-gray-800"
            />
            <Button
              onClick={copyToClipboard}
              size="sm"
              variant="outline"
              className="touch-target"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        
        {/* Instructions */}
        <div className="space-y-3 text-sm">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Signal className="w-4 h-4" />
              Quick Access Steps:
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
              <li>Scan the QR code with your phone camera</li>
              <li>Or copy and paste the URL in your mobile browser</li>
              <li>Add to home screen for app-like experience</li>
              <li>Use login: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Tlhox</code> / <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">inw73KYI</code></li>
            </ol>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Wifi className="w-3 h-3" />
            <span>Requires internet connection</span>
          </div>
        </div>
        
        {/* Mobile Features Badge */}
        <div className="flex flex-wrap gap-2 justify-center">
          <Badge variant="secondary" className="text-xs">
            Touch Optimized
          </Badge>
          <Badge variant="secondary" className="text-xs">
            Responsive Design
          </Badge>
          <Badge variant="secondary" className="text-xs">
            PWA Ready
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}