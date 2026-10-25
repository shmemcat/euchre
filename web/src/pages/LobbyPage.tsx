import { useEffect, useRef, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faCopy,
   faCheck,
   faCrown,
   faRobot,
   faUser,
   faPencil,
} from "@fortawesome/pro-solid-svg-icons";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import { useSound } from "@/context/SoundContext";
import { useMultiplayer, type Lobby } from "@/context/MultiplayerContext";
import { getProfileIcon } from "@/lib/profileIcons";
import styles from "@/styles/lobby.module.css";

const MOBILE_LOBBY_QUERY = "(max-width: 768px)";

function useMobileLobby() {
   const [mobile, setMobile] = useState(
      () => window.matchMedia?.(MOBILE_LOBBY_QUERY).matches ?? false
   );
   useEffect(() => {
      const query = window.matchMedia?.(MOBILE_LOBBY_QUERY);
      if (!query) return;
      const update = () => setMobile(query.matches);
      update();
      query.addEventListener?.("change", update);
      return () => query.removeEventListener?.("change", update);
   }, []);
   return mobile;
}

function TeamName({
   side,
   team,
   members,
   busy,
   mobile,
   save,
}: {
   side: number;
   team: Lobby["teams"][number];
   members: string[];
   busy: boolean;
   mobile: boolean;
   save: (name: string) => Promise<void>;
}) {
   const [editing, setEditing] = useState(!mobile && !team.named);
   const [name, setName] = useState(team.named ? team.name : "");
   const [saveError, setSaveError] = useState("");
   useEffect(() => {
      setName(team.named ? team.name : "");
      setEditing(!mobile && !team.named);
      setSaveError("");
   }, [team.name, team.named, mobile]);
   const submit = async (e: FormEvent) => {
      e.preventDefault();
      setSaveError("");
      try {
         await save(name);
         setEditing(false);
      } catch (e) {
         // Keep the draft open; mobile errors must also be visible in the popup.
         setSaveError((e as Error).message);
      }
   };
   const editor = (
      <form
         className={mobile ? styles.teamNameForm : "lobby-team-form"}
         onSubmit={submit}
      >
         <label
            className={mobile ? undefined : "sr-only"}
            htmlFor={`team-name-${side}`}
         >
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
         {mobile ? (
            <>
               {saveError && (
                  <p className="inline-error" role="alert">
                     {saveError}
                  </p>
               )}
               <div className={styles.teamNameActions}>
                  <Button
                     name="Save Team Name"
                     type="submit"
                     disabled={busy || !name.trim()}
                  />
                  <Button
                     name="Cancel"
                     variant="secondary"
                     disabled={busy}
                     onClick={() => setEditing(false)}
                  />
               </div>
            </>
         ) : (
            <button disabled={busy || !name.trim()} type="submit">
               Save
            </button>
         )}
      </form>
   );
   if (mobile)
      return (
         <section className={styles.mobileTeam} aria-label={`Team ${side + 1}`}>
            <Button
               name={team.name}
               size="compact"
               variant="secondary"
               className={styles.teamNameButton}
               aria-label={
                  team.canName
                     ? `Edit Team ${side + 1} name`
                     : `Team ${side + 1}: ${team.name}`
               }
               aria-describedby={`team-current-name-${side}`}
               disabled={busy || !team.canName}
               onClick={() => {
                  setName(team.named ? team.name : "");
                  setSaveError("");
                  setEditing(true);
               }}
            >
               <span id={`team-current-name-${side}`}>{team.name}</span>
               <FontAwesomeIcon icon={faPencil} />
            </Button>
            {editing && team.canName && (
               <Modal
                  title={`Team ${side + 1} Name`}
                  className={styles.teamNameModal}
                  onClose={() => setEditing(false)}
               >
                  {editor}
               </Modal>
            )}
         </section>
      );
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
            editor
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
   const { play } = useSound();
   const { user } = useAuth();
   const { preferences } = usePreferences();
   const navigate = useNavigate();
   const mobile = useMobileLobby();
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
   const humanCount =
      (lobby?.seats.filter((seat) => seat.status === "human").length ?? 0) +
      choosingSeats.length;
   const previousPlayers = useRef<{ code: string; count: number } | null>(null);
   const botCount =
      lobby?.seats.filter((seat) => seat.status !== "human").length ?? 0;
   const hardDifficulty =
      lobby?.defaultDifficulty ?? (user ? preferences.hardLevel : "hard");
   const rearranging = choosingSeats.some((member) => member.reserved ?? true);
   const needsSwitch = !!multi.resumeCode && multi.resumeCode !== code;
   useEffect(() => {
      const previous = previousPlayers.current;
      previousPlayers.current =
         lobby?.status === "waiting" ? { code, count: humanCount } : null;
      if (
         lobby?.status === "waiting" &&
         previous?.code === code &&
         humanCount > previous.count
      )
         play("playerJoin");
   }, [code, humanCount, lobby?.status, play]);
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
   const leaveLobbyButton = inGroup ? (
      <Button
         name="Leave Lobby"
         variant={mobile ? "secondary" : "primary"}
         disabled={busy}
         onClick={() => {
            setLeaving(true);
            void run({ type: "leave" })
               .then(() => navigate("/play"))
               .catch(() => setLeaving(false));
         }}
      />
   ) : null;
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
                                       {mobile && (
                                          <span className={styles.seatIcon}>
                                             <FontAwesomeIcon
                                                icon={
                                                   s.status === "empty"
                                                      ? faUser
                                                      : s.status === "ai"
                                                      ? faRobot
                                                      : getProfileIcon(s.icon)
                                                }
                                             />
                                          </span>
                                       )}
                                       <span className={styles.seatName}>
                                          {s.status === "empty" ? (
                                             mobile ? (
                                                "Open seat"
                                             ) : (
                                                <>
                                                   Waiting
                                                   <span
                                                      className={
                                                         styles.waitingDots
                                                      }
                                                      aria-hidden="true"
                                                   />
                                                </>
                                             )
                                          ) : (
                                             <>
                                                {!mobile && (
                                                   <FontAwesomeIcon
                                                      icon={
                                                         s.status === "ai"
                                                            ? faRobot
                                                            : getProfileIcon(
                                                                 s.icon
                                                              )
                                                      }
                                                   />
                                                )}{" "}
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
                                          {s.mine ? (
                                             "You"
                                          ) : s.status === "empty" ? (
                                             mobile ? (
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
                                                "Open"
                                             )
                                          ) : s.status === "ai" ? (
                                             "Bot"
                                          ) : s.connected ? (
                                             "Player"
                                          ) : (
                                             "Reconnecting…"
                                          )}
                                       </span>
                                       <span
                                          className="lobby-seat-team"
                                          title={lobby.teams[i % 2].name}
                                       >
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
                                                data-seat-choice
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
                              <div
                                 className={`lobby-teams ${
                                    mobile ? styles.mobileTeams : ""
                                 }`}
                              >
                                 {lobby.teams.map((t, i) => (
                                    <TeamName
                                       key={`${i}:${t.canName}`}
                                       side={i}
                                       team={t}
                                       busy={busy || !multi.connected}
                                       mobile={mobile}
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
               <div className={`button-stack ${styles.lobbyActions}`}>
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
                        {mobile && leaveLobbyButton}
                        {lobby.isHost && (
                           <Button
                              name="Close Lobby"
                              disabled={busy || !multi.connected}
                              onClick={() => fire({ type: "close" })}
                           />
                        )}
                        {!mobile && leaveLobbyButton}
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
               {!mobile && (
                  <p>
                     {botCount} {botCount === 1 ? "seat" : "seats"} will be
                     filled with bots
                  </p>
               )}
               <fieldset className="lobby-difficulty">
                  <legend className={mobile ? undefined : "sr-only"}>
                     Bot difficulty
                  </legend>
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
