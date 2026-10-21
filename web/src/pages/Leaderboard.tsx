import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
import { CategoryTabs, HardTabs } from "@/components/AccountSummary";
import styles from "@/styles/leaderboard.module.css";

export default function Leaderboard() {
   const [category, setCategory] = useState("easy");
   const [hard, setHard] = useState("hard");
   return (
      <>
         <Helmet>
            <title>Leaderboard | Euchre</title>
         </Helmet>
         <PageLayout title="LEADERBOARD" contentClassName="leaderboard-page">
            <CategoryTabs
               value={category}
               onChange={setCategory}
               label="Leaderboard category"
            />
            {category === "hard" && (
               <HardTabs value={hard} onChange={setHard} />
            )}
            <div className={styles.columns}>
               {["Monthly", "All-Time"].map((title) => (
                  <section
                     key={`${category}-${hard}-${title}`}
                     className={styles.column}
                     aria-label={`${title} leaderboard`}
                  >
                     <h2 className={styles.columnTitle}>{title}</h2>
                     <table
                        className="leaderboard-table"
                        aria-label={`${title} ${
                           category === "hard" ? hard : category
                        } winners`}
                     >
                        <thead className="sr-only">
                           <tr>
                              <th scope="col">Rank</th>
                              <th scope="col">Player</th>
                              <th scope="col">Wins</th>
                           </tr>
                        </thead>
                        <tbody>
                           <tr>
                              <td colSpan={3} className={styles.empty}>
                                 No winners yet
                              </td>
                           </tr>
                        </tbody>
                     </table>
                  </section>
               ))}
            </div>
            <div className="button-stack">
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
