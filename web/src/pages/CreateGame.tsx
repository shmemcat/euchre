import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { LoginWarning } from "@/components/LoginWarning";
import { useGame } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import containers from "@/styles/containers.module.css";
import { useMultiplayer } from "@/context/MultiplayerContext";
export default function CreateGame() {
   const navigate = useNavigate();
   const { preferences } = usePreferences();
   const { user, loading: authLoading } = useAuth();
   const { start, loading: gameLoading } = useGame();
   const [difficulty, setDifficulty] = useState("easy");
   const [gameType, setGameType] = useState("bots");
   const [name, setName] = useState("");
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState("");
   const multi = useMultiplayer();
   const checking = !!authLoading || !!gameLoading;
   const create = async () => {
      await start(
         difficulty === "hard"
            ? preferences.hardLevel
            : (difficulty as "easy" | "medium"),
         user?.name ?? "You"
      );
      navigate("/game/single-play");
   };
   const createOnline = async () => {
      setBusy(true);
      setError("");
      try {
         const reply = await multi.command({
            type: "create",
            name: user?.name || name.trim() || "Host",
            difficulty: user ? preferences.hardLevel : "hard",
         });
         navigate(`/game/lobby/${reply.code}`);
      } catch (e) {
         setError((e as Error).message);
         setBusy(false);
      }
   };
   const createSolo = async () => {
      setBusy(true);
      setError("");
      try {
         await create();
      } catch (e) {
         setError((e as Error).message);
         setBusy(false);
      }
   };
   return (
      <>
         <Helmet>
            <title>Play | Euchre</title>
         </Helmet>
         <PageLayout title="CREATE GAME">
            <div className="create-body">
               <h2>Game Type</h2>
               <div className={containers["create-button-container"]}>
                  <label>
                     <input
                        type="radio"
                        name="gameType"
                        value="bots"
                        checked={gameType === "bots"}
                        onChange={() => setGameType("bots")}
                     />
                     <span>Versus Bots</span>
                  </label>
                  <label>
                     <input
                        type="radio"
                        name="gameType"
                        value="online"
                        checked={gameType === "online"}
                        onChange={() => setGameType("online")}
                     />
                     <span>Online</span>
                  </label>
               </div>
               {gameType === "online" && !user && (
                  <label className="multiplayer-name">
                     Your name
                     <input
                        value={name}
                        maxLength={20}
                        placeholder="Host"
                        onChange={(e) => setName(e.target.value)}
                     />
                  </label>
               )}
               {gameType === "bots" && (
                  <>
                     <fieldset className="difficulty-fieldset">
                        <legend>Bot Difficulty</legend>
                        <div className={containers["create-button-container"]}>
                           {["easy", "medium", "hard"].map((value) => (
                              <label key={value}>
                                 <input
                                    type="radio"
                                    name="difficulty"
                                    value={value}
                                    checked={difficulty === value}
                                    onChange={() => setDifficulty(value)}
                                 />
                                 <span>{value}</span>
                              </label>
                           ))}
                        </div>
                     </fieldset>
                  </>
               )}
               {gameType === "online" && (
                  <p className="quiet-text">
                     {multi.connected ? (
                        <>
                           Invite friends via the lobby link or code.
                           <br />
                           Empty seats are filled by bots.
                        </>
                     ) : (
                        multi.error || "Connecting…"
                     )}
                  </p>
               )}
               <div className="button-stack">
                  <Button
                     name={busy ? "Starting…" : "Create Game"}
                     disabled={
                        busy ||
                        checking ||
                        (gameType === "online" && !multi.connected)
                     }
                     style={{ height: 50 }}
                     onClick={() =>
                        gameType === "online"
                           ? void createOnline()
                           : void createSolo()
                     }
                  />
                  <LoginWarning />
                  <MenuLink to="/" name="Home" />
               </div>
               {checking && (
                  <p role="status">
                     {multi.error || "Checking for an active game…"}
                  </p>
               )}
               {error && (
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
               )}
            </div>
         </PageLayout>
      </>
   );
}
