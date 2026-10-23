import {
   createContext,
   useCallback,
   useContext,
   useEffect,
   useRef,
   useState,
   type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { accountApiBase, createAccountClient } from "@/lib/account";
import { readStorage, writeStorage, removeStorage } from "@/lib/storage";
import type { Action, Difficulty, Game } from "@/game/engine";

export type Lobby = {
   code: string;
   status: "waiting" | "playing" | "finished" | "closed";
   seats: {
      index: number;
      status: "empty" | "ai" | "human";
      name: string;
      icon: string;
      mine: boolean;
      host: boolean;
      connected: boolean;
   }[];
   seat: number | null;
   isMember: boolean;
   memberName: string;
   needsName: boolean;
   unseated: {
      name: string;
      mine: boolean;
      host: boolean;
      connected: boolean;
      reserved: boolean;
   }[];
   isHost: boolean;
   revision: number;
   gameId: string | null;
   teams: { name: string; named: boolean; canName: boolean }[];
   difficulty: Difficulty;
   defaultDifficulty?: "hard" | "harder" | "hardest";
};
type Reply = { ok: boolean; error?: string; code?: string; token?: string };
type Command = {
   type: string;
   code?: string;
   token?: string;
   name?: string;
   seat?: number;
   difficulty?: Difficulty;
   action?: Action;
   revision?: number;
   gameId?: string;
   handNumber?: number;
};
const Context = createContext<{
   lobby: Lobby | null;
   game: Game | null;
   connected: boolean;
   error: string;
   command: (data: Command) => Promise<Reply>;
   resumeCode: string | null;
} | null>(null);

export function MultiplayerProvider({ children }: { children: ReactNode }) {
   const { user, loading } = useAuth();
   const key = `euchre.multiplayer.v1:${user?.id ?? "guest"}`;
   const socket = useRef<Socket | null>(null);
   const active = useRef<{ code: string; token: string } | null>(null);
   const storageKey = useRef(key);
   const [lobby, setLobby] = useState<Lobby | null>(null);
   const [game, setGame] = useState<Game | null>(null);
   const [connected, setConnected] = useState(false);
   const [error, setError] = useState("");
   const [resumeCode, setResumeCode] = useState<string | null>(null);

   const command = useCallback(async (data: Command) => {
      const current = socket.current;
      if (!current?.connected)
         throw new Error(
            "Connecting to the table. Please try again in a moment."
         );
      const membership = active.current;
      const request =
         data.type === "watch" && membership && membership.code === data.code
            ? { ...data, token: membership.token }
            : data;
      const reply = await new Promise<Reply>((resolve, reject) => {
         current
            .timeout(10000)
            .emit("command", request, (error: Error | null, reply: Reply) => {
               if (error)
                  reject(
                     new Error(
                        "The table didn’t respond. Reconnect before trying again."
                     )
                  );
               else resolve(reply);
            });
      });
      if (socket.current !== current)
         throw new Error("Your account changed. Please rejoin the table.");
      if (!reply?.ok)
         throw new Error(reply?.error || "Unable to update the table.");
      if (reply.code && reply.token) {
         active.current = { code: reply.code, token: reply.token };
         writeStorage(storageKey.current, active.current);
         setResumeCode(reply.code);
      }
      if (data.type === "leave" || data.type === "close") {
         removeStorage(storageKey.current);
         active.current = null;
         setResumeCode(null);
      }
      setError("");
      return reply;
   }, []);

   useEffect(() => {
      if (loading) return;
      storageKey.current = key;
      active.current = readStorage<{ code: string; token: string } | null>(
         key,
         null
      );
      setResumeCode(active.current?.code ?? null);
      setLobby(null);
      setGame(null);
      const client = io("/euchre", {
         path: "/euchre/socket.io",
         autoConnect: false,
         withCredentials: true,
         auth: async (callback) => {
            try {
               const session = await createAccountClient(
                  accountApiBase() || "/api/account"
               ).session();
               callback({ csrf: session.csrf_token });
            } catch {
               callback({});
            }
         },
      });
      socket.current = client;
      client.on("connect", () => {
         setConnected(true);
         setError("");
         if (active.current)
            void command({ type: "watch", ...active.current }).catch((e) => {
               setError(e.message);
               // Expired invitations must not trap the player in an old table.
               if (/not found|expired/.test(e.message)) {
                  removeStorage(key);
                  active.current = null;
                  setResumeCode(null);
               }
            });
      });
      client.on("disconnect", () => setConnected(false));
      let retry = 0;
      client.on(
         "connect_error",
         (error: Error & { data?: { code?: string } }) => {
            setConnected(false);
            clearTimeout(retry);
            if (error.data?.code === "CLIENT_RELOAD_REQUIRED") {
               client.disconnect();
               setError(
                  "This page has been updated. Please reload to reconnect."
               );
               return;
            }
            setError("The multiplayer service is unavailable. Reconnecting…");
            if (import.meta.env.DEV)
               console.warn("Multiplayer connection:", error.message);
            if (!client.active)
               retry = window.setTimeout(() => client.connect(), 5000);
         }
      );
      client.on("state", (state: { lobby: Lobby; game: Game | null }) => {
         if (socket.current !== client) return;
         setLobby(state.lobby);
         setGame(state.game);
         if (state.lobby.status === "closed") {
            removeStorage(key);
            active.current = null;
            setResumeCode(null);
         }
      });
      client.connect();
      return () => {
         clearTimeout(retry);
         socket.current = null;
         client.disconnect();
         setConnected(false);
      };
   }, [key, command, loading]);
   return (
      <Context.Provider
         value={{ lobby, game, connected, error, command, resumeCode }}
      >
         {children}
      </Context.Provider>
   );
}

export function useMultiplayer() {
   const context = useContext(Context);
   if (!context) throw new Error("Missing MultiplayerProvider");
   return context;
}
