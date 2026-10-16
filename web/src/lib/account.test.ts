import { describe, it, expect, vi } from "vitest";
import { createAccountClient } from "./account";
const session = {
   user: { id: "existing-hearts-id", name: "Emily" },
   csrf_token: "anti-csrf",
};
describe("Future shared account adapter", () => {
   it("uses cookie credentials and CSRF protection without storing a bearer token", async () => {
      const fetcher = vi
         .fn()
         .mockResolvedValue({ ok: true, json: async () => session });
      const client = createAccountClient("/api/account/", fetcher);
      expect(await client.session()).toEqual(session);
      await client.login("Emily", "password", "anti-csrf");
      await client.logout("anti-csrf");
      expect(fetcher.mock.calls[0][0]).toBe("/api/account/session");
      expect(fetcher.mock.calls[1][1]).toMatchObject({
         credentials: "include",
         method: "POST",
         headers: { "X-CSRF-Token": "anti-csrf" },
      });
      expect(fetcher.mock.calls[2][1]).toMatchObject({
         credentials: "include",
         method: "POST",
         headers: { "X-CSRF-Token": "anti-csrf" },
      });
      expect(localStorage.length).toBe(0);
   });
   it("rejects malformed identity responses", async () => {
      const client = createAccountClient(
         "/api/account",
         vi
            .fn()
            .mockResolvedValue({
               ok: true,
               json: async () => ({ user: { name: "wrong" } }),
            })
      );
      await expect(client.session()).rejects.toThrow("unexpected response");
   });
   it("handles unreachable and rejected sessions", async () => {
      const client = createAccountClient(
         "/api/account",
         vi
            .fn()
            .mockResolvedValue({
               ok: false,
               status: 401,
               json: async () => ({}),
            })
      );
      await expect(client.login("x", "y", "csrf")).rejects.toThrow(
         "username and password"
      );
   });
});
