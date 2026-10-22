import { useAuth } from "@/context/AuthContext";
import { useGame } from "@/context/GameContext";
import { useMultiplayer } from "@/context/MultiplayerContext";

export function useActiveGameSession() {
   const { loading } = useAuth();
   const { game } = useGame();
   const multi = useMultiplayer();
   const lobby =
      multi.resumeCode && multi.lobby?.code === multi.resumeCode
         ? multi.lobby
         : null;
   const checking = !!loading || (!!multi.resumeCode && !lobby);
   const session =
      game && game.phase !== "game_over"
         ? {
              key: `solo:${game.id}`,
              type: "solo" as const,
              code: null,
              status: "playing" as const,
              playing: true,
           }
         : lobby?.isMember && lobby.status !== "closed"
         ? {
              key: `online:${lobby.code}`,
              type: "online" as const,
              code: lobby.code,
              status: lobby.status,
              playing: lobby.status === "playing" && lobby.seat !== null,
           }
         : null;
   return { session, checking };
}
