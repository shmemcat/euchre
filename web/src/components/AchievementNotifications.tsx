import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useGame } from "@/context/GameContext";
import { useMultiplayer } from "@/context/MultiplayerContext";
import {
   ACHIEVEMENT_EVENT,
   computeAchievements,
   loadAchievements,
   syncMusicAchievement,
} from "@/lib/achievements";
import { readStorage, writeStorage } from "@/lib/storage";
import styles from "@/styles/achievements.module.css";

export function AchievementNotifications() {
   const { user } = useAuth();
   const { game } = useGame();
   const { game: multiplayer } = useMultiplayer();
   const [notice, setNotice] = useState<{
      userId: string;
      names: string[];
   } | null>(null);
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
      if (!user) return;
      const controller = new AbortController();
      const key = `euchre.achievements-seen.v1:${encodeURIComponent(user.id)}`;
      void syncMusicAchievement(user.id).catch(() => {});
      void loadAchievements(user.id, controller.signal)
         .then(({ results, unlocks }) => {
            if (controller.signal.aborted) return;
            const earned = computeAchievements(results, unlocks).filter(
               (badge) => badge.earned
            );
            const raw = readStorage<unknown>(key, null);
            const seen = new Set(
               Array.isArray(raw)
                  ? raw.filter((id): id is string => typeof id === "string")
                  : []
            );
            const fresh = earned.filter((badge) => !seen.has(badge.unlockId));
            // The first visit seeds existing achievements without a burst of old notices.
            if (Array.isArray(raw) && fresh.length)
               setNotice({
                  userId: user.id,
                  names: fresh.map((badge) => badge.name),
               });
            earned.forEach((badge) => {
               seen.add(badge.unlockId);
               if (badge.tiers && badge.tier) {
                  for (const tier of ["bronze", "silver", "gold"]) {
                     seen.add(`${badge.id}_${tier}`);
                     if (tier === badge.tier) break;
                  }
               }
            });
            writeStorage(key, [...seen]);
         })
         .catch(() => {});
      return () => controller.abort();
   }, [user?.id, refresh, finished, multiplayerFinished]);
   useEffect(() => {
      if (!notice) return;
      const timer = window.setTimeout(() => setNotice(null), 9000);
      return () => window.clearTimeout(timer);
   }, [notice]);
   if (!notice || notice.userId !== user?.id) return null;
   return (
      <div role="status" aria-live="polite" className={styles.toast}>
         <div>
            <strong>
               Achievement{notice.names.length > 1 ? "s" : ""} unlocked
            </strong>
            <p>
               {notice.names.slice(0, 3).join(" · ")}
               {notice.names.length > 3
                  ? ` · and ${notice.names.length - 3} more`
                  : ""}
            </p>
         </div>
         <button
            type="button"
            aria-label="Dismiss achievement notification"
            onClick={() => setNotice(null)}
         >
            ×
         </button>
      </div>
   );
}
