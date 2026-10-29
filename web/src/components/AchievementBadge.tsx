import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Sparkle } from "@/components/Sparkle";
import { Tooltip } from "@/components/Tooltip";
import styles from "@/styles/achievements.module.css";
import { faQuestion } from "@fortawesome/pro-solid-svg-icons";

type Achievement = {
   name: string;
   description: string;
   icon: IconDefinition;
   earned: boolean;
   secret?: boolean;
   tier?: "bronze" | "silver" | "gold";
   progress?: string;
};

export function AchievementBadge({
   achievement,
}: {
   achievement: Achievement;
}) {
   const [open, setOpen] = useState(false);
   const { earned, tier, progress, icon } = achievement;
   const iconTier = earned && !achievement.secret ? tier : undefined;
   const hidden = achievement.secret && !earned;
   const name = hidden ? "????" : achievement.name;
   const desc = hidden
      ? "This is a secret achievement"
      : achievement.description;
   const tierLabel =
      !hidden && tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : null;
   const status = earned ? `Unlocked${tier ? ` · ${tier}` : ""}` : "Locked";
   return (
      <div className={styles.achievementItem}>
         <Tooltip
            open={open}
            onOpenChange={setOpen}
            content={
               <div className={styles.tooltipContent}>
                  {tierLabel && (
                     <span className={styles.tooltipTier}>{tierLabel}</span>
                  )}
                  <span className={styles.tooltipName}>{name}</span>
                  <span className={styles.tooltipDesc}>{desc}</span>
                  {!hidden && progress && (
                     <span className={styles.tooltipDesc}>{progress}</span>
                  )}
               </div>
            }
         >
            <button
               type="button"
               className={`${styles.badge} ${
                  earned ? styles.badge_unlocked : styles.badge_locked
               }`}
               aria-label={
                  hidden ? "Secret achievement: Locked" : `${name}: ${status}`
               }
               onClick={() => setOpen(true)}
            >
               {earned && (
                  <>
                     <span className={styles.badgeShine} aria-hidden="true" />
                     <Sparkle className={styles.badgeSparkle} fill="white" />
                     <span
                        className={`${styles.badgeIcon} ${
                           iconTier ? styles[`badgeIcon_${iconTier}`] : ""
                        }`}
                     >
                        <FontAwesomeIcon icon={icon} />
                     </span>
                  </>
               )}
               {!earned && (
                  <span className={styles.badgeIcon} aria-hidden="true">
                     <FontAwesomeIcon icon={hidden ? faQuestion : icon} />
                  </span>
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
