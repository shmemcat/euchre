import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMultiplayer } from "@/context/MultiplayerContext";
import { Button, MenuLink } from "@/components/Buttons";
import { Modal } from "@/components/Modal";
import { PageLayout } from "@/components/ui/PageLayout";
import GamePage from "./GamePage";

export default function MultiplayerGame() {
   const { code = "" } = useParams();
   const multi = useMultiplayer();
   const navigate = useNavigate();
   const [error, setError] = useState("");
   const [leaving, setLeaving] = useState(false);
   const [busy, setBusy] = useState(false);
   const lobby = multi.lobby?.code === code ? multi.lobby : null;
   const finished = multi.game?.phase === "game_over";
   const spectating = lobby?.seat === null;
   useEffect(() => {
      if (multi.connected && spectating && !leaving && lobby?.status !== "closed")
         void multi.command({ type: "watch", code }).catch(e => setError(e.message));
   }, [multi.connected, spectating, leaving, lobby?.status, code, multi.command]);
   useEffect(() => {
      if (
         !leaving &&
         multi.connected &&
         lobby?.status !== "closed" &&
         (!lobby || lobby.status === "waiting")
      )
         navigate(`/game/lobby/${code}`, { replace: true });
   }, [multi.connected, lobby?.status, lobby?.seat, code, navigate, leaving]);
   const send = (data: Parameters<typeof multi.command>[0]) => {
      if (spectating || busy || !multi.connected) return;
      setBusy(true);
      setError("");
      void multi
         .command({
            ...data,
            code,
            revision: lobby?.revision,
            ...(lobby?.actionToken ? { actionToken: lobby.actionToken } : {}),
         })
         .catch((e) => setError(e.message))
         .finally(() => setBusy(false));
   };
   const leaveLobby = () => {
      if (spectating) {
         setLeaving(true);
         if (multi.connected)
            void multi.command({ type: "unwatch", code }).catch(() => {}).finally(() => navigate("/play"));
         else navigate("/play");
         return;
      }
      if (busy || !multi.connected) return;
      setLeaving(true);
      setBusy(true);
      setError("");
      void multi
         .command({ type: "leave", code })
         .then(() => navigate("/play"))
         .catch((e) => {
            setError(e.message);
            if (finished) setLeaving(false);
         })
         .finally(() => setBusy(false));
   };
   if (lobby?.status === "closed")
      return (
         <PageLayout title="GAME CLOSED">
            <p role="status">{lobby.closedReason === "one_player"
               ? "Everyone else conceded. This game has closed without counting as a completed game."
               : "This lobby has closed."}</p>
            <MenuLink to="/play" name="Back to Play" />
         </PageLayout>
      );
   if (!lobby || !multi.game)
      return (
         <PageLayout title="MULTIPLAYER">
            <p role="status">{multi.error || "Reconnecting to your table…"}</p>
            <MenuLink to={`/game/lobby/${code}`} name="Return to Lobby" />
         </PageLayout>
      );
   if (lobby.removedReason)
      return (
         <PageLayout title="REMOVED FROM GAME">
            <p role="alert">
               You were removed{" "}
               {lobby.removedReason === "idle"
                  ? "for inactivity"
                  : "while you were away"}
               . A bot has taken your seat. Only finished games count toward
               your statistics.
            </p>
            {error && (
               <p role="alert" className="inline-error">
                  {error}
               </p>
            )}
            <Button
               name="Back to Play"
               onClick={leaveLobby}
               disabled={busy || !multi.connected}
            />
         </PageLayout>
      );
   return (
      <>
         <GamePage
            online={{
               game: multi.game,
               act: (action) =>
                  send({
                     type: "action",
                     action,
                     ...(action.type === "advance"
                        ? {
                             gameId: multi.game!.id,
                             handNumber: multi.game!.handNumber,
                          }
                        : {}),
                  }),
               saved: true,
               error:
                  error ||
                  (!multi.connected
                     ? spectating ? "Connection lost. Reconnecting…" : "Connection lost. Reconnecting… Your seat is saved."
                     : ""),
               isHost: lobby.isHost,
               spectating,
               disabled: busy || !multi.connected,
               onRematch: () => send({ type: "play_again" }),
               onLobby: () => send({ type: "rematch" }),
               onLeave: () => {
                  if (finished || spectating) leaveLobby();
                  else setLeaving(true);
               },
            }}
         />
         {leaving && !finished && (
            <Modal title="Leave the game?" onClose={() => setLeaving(false)}>
               <p>
                  A bot will take your seat. Only finished games count toward
                  your statistics.
               </p>
               {error && (
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
               )}
               <div className="button-stack">
                  <Button
                     name="Leave Game"
                     disabled={busy || !multi.connected}
                     onClick={leaveLobby}
                  />
                  <Button
                     name="Keep Playing"
                     onClick={() => setLeaving(false)}
                  />
               </div>
            </Modal>
         )}
      </>
   );
}
