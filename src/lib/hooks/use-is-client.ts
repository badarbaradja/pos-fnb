import { useSyncExternalStore } from "react";

function subscribeNoop() {
  return () => {};
}

/**
 * true hanya di klien, false saat SSR -- dipakai supaya createPortal tidak
 * dipanggil dengan `document` yang belum ada saat render server.
 * useSyncExternalStore (bukan useState+useEffect) supaya tidak kena lint
 * react-hooks/set-state-in-effect untuk pola "tandai sudah mount" ini.
 * Diekstrak dari cart-panel.tsx (T12) -- dipakai ulang oleh komponen
 * mobile T18b yang juga portal ke document.body.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}
