import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Sparkle } from "@/components/Sparkle";
import { Tooltip } from "@/components/Tooltip";
import styles from "@/styles/achievements.module.css";

type Achievement = {
   name: string;
   desc: string;
   icon: IconDefinition;
   earned: boolean;
};

export function AchievementBadge({
   achievement: { name, desc, icon, earned },
}: {
   achievement: Achievement;
}) {
   const [open, setOpen] = useState(false);
   const status = earned ? "Unlocked" : "Locked";
   return (
      <div className={styles.achievementItem}>
         <Tooltip
            open={open}
            onOpenChange={setOpen}
            content={
               <div className={styles.tooltipContent}>
                  <span className={styles.tooltipName}>{name}</span>
                  <span className={styles.tooltipDesc}>{desc}</span>
                  <span className={styles.tooltipStatus}>{status}</span>
               </div>
            }
         >
            <button
               type="button"
               className={`${styles.badge} ${
                  earned ? styles.badge_unlocked : styles.badge_locked
               }`}
               aria-label={`${name}: ${status}`}
               onClick={() => setOpen((value) => !value)}
            >
               {earned && (
                  <>
                     <span className={styles.badgeShine} aria-hidden="true" />
                     <Sparkle className={styles.badgeSparkle} fill="white" />
                     <span className={styles.badgeIcon}>
                        <FontAwesomeIcon icon={icon} />
                     </span>
                  </>
               )}
            </button>
         </Tooltip>
         <span
            className={`${styles.achievementLabel} ${
               earned ? "" : styles.achievementLabel_locked
            }`}
         >
            {name}
         </span>
      </div>
   );
}
