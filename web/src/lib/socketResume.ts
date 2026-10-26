/** Restore a suspended phone's transport and request the latest server state. */
export function resumeOnWake(reconnect: () => void, refresh: () => void) {
   const visible = () => {
      if (document.visibilityState !== "hidden") reconnect();
   };
   const focus = () => {
      if (document.visibilityState !== "hidden") refresh();
   };
   const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) visible();
      else focus();
   };
   document.addEventListener("visibilitychange", visible);
   window.addEventListener("online", visible);
   window.addEventListener("focus", focus);
   window.addEventListener("pageshow", pageshow);
   return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", pageshow);
   };
}
