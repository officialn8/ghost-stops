'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useIsMobile, useIsTablet, useIsDesktop } from '@/hooks/useMediaQuery';

interface ResponsiveContextType {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

const ResponsiveContext = createContext<ResponsiveContextType | undefined>(undefined);

export function useResponsive() {
  const context = useContext(ResponsiveContext);
  if (!context) {
    throw new Error('useResponsive must be used within ResponsiveProvider');
  }
  return context;
}

interface ResponsiveProviderProps {
  children: ReactNode;
}

export function ResponsiveProvider({ children }: ResponsiveProviderProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isDesktop = useIsDesktop();

  return (
    <ResponsiveContext.Provider value={{ isMobile, isTablet, isDesktop }}>
      {children}
    </ResponsiveContext.Provider>
  );
}