import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { AchievementBadge } from "./AchievementBadge";
import { computeAchievements } from "@/lib/achievements";

it("hides a locked secret's name, icon and requirement, including its tooltip", async () => {
   const user = userEvent.setup();
   const badge = computeAchievements([]).find(
      (a) => a.id === "no_jack_required"
   )!;
   const { container } = render(<AchievementBadge achievement={badge} />);
   expect(screen.queryByText("No Jack Required")).not.toBeInTheDocument();
   expect(
      container.querySelector('[data-icon="question"]')
   ).toBeInTheDocument();
   await user.click(
      screen.getByRole("button", { name: "Secret achievement: Locked" })
   );
   expect(screen.queryByText(badge.description)).not.toBeInTheDocument();
   expect(
      screen.getAllByText("This is a secret achievement").length
   ).toBeGreaterThan(0);
});

it("reveals earned secrets and displays tier progression", () => {
   const all = computeAchievements([], ["no_jack_required"]);
   const badge = all.find((a) => a.id === "no_jack_required")!;
   const { rerender } = render(<AchievementBadge achievement={badge} />);
   expect(
      screen.getByRole("button", { name: "No Jack Required: Unlocked" })
   ).toBeInTheDocument();
   const tiered = all.find((a) => a.id === "lone_star")!;
   rerender(
      <AchievementBadge
         achievement={{ ...tiered, earned: true, tier: "silver" }}
      />
   );
   expect(
      screen.getByRole("button", { name: "Lone Star: Unlocked · silver" })
   ).toBeInTheDocument();
});
