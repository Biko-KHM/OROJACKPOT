/**
 * Safe Telegram WebApp Haptic & Vibration feedback utility
 * Works inside Telegram Mini App webviews (iOS/Android/Desktop)
 * and gracefully falls back to browser navigator.vibrate or no-op.
 */

interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

export const triggerHaptic = (
  type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' = 'light',
) => {
  try {
    if (typeof window !== 'undefined') {
      const tg = window.Telegram?.WebApp as unknown as { HapticFeedback?: TelegramHapticFeedback } | undefined;
      const hf = tg?.HapticFeedback;

      if (hf) {
        if (type === 'selection') {
          hf.selectionChanged();
        } else if (type === 'success' || type === 'warning' || type === 'error') {
          hf.notificationOccurred(type);
        } else {
          hf.impactOccurred(type);
        }
        return;
      }
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      if (type === 'success') {
        navigator.vibrate([20, 40, 20]);
      } else if (type === 'warning' || type === 'error') {
        navigator.vibrate([40, 40, 40]);
      } else if (type === 'selection') {
        navigator.vibrate(8);
      } else {
        navigator.vibrate(15);
      }
    }
  } catch {
    // Ignore environments where vibration/haptics are blocked
  }
};
