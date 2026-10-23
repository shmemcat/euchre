import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/context/AuthContext";
import { PreferencesProvider } from "@/context/PreferencesContext";
import User from "./User";
import Options from "./Options";

vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));

let auth: ReturnType<typeof useAuth>;
const login = vi.fn<ReturnType<typeof useAuth>["login"]>();

function page(content = <User />) {
   return (
      <HelmetProvider>
         <MemoryRouter initialEntries={["/user"]}>
            <PreferencesProvider>{content}</PreferencesProvider>
         </MemoryRouter>
      </HelmetProvider>
   );
}

beforeEach(() => {
   login.mockReset().mockResolvedValue(undefined);
   auth = {
      user: null,
      configured: true,
      loading: false,
      error: "",
      login,
      logout: vi.fn(),
      updateProfile: vi.fn(),
      deleteAccount: vi.fn(),
   };
   vi.mocked(useAuth).mockImplementation(() => auth);
});

describe("Sign in", () => {
   it("keeps accessible, autofill-ready fields and account links in a focused form", () => {
      render(page());
      expect(screen.getByLabelText("Username or email")).toHaveAttribute(
         "autocomplete",
         "username"
      );
      expect(screen.getByLabelText("Username or email")).toHaveAttribute(
         "name",
         "username"
      );
      expect(screen.getByPlaceholderText("Username or email")).toBe(
         screen.getByLabelText("Username or email")
      );
      expect(screen.getByLabelText("Password")).toHaveAttribute(
         "autocomplete",
         "current-password"
      );
      expect(screen.getByLabelText("Password")).toHaveAttribute(
         "type",
         "password"
      );
      expect(
         screen.getByRole("link", { name: "Forgot password?" })
      ).toHaveAttribute("href", expect.stringContaining("/user/?view=recover"));
      expect(
         screen.getByRole("link", { name: "Create an account" })
      ).toHaveAttribute(
         "href",
         expect.stringContaining("/user/?view=register")
      );
      expect(
         screen.getByRole("link", { name: "Resend verification" })
      ).toHaveAttribute("href", "http://localhost:3000/user/?view=resend");
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
         "href",
         "/"
      );
      expect(
         screen.queryByRole("heading", { name: "Sign in" })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("button", { name: "Save Name" })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("link", { name: "Statistics" })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("link", { name: "Options" })
      ).not.toBeInTheDocument();
   });

   it("rejects a whitespace username, focuses the field, and clears its error on edit", async () => {
      const user = userEvent.setup();
      render(page());
      await user.type(screen.getByLabelText("Username or email"), "   ");
      await user.click(screen.getByRole("button", { name: "Sign In" }));
      expect(login).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Username or email")).toHaveFocus();
      expect(
         screen.getByLabelText("Username or email")
      ).toHaveAccessibleDescription("Please enter your username or email.");
      expect(screen.getByLabelText("Username or email")).toHaveAttribute(
         "aria-invalid",
         "true"
      );
      await user.type(screen.getByLabelText("Username or email"), "Emily");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
   });

   it("requires a password and focuses it before contacting the account service", async () => {
      const user = userEvent.setup();
      render(page());
      await user.type(screen.getByLabelText("Username or email"), "Emily");
      await user.click(screen.getByRole("button", { name: "Sign In" }));
      expect(login).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Password")).toHaveFocus();
      expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
         "Please enter your password."
      );
   });

   it("accepts an email address in the same sign-in field", async () => {
      const user = userEvent.setup();
      const password = crypto.randomUUID();
      render(page());
      await user.type(
         screen.getByLabelText("Username or email"),
         "  EMILY@example.test  "
      );
      await user.type(screen.getByLabelText("Password"), password);
      await user.click(screen.getByRole("button", { name: "Sign In" }));
      expect(login).toHaveBeenCalledExactlyOnceWith(
         "EMILY@example.test",
         password
      );
   });

   it("submits on Enter, prevents repeat requests, and preserves credentials after a failure", async () => {
      let finish!: () => void;
      login.mockImplementationOnce(
         () =>
            new Promise<void>((resolve) => {
               finish = resolve;
            })
      );
      const user = userEvent.setup();
      const view = render(page());
      await user.type(screen.getByLabelText("Username or email"), "  Emily  ");
      await user.type(screen.getByLabelText("Password"), " secret {Enter}");
      expect(login).toHaveBeenCalledExactlyOnceWith("Emily", " secret ");
      expect(
         screen.getByRole("button", { name: "Signing in…" })
      ).toBeDisabled();
      expect(screen.getByLabelText("Password")).toHaveAttribute("readonly");
      fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
      expect(login).toHaveBeenCalledTimes(1);
      await act(async () => finish());
      auth.error = "Check your username and password.";
      view.rerender(page());
      expect(screen.getByRole("alert")).toHaveTextContent(auth.error);
      expect(screen.getByLabelText("Password")).toHaveValue(" secret ");
      expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
   });

   it("clears credentials after sign-in and keeps authenticated navigation", async () => {
      const user = userEvent.setup();
      const view = render(page());
      await user.type(screen.getByLabelText("Username or email"), "Emily");
      await user.type(screen.getByLabelText("Password"), "secret");
      await user.click(screen.getByRole("button", { name: "Sign In" }));
      auth.user = { id: "existing-account", name: "Emily" };
      view.rerender(page());
      expect(screen.getByText(/Welcome/)).toHaveTextContent("Welcome Emily!");
      expect(
         screen.getByRole("heading", { name: "Achievements" })
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Settings menu" }));
      expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Options" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Sign Out" }));
      expect(auth.logout).toHaveBeenCalledOnce();
      auth.user = null;
      view.rerender(page());
      expect(screen.getByLabelText("Username or email")).toHaveValue("");
      expect(screen.getByLabelText("Password")).toHaveValue("");
   });

   it("waits for the initial account check before accepting a submission", () => {
      auth.loading = true;
      render(page());
      expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
      expect(screen.getByRole("form", { name: "Sign in" })).toHaveAttribute(
         "aria-busy",
         "true"
      );
      fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
      expect(login).not.toHaveBeenCalled();
   });

   it("keeps guest navigation available when accounts are not configured", () => {
      auth.configured = false;
      render(page());
      expect(
         screen.getByRole("heading", { name: "Guest" })
      ).toBeInTheDocument();
      expect(
         screen.queryByRole("link", { name: "Options" })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("form", { name: "Sign in" })
      ).not.toBeInTheDocument();
   });
});

