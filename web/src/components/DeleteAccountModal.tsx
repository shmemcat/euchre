import { useState } from "react";
import { Button } from "./Buttons";
import { Modal } from "./Modal";
import styles from "./DeleteAccountModal.module.css";

export function DangerButton({
   name,
   onClick,
   disabled = false,
}: {
   name: string;
   onClick: () => void;
   disabled?: boolean;
}) {
   return (
      <button
         type="button"
         className={styles.dangerButton}
         onClick={onClick}
         disabled={disabled}
      >
         <span className={styles.dangerShine} aria-hidden="true" />
         {name}
      </button>
   );
}

export function DeleteAccountModal({
   onClose,
   onDelete,
}: {
   onClose: () => void;
   onDelete: (password: string) => Promise<void>;
}) {
   const [confirm, setConfirm] = useState(false);
   const [password, setPassword] = useState("");
   const [error, setError] = useState("");
   const [busy, setBusy] = useState(false);
   const remove = async () => {
      if (busy) return;
      if (!password) {
         setError("Please enter your password.");
         return;
      }
      setBusy(true);
      setError("");
      try {
         await onDelete(password);
      } catch (error) {
         setError(
            error instanceof Error
               ? error.message
               : "Unable to delete your account."
         );
      } finally {
         setBusy(false);
      }
   };
   return (
      <Modal
         title={confirm ? "Confirm Deletion" : "Delete Account"}
         onClose={busy ? undefined : onClose}
      >
         <p>
            {confirm
               ? "Enter your password to permanently delete your Cards account across Cards, Hearts, and Euchre."
               : "Are you sure? This will delete your shared account and its saved user data across Cards, Hearts, and Euchre. This cannot be undone."}
         </p>
         {confirm && (
            <form
               className="account-form"
               aria-label="Confirm deletion"
               onSubmit={(event) => {
                  event.preventDefault();
                  void remove();
               }}
            >
               <label htmlFor="delete-password">
                  <span className="sr-only">Password</span>
                  <input
                     id="delete-password"
                     type="password"
                     name="password"
                     autoComplete="current-password"
                     placeholder="Password"
                     value={password}
                     readOnly={busy}
                     onChange={(event) => {
                        setPassword(event.target.value);
                        setError("");
                     }}
                  />
               </label>
               {error && (
                  <p role="alert" className="inline-error">
                     {error}
                  </p>
               )}
               <Button
                  name={busy ? "Deleting…" : "Delete"}
                  type="submit"
                  disabled={busy}
                  className={styles.dangerButton}
               />
            </form>
         )}
         <div className="button-stack">
            {!confirm && (
               <DangerButton name="Yes" onClick={() => setConfirm(true)} />
            )}
            <Button
               name={confirm ? "Nevermind" : "No"}
               onClick={onClose}
               disabled={busy}
            />
         </div>
      </Modal>
   );
}
