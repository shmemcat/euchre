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
   useEffect(() => {
      if (
         !leaving &&
         multi.connected &&
         (!lobby || lobby.status === "waiting" || lobby.seat === null)
      )
         navigate(`/game/lobby/${code}`, { replace: true });
   }, [multi.connected, lobby?.status, lobby?.seat, code, navigate, leaving]);
   const send = (data: Parameters<typeof multi.command>[0]) => {
      if (busy || !multi.connected) return;
      setBusy(true);
      setError("");
      void multi
         .command({ ...data, code, revision: lobby?.revision })
         .catch((e) => setError(e.message))
         .finally(() => setBusy(false));
   };
   if (!lobby || !multi.game)
      return (
         <PageLayout title="MULTIPLAYER">
            <p role="status">{multi.error || "Reconnecting to your table…"}</p>
            <MenuLink to={`/game/lobby/${code}`} name="Return to Lobby" />
         </PageLayout>
      );
   return (
      <>
         <GamePage
            online={{
               game: multi.game,
               act: (action) => send({ type: "action", action }),
               saved: true,
               error:
                  error ||
                  (!multi.connected
                     ? "Connection lost. Reconnecting… A bot takes over after 30 seconds."
                     : ""),
               isHost: lobby.isHost,
               disabled: busy || !multi.connected,
               onRematch: () => send({ type: "play_again" }),
               onLobby: () => send({ type: "rematch" }),
               onLeave: () => setLeaving(true),
            }}
         />
         {leaving && (
            <Modal title="Leave the game?" onClose={() => setLeaving(false)}>
               <p>A bot will take your seat. This game will count as a loss.</p>
               {error && (
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
               )}
               <div className="button-stack">
                  <Button
                     name="Leave Game"
                     disabled={busy}
                     onClick={() => {
                        setBusy(true);
                        void multi
                           .command({ type: "leave", code })
                           .then(() => navigate("/play"))
                           .catch((e) => setError(e.message))
                           .finally(() => setBusy(false));
                     }}
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
