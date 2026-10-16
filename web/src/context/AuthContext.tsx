import {
   createContext,
   useContext,
   useEffect,
   useState,
   type ReactNode,
} from "react";
import { createAccountClient, type AccountSession } from "@/lib/account";
const base = (import.meta.env.VITE_ACCOUNT_API_URL ?? "").trim();
const client = base ? createAccountClient(base) : null;
const Context = createContext<{
   user: AccountSession["user"];
   configured: boolean;
   loading: boolean;
   error: string;
   login: (name: string, password: string) => Promise<void>;
   logout: () => Promise<void>;
} | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
   const [session, setSession] = useState<AccountSession>({
      user: null,
      csrf_token: "",
   });
   const [loading, setLoading] = useState(!!client);
   const [error, setError] = useState("");
   useEffect(() => {
      if (!client) return;
      const controller = new AbortController();
      client
         .session(controller.signal)
         .then(setSession)
         .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
         })
         .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
         });
      return () => controller.abort();
   }, []);
   const login = async (username: string, password: string) => {
      if (!client) return;
      setError("");
      setLoading(true);
      try {
         const fresh = await client.session();
         setSession(await client.login(username, password, fresh.csrf_token));
      } catch (e) {
         setError(e instanceof Error ? e.message : "Unable to sign in.");
      } finally {
         setLoading(false);
      }
   };
   const logout = async () => {
      if (!client) return;
      setError("");
      setLoading(true);
      try {
         setSession(await client.logout(session.csrf_token));
      } catch (e) {
         setError(e instanceof Error ? e.message : "Unable to sign out.");
      } finally {
         setLoading(false);
      }
   };
   return (
      <Context.Provider
         value={{
            user: session.user,
            configured: !!client,
            loading,
            error,
            login,
            logout,
         }}
      >
         {children}
      </Context.Provider>
   );
}
export function useAuth() {
   const value = useContext(Context);
   if (!value) throw new Error("Missing AuthProvider");
   return value;
}
