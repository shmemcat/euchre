import { Navigate } from "react-router-dom";
import { TurnSoundOption } from "@/context/TurnSoundContext";
import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
import { Card } from "@/components/Card";
import { usePreferences } from "@/context/PreferencesContext";
import { useAuth } from "@/context/AuthContext";
import type { Card as CardCode } from "@/game/engine";
import styles from "@/styles/options.module.css";
const CARDS: CardCode[] = ["Jc", "Qh", "As"];
export default function Options() {
   const { preferences, update, saved } = usePreferences();
   const { user, loading } = useAuth();
   if (!user)
      return loading ? (
         <p role="status">Loading…</p>
      ) : (
         <Navigate to="/user" replace />
      );
   return (
      <>
         <Helmet>
            <title>Options | Euchre</title>
         </Helmet>
         <PageLayout title="OPTIONS">
            <div className="options-body">
               <section>
                  <h2>Card Style</h2>
                  <div className={styles.optionsGrid}>
                     {(["classic", "celestial"] as const).map((value) => (
                        <button
                           key={value}
                           type="button"
                           aria-pressed={preferences.cardStyle === value}
                           onClick={() => update({ cardStyle: value })}
                           className={`${styles.styleChoice} ${
                              preferences.cardStyle === value
                                 ? styles.styleChoiceActive
                                 : ""
                           }`}
                        >
                           <span className={styles.previewFan}>
                              {CARDS.map((code, i) => (
                                 <span
                                    key={code}
                                    style={{
                                       display: "block",
                                       marginLeft: i ? -18 : 0,
                                       transform: `rotate(${
                                          (i - 1) * 12
                                       }deg) translateY(${i === 1 ? -8 : 0}px)`,
                                    }}
                                 >
                                    <Card code={code} styleOverride={value} />
                                 </span>
                              ))}
                           </span>
                           <span className={styles.styleLabel}>
                              {value === "classic" ? "Standard" : "Celestial"}
                           </span>
                        </button>
                     ))}
                  </div>
               </section>
               <section className={styles.hardLevelSection}>
                  <h2>Hard Strength</h2>
                  <div className={styles.hardLevelGrid}>
                     {(["hard", "harder", "hardest"] as const).map((value) => (
                        <button
                           key={value}
                           type="button"
                           aria-pressed={preferences.hardLevel === value}
                           onClick={() => update({ hardLevel: value })}
                           className={`${styles.hardLevelChoice} ${
                              preferences.hardLevel === value
                                 ? styles.hardLevelChoiceActive
                                 : ""
                           }`}
                        >
                           <span className={styles.hardLevelLabel}>
                              {value}
                           </span>
                        </button>
                     ))}
                  </div>
               </section>
               <TurnSoundOption />
               {!saved && (
                  <p role="alert">
                     Your browser couldn’t save your preferences.
                  </p>
               )}
            </div>
            <div className="button-stack">
               <MenuLink to="/user" name="Back" />
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
