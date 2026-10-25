import { useEffect, useRef, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { useAuth } from "@/context/AuthContext";
import { AccountSummary } from "@/components/AccountSummary";
import {
   DangerButton,
   DeleteAccountModal,
} from "@/components/DeleteAccountModal";
import { clearResults } from "@/lib/persistence";
const accountUrl = import.meta.env.DEV
   ? "http://localhost:3000/user/"
   : "/user/";

export default function User() {
   const { user, configured, loading, error, login, logout, deleteAccount } =
      useAuth();
   const [notice, setNotice] = useState("");
   const [deleting, setDeleting] = useState(false);
   const [username, setUsername] = useState("");
   const [password, setPassword] = useState("");
   const [submitting, setSubmitting] = useState(false);
   const [fieldError, setFieldError] = useState<{
      field: "username" | "password";
      message: string;
   } | null>(null);
   const usernameInput = useRef<HTMLInputElement>(null);
   const passwordInput = useRef<HTMLInputElement>(null);

   useEffect(() => {
      if (user) {
         setUsername("");
         setPassword("");
         setFieldError(null);
      }
   }, [user]);

   const submit = async (event: FormEvent) => {
      event.preventDefault();
      if (loading || submitting) return;
      if (!username.trim()) {
         setFieldError({
            field: "username",
            message: "Please enter your username or email.",
         });
         usernameInput.current?.focus();
         return;
      }
      if (!password) {
         setFieldError({
            field: "password",
            message: "Please enter your password.",
         });
         passwordInput.current?.focus();
         return;
      }
      setFieldError(null);
      setSubmitting(true);
      try {
         await login(username.trim(), password);
      } finally {
         setSubmitting(false);
      }
   };
   return (
      <>
         <Helmet>
            <title>{user ? "User" : "Sign in"} | Euchre</title>
         </Helmet>
         <PageLayout title={user ? "USER" : "SIGN IN"}>
            <div className="account-body">
               {user ? (
                  <div className="account-dashboard">
                     <div className="account-welcome">
                        Welcome <strong>{user.name}</strong>!
                     </div>
                     <AccountSummary key={user.id} userId={user.id} />
                     <div className="button-stack account-navigation">
                        <Button
                           name={loading ? "Signing out…" : "Sign Out"}
                           onClick={() => void logout()}
                           disabled={loading}
                        />
                        <MenuLink to="/" name="Home" />
                     </div>
                     <DangerButton
                        name="Delete Account"
                        onClick={() => setDeleting(true)}
                     />
                     {deleting && (
                        <DeleteAccountModal
                           onClose={() => setDeleting(false)}
                           onDelete={async (password) => {
                              const result = await deleteAccount(password);
                              clearResults(user.id);
                              setDeleting(false);
                              setNotice(result?.message || "Account deleted.");
                           }}
                        />
                     )}
                  </div>
               ) : configured ? (
                  <>
                     {notice && <p role="status">{notice}</p>}
                     <form
                        onSubmit={submit}
                        className="account-form"
                        aria-label="Sign in"
                        aria-busy={loading || submitting}
                        noValidate
                     >
                        <label htmlFor="username">
                           <span className="sr-only">Username or email</span>
                           <input
                              ref={usernameInput}
                              id="username"
                              name="username"
                              type="text"
                              placeholder="Username or email"
                              maxLength={255}
                              autoComplete="username"
                              autoCapitalize="none"
                              spellCheck={false}
                              value={username}
                              onChange={(e) => {
                                 setUsername(e.target.value);
                                 if (fieldError?.field === "username")
                                    setFieldError(null);
                              }}
                              aria-invalid={fieldError?.field === "username"}
                              aria-describedby={
                                 fieldError?.field === "username"
                                    ? "sign-in-field-error"
                                    : undefined
                              }
                              readOnly={loading || submitting}
                              required
                           />
                        </label>
                        <label htmlFor="password">
                           <span className="sr-only">Password</span>
                           <input
                              ref={passwordInput}
                              id="password"
                              name="password"
                              type="password"
                              placeholder="Password"
                              autoComplete="current-password"
                              value={password}
                              onChange={(e) => {
                                 setPassword(e.target.value);
                                 if (fieldError?.field === "password")
                                    setFieldError(null);
                              }}
                              aria-invalid={fieldError?.field === "password"}
                              aria-describedby={
                                 fieldError?.field === "password"
                                    ? "sign-in-field-error"
                                    : undefined
                              }
                              readOnly={loading || submitting}
                              required
                           />
                        </label>
                        {(fieldError || error) && (
                           <p
                              role="alert"
                              id="sign-in-field-error"
                              className="inline-error"
                           >
                              {fieldError?.message || error}
                           </p>
                        )}
                        <Button
                           name={
                              submitting
                                 ? "Signing in…"
                                 : loading
                                 ? "Loading…"
                                 : "Sign In"
                           }
                           type="submit"
                           disabled={loading || submitting}
                        />
                     </form>
                     <div className="account-links">
                        <a className="link" href={`${accountUrl}?view=recover`}>
                           Forgot password?
                        </a>
                        <a
                           className="link"
                           href={`${accountUrl}?view=register`}
                        >
                           Create an account
                        </a>
                        <a className="link" href={`${accountUrl}?view=resend`}>
                           Resend verification
                        </a>
                     </div>
                  </>
               ) : (
                  <h2>Guest</h2>
               )}
               {error && (user || !configured) && (
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
               )}
            </div>
            {!user && (
               <div className="button-stack account-navigation">
                  <MenuLink to="/" name="Home" />
               </div>
            )}
         </PageLayout>
      </>
   );
}
