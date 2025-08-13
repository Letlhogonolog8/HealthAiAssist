@echo off
echo Checking Windows Firewall for Node.js...
echo.

echo Current firewall rules for Node.js:
netsh advfirewall firewall show rule name="Node.js" dir=in
echo.

echo To allow Node.js through firewall, run as Administrator:
echo netsh advfirewall firewall add rule name="Node.js" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes
echo.

echo Or use Windows Defender Firewall GUI:
echo 1. Open Windows Defender Firewall
echo 2. Click "Allow an app or feature through Windows Defender Firewall"
echo 3. Click "Change Settings" then "Allow another app..."
echo 4. Browse to Node.js executable and add it
echo.

pause