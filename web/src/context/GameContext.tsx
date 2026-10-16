import {
   createContext,
   useCallback,
   useContext,
   useEffect,
   useState,
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
const Context = createContext<{
   game: Game | null;
   start: (difficulty: Difficulty, name: string) => void;
   act: (action: Action) => void;
   concedeGame: () => void;
   saved: boolean;
   error: string;
} | null>(null);
export function GameProvider({ children }: { children: ReactNode }) {
   const [game, setGame] = useState<Game | null>(loadGame);
   const [saved, setSaved] = useState(true);
   const [error, setError] = useState("");
   useEffect(() => {
      if (game) setSaved(saveGame(game) && recordResult(game));
   }, [game]);
   const start = useCallback((difficulty: Difficulty, name: string) => {
      setError("");
      setGame(newGame(difficulty, name));
   }, []);
   const act = useCallback(
      (action: Action) => {
         if (!game) return;
         try {
            const next = applyAction(game, action);
            setError("");
            setGame(next);
         } catch (e) {
            setError(
               e instanceof Error ? e.message : "That move could not be played."
            );
         }
      },
      [game]
   );
   const concedeGame = () => {
      if (game && game.phase !== "game_over") setGame(concede(game));
   };
   return (
      <Context.Provider value={{ game, start, act, concedeGame, saved, error }}>
         {children}
      </Context.Provider>
   );
}
export function useGame() {
   const value = useContext(Context);
   if (!value) throw new Error("Missing GameProvider");
   return value;
}
