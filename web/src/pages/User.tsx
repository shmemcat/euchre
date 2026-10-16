import { useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
export default function User() {
   const { user, configured, loading, error, login, logout } = useAuth();
   const { preferences, update, saved } = usePreferences();
   const [name, setName] = useState(
      preferences.playerName === "You" ? "" : preferences.playerName
   );
   const [username, setUsername] = useState("");
   const [password, setPassword] = useState("");
   const [nameSaved, setNameSaved] = useState(false);
   const submit = async (event: FormEvent) => {
      event.preventDefault();
      await login(username.trim(), password);
      setPassword("");
   };
   return (
      <>
         <Helmet>
            <title>User | Euchre</title>
         </Helmet>
         <PageLayout title="USER">
            <div className="account-body">
               {user ? (
                  <>
                     <h2>Hello, {user.name}</h2>
                     <Button
                        name={loading ? "Signing out…" : "Sign Out"}
                        onClick={() => void logout()}
                        disabled={loading}
                     />
                  </>
               ) : configured ? (
                  <form onSubmit={submit} className="account-form">
                     <h2>Sign In</h2>
                     <label>
                        Username
                        <input
                           autoComplete="username"
                           value={username}
                           onChange={(e) => setUsername(e.target.value)}
                           required
                        />
                     </label>
                     <label>
                        Password
                        <input
                           type="password"
                           autoComplete="current-password"
                           value={password}
                           onChange={(e) => setPassword(e.target.value)}
                           required
                        />
                     </label>
                     <Button
                        name={loading ? "Signing in…" : "Sign In"}
                        type="submit"
                        disabled={loading}
                     />
                  </form>
               ) : (
                  <h2>Guest</h2>
               )}
               {error && (
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
               )}
               {!user && (
                  <form
                     className="account-form guest-name"
                     onSubmit={(e) => {
                        e.preventDefault();
                        update({ playerName: name.trim() || "You" });
                        setNameSaved(true);
                     }}
                  >
                     <label>
                        Name
                        <input
                           value={name}
                           onChange={(e) => {
                              setName(e.target.value);
                              setNameSaved(false);
                           }}
                           maxLength={24}
                           placeholder="You"
                           autoComplete="nickname"
                        />
                     </label>
                     <Button name="Save Name" type="submit" />
                     {nameSaved && saved && (
                        <p role="status">Name saved.</p>
                     )}
                     {!saved && (
                        <p role="alert">
                           Your browser couldn’t save your name.
                        </p>
                     )}
                  </form>
               )}
            </div>
            <div className="button-stack">
               <MenuLink to="/stats" name="Statistics" />
               <MenuLink to="/options" name="Options" />
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
