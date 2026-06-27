'use client';

import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

export function Toast({ message, type, duration = 3000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    setTimeout(() => setIsVisible(true), 10);

    // Auto dismiss
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColor = {
    success: 'var(--success)',
    error: '#D32F2F',
    info: 'var(--primary)',
  }[type];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '100px',
        left: '50%',
        transform: isVisible ? 'translate(-50%, 0)' : 'translate(-50%, 20px)',
        opacity: isVisible ? 1 : 0,
        transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
        background: bgColor,
        color: 'white',
        padding: 'var(--space-3) var(--space-6)',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        zIndex: 'var(--z-toast)',
        maxWidth: '90vw',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
  };

  const ToastComponent = toast ? (
    <Toast
      message={toast.message}
      type={toast.type}
      onClose={() => setToast(null)}
    />
  ) : null;

  return { showToast, ToastComponent };
}
