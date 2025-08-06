// WebSocket utility functions to handle URL construction properly
export function getWebSocketUrl(): string {
  try {
    // Get the proper host and port for WebSocket connection
    let host = window.location.hostname;
    let port = window.location.port;
    
    // Handle undefined port
    if (!port || port === 'undefined') {
      port = window.location.protocol === 'https:' ? '443' : '80';
    }
    
    // Use backend port 5000 for WebSocket in development
    if (host === 'localhost' && (port === '5173' || port === '80')) {
      port = '5000';
    }
    
    // Validate host
    if (!host || host.includes('undefined')) {
      console.warn('Invalid host detected, using localhost');
      host = 'localhost';
      port = '5000';
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}:${port}/ws`;
    
    // Validate URL before returning
    try {
      new URL(wsUrl);
      return wsUrl;
    } catch (urlError) {
      console.error('Invalid WebSocket URL constructed:', wsUrl);
      // Fallback to a safe default
      return 'ws://localhost:5000/ws';
    }
  } catch (error) {
    console.error('Error constructing WebSocket URL:', error);
    return 'ws://localhost:5000/ws';
  }
}

export function isWebSocketSupported(): boolean {
  return typeof WebSocket !== 'undefined';
}