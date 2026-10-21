import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/context/AuthContext";
import Profile from "./Profile";
import Leaderboard from "./Leaderboard";

vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));
let auth: ReturnType<typeof useAuth>;
const updateProfile = vi.fn();
beforeEach(() => {
   updateProfile.mockReset().mockResolvedValue({
      user: { id: "alice" },
      csrf_token: "csrf",
      message: "Profile saved.",
   });
   auth = {
      user: {
         id: "alice",
         name: "Alice",
         email: "alice@example.test",
         email_verified: true,
         profile_icon: "cat",
      },
      loading: false,
      updateProfile,
   } as ReturnType<typeof useAuth>;
   vi.mocked(useAuth).mockImplementation(() => auth);
});
function page(content = <Profile />) {
   return (
      <HelmetProvider>
         <MemoryRouter initialEntries={["/profile"]}>{content}</MemoryRouter>
      </HelmetProvider>
   );
}
describe("Account profile", () => {
   it("saves an icon through the shared account service", async () => {
      const user = userEvent.setup();
      render(page());
      expect(screen.getByText("Verified")).toBeInTheDocument();
      await user.click(
         screen.getByRole("button", { name: "Toggle icon picker" })
      );
      await user.click(
         screen.getByRole("button", { name: "Sparkles", exact: true })
      );
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
         profile_icon: "sparkles",
      });
      expect(await screen.findByRole("status")).toHaveTextContent(
         "Profile saved."
      );
   });
   it("reports a failed save and keeps the current icon selected", async () => {
      updateProfile.mockRejectedValueOnce(
         new Error("Unable to save your profile.")
      );
      const user = userEvent.setup();
      render(page());
      await user.click(
         screen.getByRole("button", { name: "Toggle icon picker" })
      );
      await user.click(
         screen.getByRole("button", { name: "Sparkles", exact: true })
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
         "Unable to save"
      );
      expect(
         screen.getByRole("button", { name: "Cat", exact: true })
      ).toHaveAttribute("aria-pressed", "true");
   });
   it("enables email saving only when the address changes", async () => {
      const user = userEvent.setup();
      render(page());
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      const email = screen.getByRole("textbox", { name: "Email address" });
      await user.clear(email);
      await user.type(email, "new@example.test");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
         email: "new@example.test",
      });
   });
   it("does not expose profile controls or the gear to guests", () => {
      auth.user = null;
      render(page());
      expect(
         screen.queryByRole("button", { name: "Toggle icon picker" })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("button", { name: "Settings menu" })
      ).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
         "href",
         "/user"
      );
   });
});
describe("Leaderboard placeholder", () => {
   it("has empty monthly and all-time tables for every category", async () => {
      const user = userEvent.setup();
      render(page(<Leaderboard />));
      expect(await screen.findAllByRole("table")).toHaveLength(2);
      expect(screen.getAllByText("No winners yet")).toHaveLength(2);
      await user.click(
         screen.getByRole("button", { name: "hard", exact: true })
      );
      await user.click(
         screen.getByRole("button", { name: "hardest", exact: true })
      );
      expect(
         screen.getByRole("table", { name: "Monthly hardest winners" })
      ).toBeInTheDocument();
      await user.click(
         screen.getByRole("button", { name: "multiplayer", exact: true })
      );
      expect(
         screen.getByRole("table", { name: "All-Time multiplayer winners" })
      ).toBeInTheDocument();
   });
});
