import {
   render,
   screen,
   fireEvent,
   waitFor,
   within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Play from "./Play";
const saved = vi.hoisted(() => ({
   games: [
      {
         id: "first",
         title: "First bot game",
         mode: "Bots",
         progress: "Hand 2",
         status: "Ready to resume",
         multiplayer: false,
      },
      {
         id: "second",
         title: "Second game",
         mode: "Multiplayer",
         progress: "Hand 4",
         status: "Your turn",
         multiplayer: true,
      },
   ],
   checking: false,
   error: "",
   retry: vi.fn(),
   resume: vi.fn(),
   concede: vi.fn(),
}));
vi.mock("@/hooks/useSavedGames", () => ({ useSavedGames: () => saved }));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));
beforeEach(() => {
   saved.resume.mockReset().mockResolvedValue("/game/multi-play/SECOND");
   saved.concede.mockReset();
});
function Destination() {
   return <p>{useLocation().pathname}</p>;
}
function page() {
   return (
      <HelmetProvider>
         <MemoryRouter initialEntries={["/play"]}>
            <Routes>
               <Route path="/play" element={<Play />} />
               <Route path="/game/multi-play/:code" element={<Destination />} />
            </Routes>
         </MemoryRouter>
      </HelmetProvider>
   );
}
it("shows every saved game without a rejoin popup or blocking new games", () => {
   render(page());
   expect(screen.getAllByRole("article")).toHaveLength(2);
   expect(screen.queryByRole("dialog")).toBeNull();
   expect(
      screen
         .getByRole("link", { name: /Create Game/ })
         .getAttribute("aria-disabled")
   ).toBeNull();
   expect(
      screen
         .getByRole("link", { name: /Join Game/ })
         .getAttribute("aria-disabled")
   ).toBeNull();
});
it("resumes the selected game without conceding another", async () => {
   render(page());
   fireEvent.click(
      within(screen.getByRole("article", { name: "Second game" })).getByRole(
         "button",
         { name: "Resume" }
      )
   );
   await screen.findByText("/game/multi-play/SECOND");
   expect(saved.resume).toHaveBeenCalledExactlyOnceWith("second");
   expect(saved.concede).not.toHaveBeenCalled();
});
it("requires confirmation in the chosen card before conceding", async () => {
   render(page());
   const card = within(screen.getByRole("article", { name: "First bot game" }));
   fireEvent.click(card.getByRole("button", { name: "Concede" }));
   expect(saved.concede).not.toHaveBeenCalled();
   fireEvent.click(card.getByRole("button", { name: "Concede" }));
   await waitFor(() =>
      expect(saved.concede).toHaveBeenCalledExactlyOnceWith("first")
   );
});
