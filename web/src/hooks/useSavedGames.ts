import { useEffect, useState } from "react";
import { isGame, type Game } from "@/game/engine";
import { useAuth } from "@/context/AuthContext";
import { useGame } from "@/context/GameContext";
import { useMultiplayer } from "@/context/MultiplayerContext";
import { accountApiBase, createAccountClient } from "@/lib/account";
import { gameApiBase } from "@/lib/gameApi";
import { createSavedGameClient, type SavedEntry } from "@/lib/savedGame";
import { readStorage } from "@/lib/storage";
import type { SavedGameCard } from "@/components/InProgressGames";

export function useSavedGames() {
   const { user, loading } = useAuth();
   const single = useGame(),
      multi = useMultiplayer();
   const owner = user?.id ?? "guest";
   const [lookup, setLookup] = useState<{
      owner: string;
      entries: SavedEntry[];
   }>({ owner, entries: [] });
   const [pending, setPending] = useState(true),
      [error, setError] = useState("");
   const [attempt, setAttempt] = useState(0);
   const retry = () => setAttempt((value) => value + 1);
   useEffect(() => {
      const refresh = () => retry();
      window.addEventListener("euchre:saved-games", refresh);
      window.addEventListener("focus", refresh);
      window.addEventListener("online", refresh);
      window.addEventListener("storage", refresh);
      return () => {
         window.removeEventListener("euchre:saved-games", refresh);
         window.removeEventListener("focus", refresh);
         window.removeEventListener("online", refresh);
         window.removeEventListener("storage", refresh);
      };
   }, []);
   useEffect(() => {
      if (loading) return;
      let alive = true;
      setPending(true);
      setError("");
      void (async () => {
         const base = accountApiBase();
         let entries: SavedEntry[] = [];
         if (user && base)
            entries = await createSavedGameClient(base).list(user.id);
         else {
            const games = readStorage<Record<string, Game>>(
               "euchre.guest-games.v1",
               {}
            );
            entries = Object.values(games)
               .filter((game) => isGame(game) && game.phase !== "game_over")
               .map((game) => ({
                  id: game.id,
                  mode: "bot",
                  difficulty: game.difficulty,
                  hand: game.handNumber,
                  scores: game.scores,
               }));
            const known = readStorage<
               Record<string, { code: string; token: string }>
            >(`euchre.multiplayer.v1:${owner}:games`, {});
            if (Object.keys(known).length && base) {
               const session = await createAccountClient(base).session();
               const response = await fetch(
                  `${gameApiBase(base)}/saved-lobbies`,
                  {
                     method: "POST",
                     credentials: "include",
                     headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": session.csrf_token,
                     },
                     body: JSON.stringify({
                        memberships: Object.values(known).slice(-100),
                     }),
                  }
               );
               const data = await response.json();
               if (!response.ok)
                  throw new Error(
                     data.error || "Couldn’t check your saved lobbies."
                  );
               entries.push(...data.games);
            }
         }
         if (
            single.game &&
            single.game.phase !== "game_over" &&
            !entries.some((e) => e.id === single.game!.id)
         ) {
            const game = single.game;
            entries.unshift({
               id: game.id,
               mode: "bot",
               difficulty: game.difficulty,
               hand: game.handNumber,
               scores: game.scores,
            });
         }
         if (alive) setLookup({ owner, entries });
      })()
         .catch((e) => {
            if (alive) setError(e.message);
         })
         .finally(() => {
            if (alive) setPending(false);
         });
      return () => {
         alive = false;
      };
   }, [
      owner,
      loading,
      single.game?.id,
      single.game?.phase,
      multi.lobby?.revision,
      attempt,
   ]);
   const entries = lookup.owner === owner ? lookup.entries : [];
   const games: SavedGameCard[] = entries.map((entry) => ({
      id: `${entry.mode}:${entry.id}`,
      title:
         entry.mode === "bot"
            ? `Bot game · ${entry.difficulty ?? "Easy"}`
            : `Table ${entry.code}`,
      mode: entry.mode === "bot" ? "Bots" : "Multiplayer",
      progress:
         entry.mode === "bot"
            ? `Hand ${entry.hand} · ${entry.scores?.join("–") ?? "0–0"}`
            : entry.game
            ? `Hand ${entry.game.handNumber} · ${entry.game.scores.join("–")}`
            : "Waiting in the lobby",
      status:
         entry.mode === "bot"
            ? "Ready to resume"
            : entry.game?.turn === entry.lobby?.seat
            ? "Your turn"
            : entry.lobby?.status === "finished"
            ? "Between games"
            : "Waiting for players",
      multiplayer: entry.mode === "multiplayer",
      concedeDisabled: entry.mode === "multiplayer" && !multi.connected,
      concedeMessage:
         entry.mode === "bot"
            ? "Concede this bot game? Your other games stay saved."
            : "Concede your place at this table? Your other games stay saved.",
   }));
   return {
      games,
      checking: loading || single.loading || pending,
      error,
      retry,
      async resume(id: string) {
         const entry = entries.find((e) => `${e.mode}:${e.id}` === id);
         if (!entry) return null;
         if (entry.mode === "bot") {
            await single.resumeSaved(entry.id);
            return `/game/single-play?game_id=${encodeURIComponent(entry.id)}`;
         }
         await multi.command({
            type: "watch",
            code: entry.code,
            token: entry.token,
         });
         return entry.lobby?.status === "playing" && entry.lobby.seat !== null
            ? `/game/multi-play/${entry.code}`
            : `/game/lobby/${entry.code}`;
      },
      async concede(id: string) {
         const entry = entries.find((e) => `${e.mode}:${e.id}` === id);
         if (!entry) return;
         if (entry.mode === "bot") await single.concedeSaved(entry.id);
         else {
            await multi.command({
               type: "watch",
               code: entry.code,
               token: entry.token,
            });
            await multi.command({ type: "leave", code: entry.code });
         }
         setLookup((old) => ({
            ...old,
            entries: old.entries.filter((e) => e !== entry),
         }));
         retry();
      },
   };
}
