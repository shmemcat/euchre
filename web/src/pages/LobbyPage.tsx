import { useEffect, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faCopy,
   faCheck,
   faCrown,
   faRobot,
} from "@fortawesome/pro-solid-svg-icons";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import { useMultiplayer, type Lobby } from "@/context/MultiplayerContext";
import { getProfileIcon } from "@/lib/profileIcons";
import styles from "@/styles/lobby.module.css";

function TeamName({
   side,
   team,
   members,
   busy,
   save,
}: {
   side: number;
   team: Lobby["teams"][number];
   members: string[];
   busy: boolean;
   save: (name: string) => Promise<void>;
}) {
   const [editing, setEditing] = useState(!team.named);
   const [name, setName] = useState(team.named ? team.name : "");
   useEffect(() => {
      setName(team.named ? team.name : "");
      setEditing(!team.named);
   }, [team.name, team.named]);
   const submit = async (e: FormEvent) => {
      e.preventDefault();
      try {
         await save(name);
         setEditing(false);
      } catch {
         // The lobby shows the error; keep the draft open for another try.
      }
   };
   return (
      <section
         className={`lobby-team lobby-team-${side}`}
         aria-label={`Team ${side + 1}`}
      >
         <span className="lobby-team-label">Team {side + 1}</span>
         <strong className="lobby-team-name" aria-live="polite">
            {team.name}
         </strong>
         <span className="lobby-team-members">
            {members.length ? members.join(" & ") : "Waiting for teammates"}
         </span>
         {team.canName && editing ? (
            <form className="lobby-team-form" onSubmit={submit}>
               <label className="sr-only" htmlFor={`team-name-${side}`}>
                  Team {side + 1} name
               </label>
               <input
                  id={`team-name-${side}`}
                  placeholder="Name your team"
                  value={name}
                  maxLength={24}
                  required
                  onChange={(e) => setName(e.target.value)}
               />
               <button disabled={busy || !name.trim()} type="submit">
                  Save
               </button>
            </form>
         ) : team.canName ? (
            <button
               className="link lobby-team-edit"
               onClick={() => {
                  setName(team.name);
                  setEditing(true);
               }}
            >
               Edit team name
            </button>
         ) : (
            !team.named && (
               <span className="lobby-team-hint">
                  The first person on this team can name it.
               </span>
            )
         )}
      </section>
   );
}

