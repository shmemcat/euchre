import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
import { InProgressGames } from "@/components/InProgressGames";
import { useSavedGames } from "@/hooks/useSavedGames";
import styles from "@/styles/play-menu.module.css";
export default function Play() {
   const navigate = useNavigate();
   const saved = useSavedGames();
   return (
      <>
         <Helmet>
            <title>Play | Euchre</title>
         </Helmet>
         <PageLayout title="PLAY">
            <div className={styles.grid}>
               <Link to="/game/create" className={styles.choice}>
                  <span className={styles.choiceLabel}>Create Game</span>
                  <span className={styles.choiceDesc}>
                     Start a new game against bots or online
                  </span>
               </Link>
               <Link to="/game/join" className={styles.choice}>
                  <span className={styles.choiceLabel}>Join Game</span>
                  <span className={styles.choiceDesc}>
                     Enter a lobby code to join a friend
                  </span>
               </Link>
            </div>
            <InProgressGames
               games={saved.games}
               error={saved.error}
               onRetry={saved.retry}
               onResume={async (id) => {
                  const destination = await saved.resume(id);
                  if (destination) navigate(destination);
               }}
               onConcede={saved.concede}
            />
            <div className="button-stack" style={{ marginTop: 28 }}>
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
