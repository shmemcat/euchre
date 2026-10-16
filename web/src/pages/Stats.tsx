import { useState } from "react";
import { Helmet } from "react-helmet-async";
import {
   faTrophy,
   faStars,
   faMoon,
   faShield,
   faCrown,
} from "@fortawesome/pro-solid-svg-icons";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
import { AchievementBadge } from "@/components/AchievementBadge";
import { readResults } from "@/lib/persistence";
import achievementStyles from "@/styles/achievements.module.css";
export default function Stats() {
   const results = readResults();
   const [tab, setTab] = useState("all");
   const selected = results.filter(
      (r) =>
         tab === "all" ||
         (tab === "hard"
            ? ["hard", "harder", "hardest"].includes(r.difficulty)
            : r.difficulty === tab)
   );
   const wins = selected.filter((r) => r.won).length;
   const sum = (field: "marches" | "loners" | "euchres") =>
      selected.reduce((total, r) => total + r[field], 0);
   let streak = 0;
   for (const r of [...selected].reverse()) {
      if (!r.won) break;
      streak++;
   }
   const achievements = [
      {
         name: "First Light",
         desc: "Win your first game",
         icon: faTrophy,
         earned: results.some((r) => r.won),
      },
      {
         name: "Written in the Stars",
         desc: "Win ten games",
         icon: faStars,
         earned: results.filter((r) => r.won).length >= 10,
      },
      {
         name: "Lone Star",
         desc: "Sweep a hand going alone",
         icon: faMoon,
         earned: results.some((r) => r.loners > 0),
      },
      {
         name: "A Clean Sweep",
         desc: "March with your partner",
         icon: faCrown,
         earned: results.some((r) => r.marches > 0),
      },
      {
         name: "Turn the Tables",
         desc: "Euchre the opposing team",
         icon: faShield,
         earned: results.some((r) => r.euchres > 0),
      },
      {
         name: "Stargazer",
         desc: "Win on Hardest",
         icon: faStars,
         earned: results.some((r) => r.won && r.difficulty === "hardest"),
      },
   ];
   return (
      <>
         <Helmet>
            <title>Statistics | Euchre</title>
         </Helmet>
         <PageLayout title="STATISTICS">
            <div className="statistics-body">
               <div
                  className="stats-tabs"
                  role="group"
                  aria-label="Filter statistics"
               >
                  {["all", "easy", "medium", "hard"].map((value) => (
                     <button
                        type="button"
                        key={value}
                        aria-pressed={tab === value}
                        onClick={() => setTab(value)}
                     >
                        {value}
                     </button>
                  ))}
               </div>
               <dl className="stats-panel">
                  {[
                     ["Played", selected.length],
                     ["Won", wins],
                     [
                        "Win Rate",
                        selected.length
                           ? `${Math.round((wins / selected.length) * 100)}%`
                           : "—",
                     ],
                     ["Current Streak", streak],
                     ["Marches", sum("marches")],
                     ["Lone Sweeps", sum("loners")],
                     ["Euchres", sum("euchres")],
                     ["Conceded", selected.filter((r) => r.conceded).length],
                  ].map(([label, value]) => (
                     <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                     </div>
                  ))}
               </dl>
               <section
                  className={achievementStyles.achievementsPanel}
                  aria-labelledby="achievements-title"
               >
                  <h2
                     id="achievements-title"
                     className={achievementStyles.achievementsTitle}
                  >
                     Achievements
                  </h2>
                  <div className={achievementStyles.achievementsGrid}>
                     {achievements.map((a) => (
                        <AchievementBadge key={a.name} achievement={a} />
                     ))}
                  </div>
               </section>
            </div>
            <div className="button-stack">
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