export default function LobbyPage() {
   const { code: rawCode = "" } = useParams();
   const code = rawCode.toUpperCase();
   const multi = useMultiplayer();
   const { user } = useAuth();
   const { preferences } = usePreferences();
   const navigate = useNavigate();
   const [name, setName] = useState("");
   const [error, setError] = useState("");
   const [busy, setBusy] = useState(false);
   const [copied, setCopied] = useState("");
   const [difficulty, setDifficulty] = useState("easy");
   const [starting, setStarting] = useState(false);
   const [switching, setSwitching] = useState(false);
   const [leaving, setLeaving] = useState(false);
   const lobby = multi.lobby?.code === code ? multi.lobby : null;
   const inGroup = !!lobby && (lobby.isMember ?? lobby.seat !== null);
   const choosingSeats = lobby?.unseated ?? [];
   const botCount =
      lobby?.seats.filter((seat) => seat.status !== "human").length ?? 0;
   const hardDifficulty =
      lobby?.defaultDifficulty ?? (user ? preferences.hardLevel : "hard");
   const rearranging = choosingSeats.some((member) => member.reserved ?? true);
   const needsSwitch = !!multi.resumeCode && multi.resumeCode !== code;
   useEffect(() => {
      setError("");
   }, [lobby?.revision]);
   useEffect(() => {
      if (lobby?.memberName) setName(lobby.needsName ? "" : lobby.memberName);
   }, [lobby?.memberName, lobby?.needsName]);

   useEffect(() => {
      if (!multi.connected || needsSwitch || leaving) return;
      if (
         multi.lobby?.code === code &&
         (multi.lobby.isMember || multi.lobby.status === "closed")
      )
         return;
      void multi
         .command({ type: "watch", code })
         .catch((e) => setError(e.message));
   }, [
      code,
      multi.connected,
      needsSwitch,
      leaving,
      multi.lobby?.code,
      multi.lobby?.isMember,
      multi.lobby?.status,
      multi.command,
   ]);
   useEffect(() => {
      if (
         lobby?.seat !== null &&
         lobby?.seat !== undefined &&
         (lobby.status === "playing" || lobby.status === "finished")
      )
         navigate(`/game/multi-play/${code}`, { replace: true });
   }, [lobby?.status, lobby?.seat, code, navigate]);

   const run = async (data: Parameters<typeof multi.command>[0]) => {
      setBusy(true);
      setError("");
      try {
         await multi.command({ ...data, code });
      } catch (e) {
         setError((e as Error).message);
         throw e;
      } finally {
         setBusy(false);
      }
   };
   const fire = (data: Parameters<typeof multi.command>[0]) => {
      void run(data).catch(() => {});
   };
   const copy = async (value: string, type: string) => {
      try {
         await navigator.clipboard.writeText(value);
         setCopied(type);
      } catch {
         setError("Copy didn’t work. Select and copy the field instead.");
      }
   };
   const start = () => {
      fire({
         type: "start",
         difficulty:
            !botCount || difficulty === "hard"
               ? hardDifficulty
               : (difficulty as "easy" | "medium"),
      });
      setStarting(false);
   };
   const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(
      /\/$/,
      ""
   )}/game/lobby/${code}`;
   return (
      <>
         <Helmet>
            <title>Lobby | Euchre</title>
         </Helmet>
         <PageLayout title="GAME LOBBY">
            <div className={styles.lobbyContent}>
               {needsSwitch ? (
                  <div className="button-stack">
                     <p>You’re already in another lobby.</p>
                     <Button
                        name="Leave That Group & Join"
                        disabled={busy}
                        onClick={() => setSwitching(true)}
                     />
                     <MenuLink
                        to={`/game/lobby/${multi.resumeCode}`}
                        name="Return to Group"
                     />
                  </div>
               ) : (
                  <>
                     {!multi.connected && (
                        <p role="status">
                           {multi.error || "Connecting to the lobby…"}
                        </p>
                     )}
                     {lobby?.status === "closed" ? (
                        <p role="status">The host closed this lobby.</p>
                     ) : (
                        lobby && (
                           <>
                              <div className={styles.lobbyInfo}>
                                 {[
                                    ["Code", code],
                                    ["URL", url],
                                 ].map(([label, value]) => (
                                    <div className={styles.copyRow} key={label}>
                                       <label htmlFor={`lobby-${label}`}>
                                          {label}
                                       </label>
                                       <input
                                          id={`lobby-${label}`}
                                          className={styles.copyInput}
                                          value={value}
                                          readOnly
                                       />
                                       <button
                                          className={styles.copyButton}
                                          aria-label={`Copy ${label}`}
                                          onClick={() =>
                                             void copy(value, label)
                                          }
                                       >
                                          <FontAwesomeIcon
                                             icon={
                                                copied === label
                                                   ? faCheck
                                                   : faCopy
                                             }
                                          />
                                       </button>
                                    </div>
                                 ))}
                              </div>
                              <div className={styles.seatsGrid}>
                                 {lobby.seats.map((s, i) => (
                                    <div
                                       key={i}
                                       className={`${
                                          [
                                             styles.seatBottom,
                                             styles.seatLeft,
                                             styles.seatTop,
                                             styles.seatRight,
                                          ][i]
                                       } ${styles.seat} ${
                                          s.host ? styles.isHost : ""
                                       } ${
                                          s.status === "empty"
                                             ? styles.isEmpty
                                             : ""
                                       }`}
                                    >
                                       <span className={styles.seatName}>
                                          {s.status === "empty" ? (
                                             <>
                                                Waiting
                                                <span
                                                   className={
                                                      styles.waitingDots
                                                   }
                                                   aria-hidden="true"
                                                />
                                             </>
                                          ) : (
                                             <>
                                                <FontAwesomeIcon
                                                   icon={
                                                      s.status === "ai"
                                                         ? faRobot
                                                         : getProfileIcon(
                                                              s.icon
                                                           )
                                                   }
                                                />{" "}
                                                {s.name}{" "}
                                             </>
                                          )}
                                          {s.host && (
                                             <FontAwesomeIcon
                                                icon={faCrown}
                                                className={styles.crownIcon}
                                             />
                                          )}
                                       </span>
                                       <span className={styles.seatLabel}>
                                          {s.mine
                                             ? "You"
                                             : s.status === "empty"
                                             ? "Open"
                                             : s.status === "ai"
                                             ? "Bot"
                                             : s.connected
                                             ? "Player"
                                             : "Reconnecting…"}
                                       </span>
                                       <span className="lobby-seat-team">
                                          {lobby.teams[i % 2].name}
                                       </span>
                                       {lobby.status === "waiting" &&
                                          s.mine && (
                                             <button
                                                className={styles.selectSeatBtn}
                                                disabled={
                                                   busy || !multi.connected
                                                }
                                                onClick={() =>
                                                   fire({ type: "unseat" })
                                                }
                                             >
                                                Leave Seat
                                             </button>
                                          )}
                                       {lobby.status === "waiting" &&
                                          !s.mine &&
                                          s.status !== "human" && (
                                             <button
                                                className={styles.selectSeatBtn}
                                                disabled={
                                                   busy || !multi.connected
                                                }
                                                onClick={() =>
                                                   fire({
                                                      type: "join",
                                                      seat: i,
                                                      name: user?.name || name,
                                                   })
                                                }
                                             >
                                                Select Seat
                                             </button>
                                          )}
                                    </div>
                                 ))}
                                 <div className={styles.seatCenter}>
                                    {lobby.seat === null && !user && (
                                       <label className="lobby-guest-name">
                                          <span className="sr-only">
                                             Your name
                                          </span>
                                          <input
                                             className={styles.joinInput}
                                             placeholder="Your name"
                                             value={name}
                                             maxLength={20}
                                             onChange={(e) =>
                                                setName(e.target.value)
                                             }
                                             onBlur={(event) => {
                                                if (
                                                   event.relatedTarget instanceof
                                                      HTMLElement &&
                                                   event.relatedTarget.classList.contains(
                                                      styles.selectSeatBtn
                                                   )
                                                )
                                                   return;
                                                if (
                                                   inGroup &&
                                                   name.trim() &&
                                                   (name.trim() !==
                                                      lobby.memberName ||
                                                      lobby.needsName)
                                                )
                                                   fire({
                                                      type: "rename",
                                                      name,
                                                   });
                                             }}
                                          />
                                       </label>
                                    )}
                                    {lobby.isHost &&
                                       lobby.status === "waiting" && (
                                          <Button
                                             name="Start Game"
                                             size="compact"
                                             aria-label="Start Game"
                                             disabled={
                                                busy ||
                                                !multi.connected ||
                                                lobby.seat === null ||
                                                rearranging
                                             }
                                             aria-describedby={
                                                rearranging
                                                   ? "unseated-players"
                                                   : undefined
                                             }
                                             className={styles.startButton}
                                             onClick={() => {
                                                if (botCount) {
                                                   setDifficulty("easy");
                                                   setStarting(true);
                                                } else start();
                                             }}
                                          >
                                             <span>
                                                Start
                                                <br />
                                                Game
                                             </span>
                                          </Button>
                                       )}
                                    {lobby.seat !== null && !lobby.isHost && (
                                       <span className="lobby-waiting">
                                          Waiting for
                                          <br />
                                          the host
                                       </span>
                                    )}
                                    {lobby.seat === null &&
                                       inGroup &&
                                       lobby.status === "waiting" &&
                                       !lobby.isHost && (
                                          <span className="lobby-waiting">
                                             {lobby.seats.some(
                                                (s) => s.status !== "human"
                                             )
                                                ? "Select a seat"
                                                : "Waiting for a seat"}
                                          </span>
                                       )}
                                    {lobby.seat === null &&
                                       lobby.status !== "waiting" && (
                                          <p>This game has started.</p>
                                       )}
                                 </div>
                              </div>
                              {choosingSeats.length > 0 && (
                                 <div
                                    className="lobby-unseated"
                                    id="unseated-players"
                                    role="status"
                                    aria-label="Players choosing seats"
                                 >
                                    {choosingSeats.map((member, i) => (
                                       <span
                                          className="lobby-unseated-member"
                                          key={i}
                                       >
                                          {member.name}
                                          {member.mine ? " (you)" : ""}{" "}
                                          {member.host && (
                                             <FontAwesomeIcon
                                                icon={faCrown}
                                                className={styles.crownIcon}
                                             />
                                          )}
                                          <small>
                                             {!member.connected
                                                ? "Reconnecting…"
                                                : lobby.status !== "waiting"
                                                ? "Waiting for next game"
                                                : lobby.seats.some(
                                                     (s) => s.status !== "human"
                                                  )
                                                ? "Choosing a seat"
                                                : "Waiting for a seat"}
                                          </small>
                                       </span>
                                    ))}
                                 </div>
                              )}
                              <div className="lobby-teams">
                                 {lobby.teams.map((t, i) => (
                                    <TeamName
                                       key={`${i}:${t.canName}`}
                                       side={i}
                                       team={t}
                                       busy={busy || !multi.connected}
                                       members={lobby.seats
                                          .filter(
                                             (s) =>
                                                s.index % 2 === i &&
                                                s.status !== "empty"
                                          )
                                          .map((s) => s.name)}
                                       save={(name) =>
                                          run({ type: "name", name })
                                       }
                                    />
                                 ))}
                              </div>
                           </>
                        )
                     )}
                  </>
               )}
               {error && (
                  <p className="inline-error" role="alert">
                     {error}
                  </p>
               )}
               <div className="button-stack">
                  {error && !lobby && !needsSwitch && (
                     <Button
                        name="Try Again"
                        disabled={!multi.connected}
                        onClick={() => fire({ type: "watch" })}
                     />
                  )}
                  {!needsSwitch && lobby && lobby.status !== "closed" && (
                     <>
                        {lobby.status === "finished" && lobby.isHost && (
                           <Button
                              name="Back to Lobby"
                              disabled={busy || !multi.connected}
                              onClick={() => fire({ type: "rematch" })}
                           />
                        )}
                        {lobby.isHost && (
                           <Button
                              name="Close Lobby"
                              disabled={busy || !multi.connected}
                              onClick={() => fire({ type: "close" })}
                           />
                        )}
                        {inGroup && (
                           <Button
                              name="Leave Lobby"
                              disabled={busy}
                              onClick={() => {
                                 setLeaving(true);
                                 void run({ type: "leave" })
                                    .then(() => navigate("/play"))
                                    .catch(() => setLeaving(false));
                              }}
                           />
                        )}
                     </>
                  )}
                  <MenuLink to="/" name="Home" />
               </div>
            </div>
         </PageLayout>
         {starting && (
            <Modal
               title="Start Game"
               className="lobby-start-modal"
               onClose={() => setStarting(false)}
            >
               <p>
                  {botCount} {botCount === 1 ? "seat" : "seats"} will be filled
                  with bots
               </p>
               <fieldset className="lobby-difficulty">
                  <legend className="sr-only">Bot difficulty</legend>
                  {["easy", "medium", "hard"].map((d) => (
                     <label key={d}>
                        <input
                           type="radio"
                           name="botDifficulty"
                           checked={difficulty === d}
                           onChange={() => setDifficulty(d)}
                        />{" "}
                        {d === "hard" ? hardDifficulty : d}
                     </label>
                  ))}
               </fieldset>
               <div className="lobby-start-actions">
                  <Button name="Cancel" onClick={() => setStarting(false)} />
                  <Button name="Start!" onClick={start} />
               </div>
            </Modal>
         )}
         {switching && (
            <Modal
               title="Leave your current group?"
               onClose={() => setSwitching(false)}
            >
               <p>A bot will take your seat if the game is still running.</p>
               <Button
                  name="Leave & Join"
                  disabled={busy}
                  onClick={() => {
                     setBusy(true);
                     void multi
                        .command({ type: "leave" })
                        .then(() => {
                           setSwitching(false);
                        })
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                  }}
               />
            </Modal>
         )}
      </>
   );
}
