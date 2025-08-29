// hooks/useUIState.ts
import { useState, useEffect, useCallback } from 'react';

interface UIState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
}

interface UIStateActions {
  setIsLoading: (loading: boolean) => void;
  showError: (message: string, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  clearMessages: () => void;
  withLoading: <T>(fn: () => Promise<T>) => Promise<T>;
}

export const useUIState = (): UIState & UIStateActions => {
  // Device detection state
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  
  // UI feedback state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Timer refs for auto-clear
  const [errorTimer, setErrorTimer] = useState<NodeJS.Timeout | null>(null);
  const [successTimer, setSuccessTimer] = useState<NodeJS.Timeout | null>(null);

  // Device detection effect
  useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
      setIsTablet(width >= 768 && width < 1024);
      setIsDesktop(width >= 1024);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (errorTimer) clearTimeout(errorTimer);
      if (successTimer) clearTimeout(successTimer);
    };
  }, [errorTimer, successTimer]);

  // Show error message with auto-clear
  const showError = useCallback((message: string, duration = 5000) => {
    // Clear existing timer
    if (errorTimer) {
      clearTimeout(errorTimer);
      setErrorTimer(null);
    }
    
    setError(message);
    
    if (duration > 0) {
      const timer = setTimeout(() => {
        setError(null);
        setErrorTimer(null);
      }, duration);
      setErrorTimer(timer);
    }
  }, [errorTimer]);

  // Show success message with auto-clear
  const showSuccess = useCallback((message: string, duration = 3000) => {
    // Clear existing timer
    if (successTimer) {
      clearTimeout(successTimer);
      setSuccessTimer(null);
    }
    
    setSuccessMessage(message);
    
    if (duration > 0) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
        setSuccessTimer(null);
      }, duration);
      setSuccessTimer(timer);
    }
  }, [successTimer]);

  // Clear all messages
  const clearMessages = useCallback(() => {
    setError(null);
    setSuccessMessage(null);
    
    if (errorTimer) {
      clearTimeout(errorTimer);
      setErrorTimer(null);
    }
    
    if (successTimer) {
      clearTimeout(successTimer);
      setSuccessTimer(null);
    }
  }, [errorTimer, successTimer]);

  // Wrapper for async operations with loading state
  const withLoading = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setIsLoading(true);
    clearMessages();
    
    try {
      const result = await fn();
      return result;
    } catch (error) {
      // Re-throw to allow handling in component
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [clearMessages]);

  return {
    // State
    isMobile,
    isTablet,
    isDesktop,
    isLoading,
    error,
    successMessage,
    
    // Actions
    setIsLoading,
    showError,
    showSuccess,
    clearMessages,
    withLoading,
  };
};

// Additional helper hook for common UI patterns
export const useLoadingState = (initialState = false) => {
  const [loading, setLoading] = useState(initialState);
  const [loadingMessage, setLoadingMessage] = useState<string>('');

  const startLoading = (message = '') => {
    setLoading(true);
    setLoadingMessage(message);
  };

  const stopLoading = () => {
    setLoading(false);
    setLoadingMessage('');
  };

  const withLoadingState = async <T,>(
    fn: () => Promise<T>,
    message = ''
  ): Promise<T> => {
    startLoading(message);
    try {
      return await fn();
    } finally {
      stopLoading();
    }
  };

  return {
    loading,
    loadingMessage,
    startLoading,
    stopLoading,
    withLoadingState,
  };
};