import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { MultiplayerPresence } from "./MultiplayerPresence";

const command = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/context/MultiplayerContext", () => ({
   useMultiplayer: () => ({ command }),
}));

it("keeps the connection when a game starts and releases it when leaving the table screens", () => {
   render(
      <MemoryRouter initialEntries={["/game/lobby/ABC234"]}>
         <MultiplayerPresence />
         <Link to="/game/multi-play/ABC234">Start</Link>
         <Link to="/play">Play</Link>
      </MemoryRouter>
   );
   fireEvent.click(screen.getByRole("link", { name: "Start" }));
   expect(command).not.toHaveBeenCalled();
   fireEvent.click(screen.getByRole("link", { name: "Play" }));
   expect(command).toHaveBeenCalledExactlyOnceWith({
      type: "unwatch",
      code: "ABC234",
   });
});
