import { isGame, type Game } from "@/game/engine";
import { createAccountClient } from "./account";
import { gameApiBase } from "./gameApi";

export type SavedGame = { game: Game | null; revision: number };
export type SavedEntry = {
   id: string;
   mode: "bot" | "multiplayer";
   difficulty?: string;
   hand?: number;
   scores?: number[];
   code?: string;
   token?: string;
   lobby?: { status: string; seat: number | null };
   game?: Game | null;
};
export class SaveConflict extends Error {
   constructor(public snapshot: SavedGame, message: string) {
      super(message);
   }
}

export function createSavedGameClient(
   base: string,
   fetcher: typeof fetch = fetch
) {
   const accounts = createAccountClient(base, fetcher);
   const url = `${gameApiBase(base)}/saved-game`;
   const read = async (response: Response): Promise<SavedGame> => {
      const data = await response.json().catch(() => null);
      const valid =
         data &&
         (data.game === null || isGame(data.game)) &&
         Number.isInteger(data.revision) &&
         data.revision >= 0;
      if (response.status === 409 && data?.code === "SAVE_CONFLICT" && valid)
         throw new SaveConflict(data, data.error);
      if (!response.ok)
         throw new Error(
            data?.error || "Unable to save your game. Reconnect and try again."
         );
      if (!valid)
         throw new Error("The saved game returned an unexpected response.");
      return data;
   };
   const session = async (userId: string) => {
      const value = await accounts.session();
      if (value.user?.id !== userId)
         throw new Error(
            "Your account changed. Sign in again to save your game."
         );
      return value;
   };
   return {
      async list(userId: string): Promise<SavedEntry[]> {
         await session(userId);
         const response = await fetcher(`${gameApiBase(base)}/saved-games`, {
            credentials: "include",
            cache: "no-store",
            headers: { "X-Euchre-User": userId },
         });
         const data = await response.json();
         if (!response.ok || !Array.isArray(data.games))
            throw new Error(data.error || "Couldn’t load your saved games.");
         return data.games;
      },
      async load(userId: string, gameId?: string) {
         await session(userId);
         return read(
            await fetcher(
               gameId ? `${url}?game_id=${encodeURIComponent(gameId)}` : url,
               {
                  credentials: "include",
                  cache: "no-store",
                  headers: {
                     Accept: "application/json",
                     "X-Euchre-User": userId,
                  },
               }
            )
         );
      },
      async save(userId: string, game: Game, revision: number) {
         const value = await session(userId);
         return read(
            await fetcher(url, {
               method: "PUT",
               credentials: "include",
               headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": value.csrf_token,
                  "X-Euchre-User": userId,
               },
               body: JSON.stringify({ game, revision }),
            })
         );
      },
   };
}
