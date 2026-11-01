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
   isGame,
} from "@/game/engine";
import { GAME_KEY, loadGame, recordResult, saveGame } from "@/lib/persistence";
import { readStorage, removeStorage, writeStorage } from "@/lib/storage";
import { useAuth } from "@/context/AuthContext";
import { syncLeaderboardResults } from "@/lib/leaderboard";
import { accountApiBase } from "@/lib/account";
import {
   createSavedGameClient,
   SaveConflict,
   type SavedGame,
} from "@/lib/savedGame";
const accountBase = accountApiBase();
const client = accountBase ? createSavedGameClient(accountBase) : null;
type Cache = SavedGame & { pending: boolean };
const cacheKey = (id: string) =>
   `euchre.saved-game.v1:${encodeURIComponent(id)}`;
type CloudSession = {
   userId: string;
   push: (next: Game) => void;
   create: (next: Game) => Promise<void>;
   ready: boolean;
   open: (id: string) => Promise<void>;
   concede: (id: string) => Promise<void>;
};
const Context = createContext<{
   game: Game | null;
   start: (difficulty: Difficulty, name: string) => void | Promise<void>;
   act: (action: Action) => void;
   concedeGame: () => void;
   saved: boolean;
   error: string;
   loading: boolean;
   resumeSaved: (id: string) => Promise<void>;
   concedeSaved: (id: string) => Promise<void>;
} | null>(null);
export function GameProvider({ children }: { children: ReactNode }) {
   const { user, loading: authLoading } = useAuth();
   const [game, setGame] = useState<Game | null>(() =>
      client ? null : loadGame()
   );
   const [displayUser, setDisplayUser] = useState<string | null>(
      user?.id ?? null
   );
   const [loading, setLoading] = useState(!!client);
   const cloud = useRef<CloudSession | null>(null);
   const owner = useRef(
      readStorage<{ gameId: string; userId: string | null } | null>(
         "euchre.game-owner.v1",
         null
      )
   );
   const [saved, setSaved] = useState(true);
   const [resultSaved, setResultSaved] = useState(true);
   const [error, setError] = useState("");
   const recordFinished = (next: Game, userId: string) => {
      if (next.phase !== "game_over") return;
      const stored = recordResult(next, userId);
      setResultSaved(stored);
      if (stored) {
         window.dispatchEvent(new Event("euchre:achievements"));
         void syncLeaderboardResults(userId).catch(() => {});
      }
   };
   useEffect(() => {
      if (!client || authLoading) return;
      const userId = user?.id ?? null;
      setDisplayUser(userId);
      setError("");
      setResultSaved(true);
      if (!userId) {
         cloud.current = null;
         const legacyOwner = readStorage<{ userId: string | null } | null>(
            "euchre.game-owner.v1",
            null
         );
         const guest = legacyOwner?.userId ? null : loadGame();
         owner.current = guest ? { gameId: guest.id, userId: null } : null;
         setGame(guest);
         setLoading(false);
         return;
      }
      let stopped = false,
         writing = false,
         reading = false;
      let pending: Game | null = null;
      let selectedId: string | null = null;
      const waiters: (() => void)[] = [];
      const revisions = new Map<string, number>();
      const stored = readStorage<Cache | null>(cacheKey(userId), null);
      const cached =
         stored &&
         isGame(stored.game) &&
         Number.isInteger(stored.revision) &&
         stored.revision >= 0
            ? stored
            : null;
      const legacy = owner.current?.userId === userId ? loadGame() : null;
      const session: CloudSession = {
         userId,
         ready: false,
         async create(next) {
            if (stopped || writing || pending || !session.ready)
               throw new Error(
                  "Let your current game finish saving before starting another."
               );
            writing = true;
            setSaved(false);
            try {
               const snapshot = await client!.save(userId, next, 0);
               if (stopped)
                  throw new Error(
                     "Your account changed. Sign in again to start a game."
                  );
               accept(snapshot);
               window.dispatchEvent(new Event("euchre:saved-games"));
            } finally {
               writing = false;
               if (!stopped) setSaved(true);
               waiters.splice(0).forEach((resolve) => resolve());
            }
         },
         push(next) {
            selectedId = next.id;
            pending = next;
            writeStorage(cacheKey(userId), {
               game: next,
               revision: revisions.get(next.id) ?? 0,
               pending: true,
            });
            setSaved(false);
            void flush();
         },
         async open(id) {
            if (writing)
               await new Promise<void>((resolve) => waiters.push(resolve));
            if (stopped || pending || !session.ready)
               throw new Error(
                  "Reconnect and let your game finish saving first."
               );
            setLoading(true);
            reading = true;
            try {
               const snapshot = await client!.load(userId, id);
               if (stopped) return;
               if (!snapshot.game || snapshot.game.phase === "game_over")
                  throw new Error(
                     "This game has finished or is no longer available."
                  );
               accept(snapshot);
            } finally {
               reading = false;
               if (!stopped) setLoading(false);
            }
         },
         async concede(id) {
            if (writing)
               await new Promise<void>((resolve) => waiters.push(resolve));
            if (stopped || pending || !session.ready)
               throw new Error(
                  "Reconnect and let your game finish saving first."
               );
            const snapshot = await client!.load(userId, id);
            if (stopped) return;
            if (!snapshot.game || snapshot.game.phase === "game_over") return;
            const finished = concede(snapshot.game);
            const result = await client!.save(
               userId,
               finished,
               snapshot.revision
            );
            if (stopped) return;
            recordFinished(finished, userId);
            if (selectedId === id) accept(result);
            window.dispatchEvent(new Event("euchre:saved-games"));
         },
      };
      cloud.current = session;
      setGame(null);
      setLoading(true);
      const clearLegacy = (id: string) => {
         const previous = readStorage<{
            gameId: string;
            userId: string | null;
         } | null>("euchre.game-owner.v1", null);
         if (previous?.userId === userId && previous.gameId === id) {
            removeStorage(GAME_KEY);
            removeStorage("euchre.game-owner.v1");
         }
      };
      const accept = (snapshot: SavedGame, dirty = false) => {
         selectedId = snapshot.game?.id ?? null;
         if (snapshot.game) {
            revisions.set(snapshot.game.id, snapshot.revision);
            owner.current = { gameId: snapshot.game.id, userId };
            if (!dirty) clearLegacy(snapshot.game.id);
         }
         writeStorage(cacheKey(userId), { ...snapshot, pending: dirty });
         setGame(snapshot.game);
         setSaved(!dirty);
      };
      async function flush() {
         if (stopped || writing || !session.ready) return;
         writing = true;
         try {
            while (pending && !stopped) {
               const next = pending;
               const snapshot = await client!.save(
                  userId!,
                  next,
                  revisions.get(next.id) ?? 0
               );
               if (stopped) return;
               revisions.set(next.id, snapshot.revision);
               clearLegacy(next.id);
               if (pending === next) pending = null;
               writeStorage(cacheKey(userId!), {
                  game: pending ?? next,
                  revision: pending
                     ? revisions.get(pending.id) ?? 0
                     : snapshot.revision,
                  pending: !!pending,
               });
               setSaved(!pending);
               setError("");
               recordFinished(next, userId!);
            }
         } catch (e) {
            if (stopped) return;
            if (e instanceof SaveConflict) {
               pending = null;
               accept(e.snapshot);
            } else setSaved(false);
            setError(
               e instanceof Error ? e.message : "Reconnect to save your game."
            );
         } finally {
            writing = false;
            waiters.splice(0).forEach((resolve) => resolve());
         }
      }
      const refresh = async (initial = false) => {
         if (stopped || reading || writing) return;
         if (pending && session.ready) {
            await flush();
            return;
         }
         reading = true;
         try {
            const requested =
               new URLSearchParams(window.location.search).get("game_id") ??
               (window.location.pathname.endsWith("/game/single-play")
                  ? selectedId ?? undefined
                  : undefined);
            const remote = await client!.load(userId, requested);
            if (stopped) return;
            session.ready = true;
            const unsynced =
               pending ?? (initial && cached?.pending ? cached.game : null);
            if (unsynced) {
               const revision =
                  cached?.game?.id === unsynced.id
                     ? cached.revision
                     : revisions.get(unsynced.id) ?? 0;
               accept({ game: unsynced, revision }, true);
               pending = unsynced;
            } else if (
               initial &&
               !remote.game &&
               legacy &&
               legacy.phase !== "game_over"
            ) {
               accept({ game: legacy, revision: 0 }, true);
               pending = legacy;
            } else {
               pending = null;
               accept(remote);
            }
            setError("");
            await flush();
         } catch (e) {
            if (!stopped) {
               if (initial && cached) {
                  if (cached.pending) pending = cached.game;
                  accept(cached, cached.pending);
               }
               setError(
                  e instanceof Error
                     ? e.message
                     : "Reconnect to load your saved game."
               );
            }
         } finally {
            reading = false;
            if (!stopped) setLoading(false);
         }
      };
      void refresh(true);
      const retry = () => {
         if (document.visibilityState !== "hidden") void refresh();
      };
      window.addEventListener("online", retry);
      window.addEventListener("focus", retry);
      window.addEventListener("pageshow", retry);
      document.addEventListener("visibilitychange", retry);
      return () => {
         stopped = true;
         if (cloud.current === session) cloud.current = null;
         window.removeEventListener("online", retry);
         window.removeEventListener("focus", retry);
         window.removeEventListener("pageshow", retry);
         document.removeEventListener("visibilitychange", retry);
      };
   }, [user?.id, authLoading]);
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
      if (
         game &&
         (!client ||
            (!user && displayUser === null && owner.current?.userId === null))
      )
         setSaved(saveGame(game));
      if (
         game &&
         !user &&
         displayUser === null &&
         owner.current?.userId === null
      ) {
         const games = readStorage<Record<string, Game>>(
            "euchre.guest-games.v1",
            {}
         );
         if (game.phase === "game_over") delete games[game.id];
         else games[game.id] = game;
         writeStorage("euchre.guest-games.v1", games);
         window.dispatchEvent(new Event("euchre:saved-games"));
      }
   }, [game, user?.id, displayUser]);
   const start = useCallback(
      (difficulty: Difficulty, _name: string) => {
         if (client && user && !saved)
            throw new Error(
               "Let your current game finish saving before starting another. Reconnect if you’re offline."
            );
         if (
            client &&
            user &&
            (!cloud.current?.ready || cloud.current.userId !== user.id)
         )
            throw new Error(
               "Reconnect to load your saved game before starting another."
            );
         setError("");
         setResultSaved(true);
         const next = newGame(difficulty, user?.name ?? "You");
         if (client && user) return cloud.current!.create(next);
         const games = readStorage<Record<string, Game>>(
            "euchre.guest-games.v1",
            {}
         );
         if (
            Object.values(games).filter(
               (game) => isGame(game) && game.phase !== "game_over"
            ).length >= 20
         )
            throw new Error(
               "You have 20 games in progress. Finish or concede one to make room."
            );
         const now = Date.now();
         const recent = readStorage<number[]>(
            "euchre.game-creations.v1",
            []
         ).filter((time) => time > now - 60000);
         if (recent.length >= 5)
            throw new Error(
               "Please wait a minute before creating another game or lobby. You can create up to 5 per minute."
            );
         writeStorage("euchre.game-creations.v1", [...recent, now]);
         owner.current = { gameId: next.id, userId: user?.id ?? null };
         if (!client || !user)
            writeStorage("euchre.game-owner.v1", owner.current);
         setGame(next);
         cloud.current?.push(next);
      },
      [user?.id, user?.name, saved]
   );
   const playerGame = useMemo(
      () =>
         game && (!client || displayUser === (user?.id ?? null))
            ? { ...game, playerName: user?.name ?? "You" }
            : null,
      [game, user?.name, user?.id, displayUser]
   );
   const finish = (next: Game) => {
      if (client && user) {
         if (cloud.current?.userId !== user.id) return;
         cloud.current.push(next);
         setGame(next);
         return;
      }
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
         if (stored) window.dispatchEvent(new Event("euchre:achievements"));
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
   const resumeSaved = async (id: string) => {
      if (client && user) {
         if (!cloud.current)
            throw new Error(
               "Your saved games are still loading. Please try again."
            );
         await cloud.current.open(id);
         return;
      }
      const next =
         readStorage<Record<string, Game>>("euchre.guest-games.v1", {})[id] ??
         loadGame();
      if (!next || next.id !== id || !isGame(next))
         throw new Error("This saved game is unavailable.");
      owner.current = { gameId: id, userId: null };
      setGame(next);
   };
   const concedeSaved = async (id: string) => {
      if (client && user) {
         if (!cloud.current)
            throw new Error(
               "Your saved games are still loading. Please try again."
            );
         await cloud.current.concede(id);
         return;
      }
      const games = readStorage<Record<string, Game>>(
         "euchre.guest-games.v1",
         {}
      );
      delete games[id];
      if (!writeStorage("euchre.guest-games.v1", games))
         throw new Error("Your browser couldn’t remove this save.");
      if (game?.id === id) setGame(concede(game));
      window.dispatchEvent(new Event("euchre:saved-games"));
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
            loading: !!authLoading || loading,
            resumeSaved,
            concedeSaved,
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
