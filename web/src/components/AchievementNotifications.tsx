import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAuth } from "@/context/AuthContext";
import { useGame } from "@/context/GameContext";
import { useMultiplayer } from "@/context/MultiplayerContext";
import {
   ACHIEVEMENT_EVENT,
   computeAchievements,
   loadAchievements,
   syncMusicAchievement,
   type ComputedAchievement,
} from "@/lib/achievements";
import { readStorage, writeStorage } from "@/lib/storage";
import styles from "@/styles/achievements.module.css";

const MAX_VISIBLE_TOASTS = 3;

export function AchievementNotifications() {
   const { user } = useAuth();
   return user ? <AccountNotifications key={user.id} userId={user.id} /> : null;
}

function AccountNotifications({ userId }: { userId: string }) {
   const { game } = useGame();
   const { game: multiplayer } = useMultiplayer();
   const [notice, setNotice] = useState<ComputedAchievement[]>([]);
   const seenRef = useRef<Set<string> | null>(null);
   const [refresh, setRefresh] = useState(0);
   useEffect(() => {
      const update = () => setRefresh((value) => value + 1);
      window.addEventListener(ACHIEVEMENT_EVENT, update);
      window.addEventListener("online", update);
      window.addEventListener("focus", update);
      return () => {
         window.removeEventListener(ACHIEVEMENT_EVENT, update);
         window.removeEventListener("online", update);
         window.removeEventListener("focus", update);
      };
   }, []);
   const finished = game?.phase === "game_over" ? game.id : null;
   const multiplayerFinished =
      multiplayer?.phase === "game_over" ? multiplayer.id : null;
   useEffect(() => {
      const controller = new AbortController();
      const key = `euchre.achievements-seen.v1:${encodeURIComponent(userId)}`;
      void syncMusicAchievement(userId).catch(() => {});
      void loadAchievements(userId, controller.signal)
         .then(({ results, unlocks }) => {
            if (controller.signal.aborted) return;
            const earned = computeAchievements(results, unlocks).filter(
               (badge) => badge.earned
            );
            const raw = readStorage<unknown>(key, null);
            const initialized = seenRef.current !== null || Array.isArray(raw);
            const seen = new Set(seenRef.current);
            if (Array.isArray(raw))
               raw.forEach((id) => {
                  if (typeof id === "string") seen.add(id);
               });
            const fresh = earned.filter((badge) => !seen.has(badge.unlockId));
            // The first visit seeds existing achievements without a burst of old notices.
            if (initialized && fresh.length)
               setNotice((previous) => [...previous, ...fresh]);
            earned.forEach((badge) => {
               seen.add(badge.unlockId);
               if (badge.tiers && badge.tier) {
                  for (const tier of ["bronze", "silver", "gold"]) {
                     seen.add(`${badge.id}_${tier}`);
                     if (tier === badge.tier) break;
                  }
               }
            });
            seenRef.current = seen;
            writeStorage(key, [...seen]);
         })
         .catch(() => {});
      return () => controller.abort();
   }, [userId, refresh, finished, multiplayerFinished]);
   useEffect(() => {
      if (!notice.length) return;
      const timer = window.setTimeout(
         () => setNotice((previous) => previous.slice(MAX_VISIBLE_TOASTS)),
         3000
      );
      return () => window.clearTimeout(timer);
   }, [notice]);
   if (!notice.length) return null;
   const visible = notice.slice(0, MAX_VISIBLE_TOASTS);
   const extra = notice.length - visible.length;
   return createPortal(
      <div
         role="status"
         aria-live="polite"
         aria-atomic="true"
         className={styles.toastStack}
      >
         {visible.map((badge, index) => (
            <div key={badge.unlockId} className={styles.toast}>
               <FontAwesomeIcon
                  icon={badge.icon}
                  className={styles.toastIcon}
                  data-tier={badge.tier}
               />
               <div className={styles.toastText}>
                  <div className={styles.toastLabel}>Achievement Unlocked!</div>
                  <div className={styles.toastName}>{badge.name}</div>
                  {index === visible.length - 1 && extra > 0 && (
                     <div className={styles.toastMore}>+{extra} more</div>
                  )}
               </div>
               <button
                  type="button"
                  className={styles.toastDismiss}
                  aria-label={`Dismiss ${badge.name} achievement notification`}
                  onClick={() =>
                     setNotice((previous) => {
                        return previous.filter(
                           (item) => item.unlockId !== badge.unlockId
                        );
                     })
                  }
               >
                  ×
               </button>
            </div>
         ))}
      </div>,
      document.body
   );
}
