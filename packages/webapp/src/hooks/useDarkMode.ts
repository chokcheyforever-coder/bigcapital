import { css } from '@emotion/css';
import { useState, useEffect } from 'react';

export const useIsDarkMode = () => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check initial state on mount
    if (typeof window === 'undefined') return false;

    return (
      document.documentElement.classList.contains('bp4-dark') ||
      document.body.classList.contains('bp4-dark')
    );
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkDarkMode = () => {
      const hasDarkClass =
        document.documentElement.classList.contains('bp4-dark') ||
        document.body.classList.contains('bp4-dark');
      setIsDarkMode(hasDarkClass);
    };

    // Create observer to watch for class changes on html and body elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          checkDarkMode();
        }
      });
    });

    // Observe both html and body elements for class changes
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Initial check
    checkDarkMode();

    // Cleanup observer on unmount
    return () => {
      observer.disconnect();
    };
  }, []);

  return isDarkMode;
};

/**
 * 103 DiTech: switches the theme and remembers it in this browser
 * (read by public/preload-theme.js on the next load).
 */
export const setThemeMode = (mode: 'light' | 'dark') => {
  try {
    localStorage.setItem('theme', mode);
  } catch {
    // Private mode: the choice lasts until the page is reloaded.
  }
  document.documentElement.classList.toggle('bp4-dark', mode === 'dark');
  document.body.classList.toggle('bp4-dark', mode === 'dark');
};

export const darkMode = (styles: string) => css`
  .bp4-dark & {
    ${styles}
  }
`;
