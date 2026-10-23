import {
   act,
   render,
   screen,
   fireEvent,
   waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MultiplayerProvider, useMultiplayer } from "./MultiplayerContext";

const mocks = vi.hoisted(() => ({
   io: vi.fn(),
   auth: { user: null as null | { id: string }, loading: false },
   session: vi.fn(),
}));
vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("./AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/account", () => ({
   accountApiBase: () => "/api/account",
   createAccountClient: () => ({ session: mocks.session }),
}));

class FakeSocket {
   connected = false;
   active = true;
   handlers: Record<string, (...args: any[]) => void> = {};
   on = (name: string, handler: (...args: any[]) => void) => {
      this.handlers[name] = handler;
      return this;
   };
   connect = vi.fn();
   disconnect = vi.fn(() => {
      this.connected = false;
   });
   timeout = () => this;
   emit = vi.fn(
      (_event: string, data: any, callback: (...args: any[]) => void) =>
         callback(
            null,
            data.type === "create"
               ? { ok: true, code: "ABC234", token: "private-seat" }
               : { ok: true }
         )
   );
   ready() {
      this.connected = true;
      this.handlers.connect();
   }
}
let clients: FakeSocket[];
function Probe() {
   const multi = useMultiplayer();
   return (
      <>
         <span>{multi.connected ? "Online" : "Offline"}</span>
         <span>{multi.resumeCode}</span>
         <span>{multi.error}</span>
         <button
            onClick={() =>
               void multi.command({ type: "create", name: "Guest" })
            }
         >
            Create
         </button>
      </>
   );
}
beforeEach(() => {
   clients = [];
   mocks.auth = { user: null, loading: false };
   mocks.session.mockResolvedValue({ csrf_token: "csrf" });
   mocks.io.mockReset().mockImplementation(() => {
      const client = new FakeSocket();
      clients.push(client);
      return client;
   });
});

it("waits for the account session before opening a multiplayer connection", async () => {
   mocks.auth.loading = true;
   const view = render(
      <MultiplayerProvider>
         <Probe />
      </MultiplayerProvider>
   );
   expect(mocks.io).not.toHaveBeenCalled();
   mocks.auth.loading = false;
   view.rerender(
      <MultiplayerProvider>
         <Probe />
      </MultiplayerProvider>
   );
   expect(clients).toHaveLength(1);
   expect(mocks.io).toHaveBeenCalledWith(
      "/euchre",
      expect.objectContaining({ path: "/euchre/socket.io" })
   );
   act(() => clients[0].ready());
   expect(screen.getByText("Online")).toBeInTheDocument();
});

it("shows a reload requirement without retrying an incompatible server", () => {
   render(
      <MultiplayerProvider>
         <Probe />
      </MultiplayerProvider>
   );
   act(() =>
      clients[0].handlers.connect_error({
         data: { code: "CLIENT_RELOAD_REQUIRED" },
      })
   );
   expect(
      screen.getByText(
         "This page has been updated. Please reload to reconnect."
      )
   ).toBeInTheDocument();
   expect(clients[0].disconnect).toHaveBeenCalledOnce();
   expect(clients[0].connect).toHaveBeenCalledOnce();
});

it("restores the same private seat after reconnecting without exposing it in the invitation", async () => {
   render(
      <MultiplayerProvider>
         <Probe />
      </MultiplayerProvider>
   );
   act(() => clients[0].ready());
   fireEvent.click(screen.getByRole("button", { name: "Create" }));
   await screen.findByText("ABC234");
   act(() => clients[0].handlers.disconnect());
   expect(screen.getByText("Offline")).toBeInTheDocument();
   act(() => clients[0].ready());
   await waitFor(() =>
      expect(clients[0].emit).toHaveBeenLastCalledWith(
         "command",
         { type: "watch", code: "ABC234", token: "private-seat" },
         expect.any(Function)
      )
   );
});

it("separates seat credentials when the signed-in account changes", async () => {
   localStorage.setItem(
      "euchre.multiplayer.v1:guest",
      JSON.stringify({ code: "ABC234", token: "guest-seat" })
   );
   const view = render(
      <MultiplayerProvider>
         <Probe />
      </MultiplayerProvider>
   );
   mocks.auth.user = { id: "alice" };
   view.rerender(
      <MultiplayerProvider>
         <Probe />
      </MultiplayerProvider>
   );
   expect(clients[0].disconnect).toHaveBeenCalled();
   act(() => clients[1].ready());
   expect(clients[1].emit).not.toHaveBeenCalled();
   expect(screen.queryByText("ABC234")).not.toBeInTheDocument();
});