describe("Account-only options", () => {
   it("does not expose options to guests", () => {
      render(page(<Options />));
      expect(
         screen.queryByRole("heading", { name: "Card Style" })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("button", { name: "Settings menu" })
      ).not.toBeInTheDocument();
   });
   it("offers account options without a guest name editor", () => {
      auth.user = { id: "existing-account", name: "Emily" };
      render(page(<Options />));
      expect(
         screen.getByRole("heading", { name: "Card Style" })
      ).toBeInTheDocument();
      expect(
         screen.queryByRole("form", { name: "Guest name" })
      ).not.toBeInTheDocument();
   });
});

it("shows pending deletion after the account has been signed out", async () => {
   const message =
      "Account deletion is processing. You are signed out; cleanup will retry automatically.";
   auth.user = { id: "42", name: "Emily" };
   vi.mocked(auth.deleteAccount).mockResolvedValue({
      user: null,
      csrf_token: "guest",
      message,
   });
   const view = render(page());
   const user = userEvent.setup();
   await user.click(screen.getByRole("button", { name: "Delete Account" }));
   await user.click(screen.getByRole("button", { name: "Yes" }));
   await user.type(screen.getByLabelText("Password"), "test-password");
   await user.click(
      screen.getByRole("button", { name: "Delete", exact: true })
   );
   await waitFor(() => expect(auth.deleteAccount).toHaveBeenCalled());
   auth.user = null;
   view.rerender(page());
   expect(await screen.findByRole("status")).toHaveTextContent(message);
});
