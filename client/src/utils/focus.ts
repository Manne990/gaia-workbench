export function restoreFocus(element: HTMLElement | null, fallback?: () => HTMLElement | null): void {
  window.setTimeout(() => {
    const target = element?.isConnected ? element : fallback?.();
    target?.focus();
  }, 0);
}
