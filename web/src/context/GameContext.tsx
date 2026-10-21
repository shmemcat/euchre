import {
   createContext,
   useCallback,
   useContext,
   useEffect,
   useState,
   useRef,
   useMemo,
   type ReactNode,
} from "react";
import {
   applyAction,
   concede,
   newGame,
   type Action,
   type Difficulty,
   type Game,
} from "@/game/engine";
import { loadGame, recordResult, saveGame } from "@/lib/persistence";
import { readStorage, writeStorage } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";
import { syncLeaderboardResults } from "@/lib/leaderboard";
const Context = createContext<{
   game: Game | null;
   start: (difficulty: Difficulty, name: string) => void;
   act: (action: Action) => void;
   concedeGame: () => void;
   saved: boolean;
   error: string;
} | null>(null);
export function GameProvider({ children }: { children: ReactNode }) {
   const { user } = useAuth();
   const [game, setGame] = useState<Game | null>(loadGame);
   const owner = useRef(
      readStorage<{ gameId: string; userId: string | null } | null>(
         "euchre.game-owner.v1",
         null
      )
   );
   const [saved, setSaved] = useState(true);
   const [resultSaved, setResultSaved] = useState(true);
   const [error, setError] = useState("");
   useEffect(() => {
      if (!user) return;
      const sync = () => {
         void syncLeaderboardResults(user.id).catch(() => {});
      };
      sync();
      window.addEventListener("online", sync);
      window.addEventListener("focus", sync);
      return () => {
         window.removeEventListener("online", sync);
         window.removeEventListener("focus", sync);
      };
   }, [user?.id]);
   useEffect(() => {
      if (game) setSaved(saveGame(game));
   }, [game]);
   const start = useCallback(
      (difficulty: Difficulty, _name: string) => {
         setError("");
         setResultSaved(true);
         const next = newGame(difficulty, user?.name ?? "You");
         owner.current = { gameId: next.id, userId: user?.id ?? null };
         writeStorage("euchre.game-owner.v1", owner.current);
         setGame(next);
      },
      [user?.id, user?.name]
   );
   const playerGame = useMemo(
      () => (game ? { ...game, playerName: user?.name ?? "You" } : null),
      [game, user?.name]
   );
   const finish = (next: Game) => {
      if (
         game &&
         game.phase !== "game_over" &&
         next.phase === "game_over" &&
         user &&
         owner.current?.gameId === game.id &&
         owner.current.userId === user.id
      ) {
         const stored = recordResult(next, user.id);
         setResultSaved(stored);
         if (stored) void syncLeaderboardResults(user.id).catch(() => {});
      }
      setGame(next);
   };
   const act = useCallback(
      (action: Action) => {
         if (!playerGame) return;
         try {
            const next = applyAction(playerGame, action);
            setError("");
            finish(next);
         } catch (e) {
            setError(
               e instanceof Error ? e.message : "That move could not be played."
            );
         }
      },
      [playerGame, user?.id]
   );
   const concedeGame = () => {
      if (playerGame && playerGame.phase !== "game_over")
         finish(concede(playerGame));
   };
   return (
      <Context.Provider
         value={{
            game: playerGame,
            start,
            act,
            concedeGame,
            saved: saved && resultSaved,
            error,
         }}
      >
         {children}
      </Context.Provider>
   );
}
export function useGame() {
   const value = useContext(Context);
   if (!value) throw new Error("Missing GameProvider");
   return value;
}
