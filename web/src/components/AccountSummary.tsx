import { useState } from "react";
import {
   faCardsBlank,
   faTrophy,
   faMoon,
   faCrown,
   faShield,
   faStars,
} from "@fortawesome/pro-solid-svg-icons";
import { ToggleButtonGroup } from "./ToggleButtonGroup";
import { AchievementBadge } from "./AchievementBadge";
import { readResults } from "@/lib/persistence";
import containers from "@/styles/containers.module.css";
import achievements from "@/styles/achievements.module.css";

export const CATEGORIES = ["easy", "medium", "hard", "multiplayer"] as const;
export const HARD_LEVELS = ["hard", "harder", "hardest"] as const;

export function CategoryTabs({
   value,
   onChange,
   label = "Statistics category",
}: {
   value: string;
   onChange: (value: string) => void;
   label?: string;
}) {
   return (
      <div
         className={`${containers["stats-tabs"]} category-tabs`}
         role="group"
         aria-label={label}
      >
         {CATEGORIES.map((category) => (
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
         ))}
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
   const all = readResults(userId);
   const [mode, setMode] = useState("all_time");
   const [category, setCategory] = useState("easy");
   const [hard, setHard] = useState("hard");
   const selected =
      mode === "all_time"
         ? all
         : all.filter(
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
   const badges = [
      {
         name: "Newcomer",
         desc: "Finish your first game",
         icon: faCardsBlank,
         earned: all.length > 0,
      },
      {
         name: "First Light",
         desc: "Win your first game",
         icon: faTrophy,
         earned: all.some((result) => result.won),
      },
      {
         name: "Written in the Stars",
         desc: "Win ten games",
         icon: faStars,
         earned: all.filter((result) => result.won).length >= 10,
      },
      {
         name: "Lone Star",
         desc: "Sweep a hand going alone",
         icon: faMoon,
         earned: all.some((result) => result.loners > 0),
      },
      {
         name: "A Clean Sweep",
         desc: "March with your partner",
         icon: faCrown,
         earned: all.some((result) => result.marches > 0),
      },
      {
         name: "Turn the Tables",
         desc: "Euchre the opposing team",
         icon: faShield,
         earned: all.some((result) => result.euchres > 0),
      },
      {
         name: "Stargazer",
         desc: "Win on Hardest",
         icon: faStars,
         earned: all.some(
            (result) => result.won && result.difficulty === "hardest"
         ),
      },
   ];
   return (
      <>
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
                  <AchievementBadge key={badge.name} achievement={badge} />
               ))}
            </div>
         </section>
      </>
   );
}
