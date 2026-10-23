import { useState } from "react";
import { Button } from "./Buttons";
import { Modal } from "./Modal";

export function ActiveGameModal({
   title,
   message,
   continueLabel,
   leaveLabel,
   confirmMessage,
   busy,
   leaveDisabled,
   error,
   onContinue,
   onLeave,
}: {
   title: string;
   message: string;
   continueLabel: string;
   leaveLabel: string;
   confirmMessage: string;
   busy: boolean;
   leaveDisabled: boolean;
   error: string;
   onContinue: () => void;
   onLeave: () => void;
}) {
   const [confirming, setConfirming] = useState(false);
   return (
      <Modal title={confirming ? "Are you sure?" : title}>
         <p>{confirming ? confirmMessage : message}</p>
         <div className="button-stack">
            {confirming ? (
               <>
                  <Button
                     name={busy ? "Leaving…" : "Yes"}
                     disabled={busy || leaveDisabled}
                     onClick={onLeave}
                  />
                  <Button
                     name="No"
                     disabled={busy}
                     onClick={() => setConfirming(false)}
                  />
               </>
            ) : (
               <>
                  <Button
                     name={continueLabel}
                     disabled={busy}
                     onClick={onContinue}
                  />
                  <Button
                     name={leaveLabel}
                     disabled={busy || leaveDisabled}
                     onClick={() => setConfirming(true)}
                  />
               </>
            )}
         </div>
         {error && (
            <p className="inline-error" role="alert">
               {error}
            </p>
         )}
      </Modal>
   );
}
