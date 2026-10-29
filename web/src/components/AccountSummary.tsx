import { useEffect, useState } from "react";
import { ToggleButtonGroup } from "./ToggleButtonGroup";
import { AchievementBadge } from "./AchievementBadge";
import { readResults } from "@/lib/persistence";
import {
   ACHIEVEMENT_EVENT,
   computeAchievements,
   loadAchievements,
   settingsAchievements,
   type AchievementResult,
} from "@/lib/achievements";
import containers from "@/styles/containers.module.css";
import achievements from "@/styles/achievements.module.css";

export const CATEGORIES = ["easy", "medium", "hard", "multiplayer"] as const;
export const HARD_LEVELS = ["hard", "harder", "hardest"] as const;

export function CategoryTabs({
   value,
   onChange,
   label = "Statistics category",
   includeAchievements = false,
}: {
   value: string;
   onChange: (value: string) => void;
   label?: string;
   includeAchievements?: boolean;
}) {
   return (
      <div
         className={`${containers["stats-tabs"]} category-tabs`}
         role="group"
         aria-label={label}
      >
         {[...CATEGORIES, ...(includeAchievements ? ["achievements"] : [])].map(
            (category) => (
               <button
                  key={category}
                  type="button"
                  className={`${containers["stats-tab"]} ${
                     value === category ? containers["stats-tab-active"] : ""
                  }`}
                  aria-pressed={value === category}
                  aria-label={category}
                  onClick={() => onChange(category)}
               >
                  {category === "multiplayer" ? (
                     <>
                        <span className={containers["desktop-only"]}>
                           Multiplayer
                        </span>
                        <span className={containers["mobile-only"]}>
                           Multi-
                           <br />
                           player
                        </span>
                     </>
                  ) : (
                     category
                  )}
               </button>
            )
         )}
      </div>
   );
}
export function HardTabs({
   value,
   onChange,
}: {
   value: string;
   onChange: (value: string) => void;
}) {
   return (
      <div
         className={`${containers["stats-tabs"]} category-tabs`}
         role="group"
         aria-label="Hard difficulty"
      >
         {HARD_LEVELS.map((level) => (
            <button
               key={level}
               type="button"
               className={`${containers["stats-tab"]} ${
                  value === level ? containers["stats-tab-active"] : ""
               }`}
               aria-pressed={value === level}
               onClick={() => onChange(level)}
            >
               {level}
            </button>
         ))}
      </div>
   );
}

export function AccountSummary({ userId }: { userId: string }) {
   const [remote, setRemote] = useState<AchievementResult[]>([]);
   const [unlocks, setUnlocks] = useState<string[]>([]);
   const [statsError, setStatsError] = useState("");
   const [retry, setRetry] = useState(0);
   const [loading, setLoading] = useState(false);
   useEffect(() => {
      const controller = new AbortController();
      setLoading(true);
      setStatsError("");
      void loadAchievements(userId, controller.signal)
         .then((data) => {
            if (!controller.signal.aborted) {
               setRemote(data.results);
               setUnlocks(data.unlocks);
            }
         })
         .catch(() => {
            if (!controller.signal.aborted)
               setStatsError(
                  "Your statistics and achievements couldn’t be loaded."
               );
         })
         .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
         });
      return () => controller.abort();
   }, [userId, retry]);
   useEffect(() => {
      const refresh = () => setRetry((value) => value + 1);
      window.addEventListener(ACHIEVEMENT_EVENT, refresh);
      return () => window.removeEventListener(ACHIEVEMENT_EVENT, refresh);
   }, []);
   const all = [
      ...new Map(
         [...readResults(userId), ...remote].map((result) => [
            result.id,
            result,
         ])
      ).values(),
   ];
   const [mode, setMode] = useState("all_time");
   const [category, setCategory] = useState("easy");
   const [hard, setHard] = useState("hard");
   const completed = all.filter((result) => !result.conceded);
   const selected =
      mode === "all_time"
         ? completed
         : completed.filter(
              (result) =>
                 result.difficulty === (category === "hard" ? hard : category)
           );
   const won = selected.filter((result) => result.won).length;
   const scores = selected.map((result) => result.scores[0]);
   const rows = [
      [
         ["Games Played", selected.length],
         ["Games Won", won],
         [
            "Win Rate",
            selected.length
               ? `${Math.round((won / selected.length) * 100)}%`
               : "—",
         ],
      ],
      [
         [
            "Lone Sweeps",
            selected.reduce((total, result) => total + result.loners, 0),
         ],
         ["Best Score", scores.length ? Math.max(...scores) : "—"],
         ["Worst Score", scores.length ? Math.min(...scores) : "—"],
         [
            "Avg Score",
            scores.length
               ? (
                    scores.reduce((total, score) => total + score, 0) /
                    scores.length
                 ).toFixed(1)
               : "—",
         ],
      ],
   ];
   const badges = computeAchievements(all, [
      ...unlocks,
      ...settingsAchievements(userId),
   ]);
   return (
      <>
         {loading && (
            <p role="status" className="quiet-text">
               Loading statistics and achievements…
            </p>
         )}
         {statsError && (
            <p role="alert" className="inline-error">
               {statsError}{" "}
               <button className="link" onClick={() => setRetry(retry + 1)}>
                  Try again
               </button>
            </p>
         )}
         <ToggleButtonGroup
            options={[
               { value: "all_time", label: "All Time" },
               { value: "separate", label: "Separate" },
            ]}
            value={mode}
            onChange={setMode}
         />
         {mode === "separate" && (
            <>
               <CategoryTabs value={category} onChange={setCategory} />
               {category === "hard" && (
                  <HardTabs value={hard} onChange={setHard} />
               )}
            </>
         )}
         <div className={containers["stats-card"]} aria-label="Your statistics">
            <div className={containers["stats-grid"]}>
               {rows.map((column, index) => (
                  <div key={index} className={containers["stats-col"]}>
                     <dl className="account-stats-list">
                        {column.map(([label, value]) => (
                           <div key={label} className={containers["stats-row"]}>
                              <dt className={containers["stats-label"]}>
                                 {label}
                              </dt>
                              <dd className={containers["stats-value"]}>
                                 {value}
                              </dd>
                           </div>
                        ))}
                     </dl>
                  </div>
               ))}
            </div>
         </div>
         <section
            className={achievements.achievementsPanel}
            aria-labelledby="achievements-title"
         >
            <h2
               id="achievements-title"
               className={achievements.achievementsTitle}
            >
               Achievements
            </h2>
            <div className={achievements.achievementsGrid}>
               {badges.map((badge) => (
                  <AchievementBadge key={badge.id} achievement={badge} />
               ))}
            </div>
         </section>
      </>
   );
}
