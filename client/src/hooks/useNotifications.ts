import { useEffect, useState } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState(Notification.permission);

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        setPermission(permission);
      });
    }
  }, []);

  function showNotification(title: string, options?: NotificationOptions) {
    if (permission === 'granted') {
      new Notification(title, options);
    }
  }

  return { permission, showNotification };
}
