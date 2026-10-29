import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { CategoryTabs, HardTabs } from "@/components/AccountSummary";
import { LeaderboardColumn } from "@/components/LeaderboardColumn";
import { useAuth } from "@/context/AuthContext";
import {
   fetchLeaderboard,
   syncLeaderboardResults,
   type LeaderboardCategory,
   type LeaderboardData,
} from "@/lib/leaderboard";
import styles from "@/styles/leaderboard.module.css";

export default function Leaderboard() {
   const [category, setCategory] = useState("easy");
   const [hard, setHard] = useState("hard");
   const { user } = useAuth();
   const selected = (
      category === "hard" ? hard : category
   ) as LeaderboardCategory;
   const [data, setData] = useState<LeaderboardData>({
      monthly: [],
      all_time: [],
   });
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState("");
   const [syncError, setSyncError] = useState("");
   const [retry, setRetry] = useState(0);
   useEffect(() => {
      const controller = new AbortController();
      setLoading(true);
      setError("");
      setSyncError("");
      const load = async () => {
         if (user && selected !== "multiplayer") {
            try {
               await syncLeaderboardResults(user.id);
            } catch {
               if (!controller.signal.aborted)
                  setSyncError(
                     "Your latest results couldn’t be saved. They’ll be retried when you reconnect."
                  );
            }
         }
         if (controller.signal.aborted) return;
         try {
            const result = await fetchLeaderboard(selected, controller.signal);
            if (!controller.signal.aborted) setData(result);
         } catch (error) {
            if (!controller.signal.aborted)
               setError(
                  error instanceof Error
                     ? error.message
                     : "Unable to load the leaderboard."
               );
         } finally {
            if (!controller.signal.aborted) setLoading(false);
         }
      };
      void load();
      return () => controller.abort();
   }, [selected, user?.id, retry]);
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
               includeAchievements
            />
            {category === "hard" && (
               <HardTabs value={hard} onChange={setHard} />
            )}
            {syncError && (
               <p role="status" className="quiet-text">
                  {syncError}
               </p>
            )}
            {loading ? (
               <p role="status" className={styles.empty}>
                  Loading…
               </p>
            ) : error ? (
               <div className="button-stack">
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
                  <Button
                     name="Try Again"
                     onClick={() => setRetry(retry + 1)}
                  />
               </div>
            ) : (
               <div
                  className={`${styles.columns} ${
                     category === "achievements"
                        ? styles.achievementStandings
                        : ""
                  }`}
               >
                  {(category === "achievements"
                     ? ["All-Time"]
                     : ["Monthly", "All-Time"]
                  ).map((title) => (
                     <LeaderboardColumn
                        key={`${category}-${hard}-${title}`}
                        title={title}
                        category={category === "hard" ? hard : category}
                        entries={
                           title === "Monthly" ? data.monthly : data.all_time
                        }
                     />
                  ))}
               </div>
            )}
            {category === "achievements" && (
               <p className={styles.note}>
                  Each earned tier counts separately.
               </p>
            )}
            <div className="button-stack">
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
