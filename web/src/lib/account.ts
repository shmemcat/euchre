export type AccountUser = { id: string; name: string; profile_icon?: string };
export type AccountSession = { user: AccountUser | null; csrf_token: string };
export function createAccountClient(
   base: string,
   fetcher: typeof fetch = fetch
) {
   const url = base.replace(/\/$/, "");
   const request = async (
      path: string,
      options: RequestInit = {}
   ): Promise<AccountSession> => {
      const response = await fetcher(`${url}${path}`, {
         credentials: "include",
         ...options,
         headers: { Accept: "application/json", ...options.headers },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
         throw new Error(
            response.status === 401
               ? "Check your username and password."
               : "Unable to connect to your account. Please try again."
         );
      if (
         !data ||
         typeof data.csrf_token !== "string" ||
         (data.user !== null &&
            (!data.user ||
               typeof data.user.id !== "string" ||
               typeof data.user.name !== "string"))
      )
         throw new Error(
            "The account service returned an unexpected response."
         );
      return data;
   };
   return {
      session: (signal?: AbortSignal) => request("/session", { signal }),
      login: (username: string, password: string, csrf: string) =>
         request("/login", {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
               "X-CSRF-Token": csrf,
            },
            body: JSON.stringify({ username, password }),
         }),
      logout: (csrf: string) =>
         request("/logout", {
            method: "POST",
            headers: { "X-CSRF-Token": csrf },
         }),
   };
}
