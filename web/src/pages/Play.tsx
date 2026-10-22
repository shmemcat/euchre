import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
import { ActiveGameModal } from "@/components/ActiveGameModal";
import { useGame } from "@/context/GameContext";
import { useMultiplayer } from "@/context/MultiplayerContext";
import { useActiveGameSession } from "@/hooks/useActiveGameSession";
import styles from "@/styles/play-menu.module.css";

export default function Play() {
   const navigate = useNavigate();
   const multi = useMultiplayer();
   const { concedeGame } = useGame();
   const { session: currentSession, checking } = useActiveGameSession();
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState("");
   const [leavingSession, setLeavingSession] =
      useState<typeof currentSession>(null);
   const session = leavingSession ?? currentSession;
   const blocked = !!session || checking || busy;
   const leaveSession = async () => {
      if (!session || busy) return;
      setBusy(true);
      setError("");
      setLeavingSession(session);
      try {
         if (session.type === "solo") concedeGame();
         else await multi.command({ type: "leave", code: session.code });
      } catch (e) {
         setError((e as Error).message);
      } finally {
         setBusy(false);
         setLeavingSession(null);
      }
   };
   return (
      <>
         <Helmet>
            <title>Play | Euchre</title>
         </Helmet>
         <PageLayout title="PLAY">
            <div className={styles.grid}>
               {[
                  {
                     to: "/game/create",
                     label: "Create Game",
                     desc: "Start a new game against bots or online",
                  },
                  {
                     to: "/game/join",
                     label: "Join Game",
                     desc: "Enter a lobby code to join a friend",
                  },
               ].map((c) => (
                  <Link
                     key={c.to}
                     to={c.to}
                     className={styles.choice}
                     aria-disabled={blocked || undefined}
                     tabIndex={blocked ? -1 : undefined}
                     onClick={(event) => {
                        if (blocked) event.preventDefault();
                     }}
                  >
                     <span className={styles.choiceLabel}>{c.label}</span>
                     <span className={styles.choiceDesc}>{c.desc}</span>
                  </Link>
               ))}
            </div>
            <div className="button-stack" style={{ marginTop: 28 }}>
               <MenuLink to="/" name="Home" />
            </div>
            {checking && !session && (
               <p role="status">
                  {multi.error || "Checking for an active game…"}
               </p>
            )}
            {error && !session && (
               <p className="inline-error" role="alert">
                  {error}
               </p>
            )}
         </PageLayout>
         {session && (
            <ActiveGameModal
               key={session.key}
               title={
                  session.type === "solo"
                     ? "Game In Progress"
                     : session.playing
                     ? "Multiplayer Game In Progress"
                     : "Lobby In Progress"
               }
               message={
                  session.type === "solo"
                     ? "You have a game active. Do you wish to continue playing?"
                     : session.playing
                     ? "You have a multiplayer game in progress. Rejoin?"
                     : session.status === "finished"
                     ? "Your online group is between games. Rejoin?"
                     : session.status === "playing"
                     ? "You are waiting in an online lobby for the next game. Rejoin?"
                     : "You have an active lobby. Rejoin?"
               }
               continueLabel={session.type === "solo" ? "Continue" : "Rejoin"}
               leaveLabel={session.type === "solo" ? "Concede" : "Leave"}
               confirmMessage={
                  session.type === "solo"
                     ? "Are you sure you wish to concede? This game will count as a loss."
                     : session.playing
                     ? "Are you sure you want to leave the game? A bot will take your seat, and this game will count as a loss."
                     : "Are you sure you want to leave the lobby?"
               }
               busy={busy}
               leaveDisabled={session.type === "online" && !multi.connected}
               error={error}
               onContinue={() =>
                  navigate(
                     session.type === "solo"
                        ? "/game/single-play"
                        : session.playing
                        ? `/game/multi-play/${session.code}`
                        : `/game/lobby/${session.code}`
                  )
               }
               onLeave={() => void leaveSession()}
            />
         )}
      </>
   );
}
